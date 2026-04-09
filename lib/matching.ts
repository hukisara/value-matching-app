import { QUESTIONS } from './questions'
import type { Participant } from '@/types/database'

export interface PairResult {
  p1: Participant
  p2: Participant
  score: number
  percent: number
  reasons: string[]
}

export interface PersonalBest {
  me: Participant
  partner: Participant
  score: number
  percent: number
}

export interface MinorityResult extends Participant {
  eccentricity: number
  uniquenessScore: number
}

export interface QuestionStat {
  aPercent: number
  bPercent: number
}

export interface MatchResult {
  best: PairResult
  worst: PairResult
  minority: MinorityResult
  personalBests: PersonalBest[]
  questionStats: QuestionStat[]
  allPairs: PairResult[]
}

/**
 * 各質問のIDF重み。
 * 回答が 50:50 に近いほど情報量が高い（weight → 1）。
 * 全員が同じ回答なら情報量ゼロ（weight → 0）。
 * 式: weight = 1 - |aRate - 0.5| * 2  （0〜1）
 * ゼロ除算を防ぐため最低 0.05 を保証する。
 */
export function idfWeights(finished: Participant[]): number[] {
  return QUESTIONS.map((_, idx) => {
    let countA = 0
    finished.forEach((p) => { if ((p.answers as number[])[idx] === 1) countA++ })
    const aRate = countA / finished.length
    const w = 1 - Math.abs(aRate - 0.5) * 2
    return Math.max(w, 0.05)
  })
}

/**
 * 重み付きコサイン類似度 (-1 〜 +1)
 * 回答値は 1 (選択肢A) / -1 (選択肢B) として保存されている。
 * 全一致 → +1.0、全不一致 → -1.0
 */
function weightedCosineSimilarity(
  a1: number[],
  a2: number[],
  weights: number[]
): number {
  let dot = 0, normA = 0, normB = 0
  for (let k = 0; k < a1.length; k++) {
    const v1 = a1[k] * weights[k]
    const v2 = a2[k] * weights[k]
    dot += v1 * v2
    normA += v1 * v1
    normB += v2 * v2
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** コサイン類似度 -1〜+1 → 0〜100% に変換 */
function formatScore(sim: number): number {
  return Math.round(((sim + 1) / 2) * 100)
}

export function calculateResults(participants: Participant[]): MatchResult | null {
  const finished = participants.filter(
    (p) => p.is_finished && (p.answers as number[]).length === QUESTIONS.length
  )
  if (finished.length < 2) return null

  // 1. 回答分布
  const questionStats: QuestionStat[] = QUESTIONS.map((_, idx) => {
    let countA = 0, countB = 0
    finished.forEach((p) => { if ((p.answers as number[])[idx] === 1) countA++; else countB++ })
    const total = countA + countB
    return {
      aPercent: total > 0 ? Math.round((countA / total) * 100) : 0,
      bPercent: total > 0 ? Math.round((countB / total) * 100) : 0,
    }
  })

  // 2. IDF重み（回答が二分されている質問ほど重要）
  const weights = idfWeights(finished)

  // 3. 重心（回答値 ±1 を重み付きで平均）
  const centroid = Array(QUESTIONS.length).fill(0)
  finished.forEach((p) => {
    ;(p.answers as number[]).forEach((ans, idx) => {
      centroid[idx] += ans * weights[idx]
    })
  })
  centroid.forEach((_, i) => { centroid[i] /= finished.length })

  // 4. 特異度（重心からの加重二乗距離）
  const maxPossibleDistanceSq = weights.reduce((s, w) => s + w * w * 4, 0)
  const individualStats: MinorityResult[] = finished.map((p) => {
    let dist = 0
    ;(p.answers as number[]).forEach((ans, idx) => {
      const v = ans * weights[idx]
      dist += Math.pow(v - centroid[idx], 2)
    })
    return {
      ...p,
      eccentricity: dist,
      uniquenessScore: Math.min(Math.round((dist / maxPossibleDistanceSq) * 200), 100),
    }
  })
  individualStats.sort((a, b) => b.eccentricity - a.eccentricity)

  // 5. 重み付きコサイン類似度でペアスコア計算
  const allPairsRaw: PairResult[] = []
  for (let i = 0; i < finished.length; i++) {
    for (let j = i + 1; j < finished.length; j++) {
      const p1 = finished[i], p2 = finished[j]
      const a1 = p1.answers as number[], a2 = p2.answers as number[]
      const sim = weightedCosineSimilarity(a1, a2, weights)
      const matched: string[] = []
      for (let k = 0; k < QUESTIONS.length; k++) {
        if (a1[k] === a2[k]) matched.push(QUESTIONS[k].dim)
      }
      allPairsRaw.push({ p1, p2, score: sim, percent: formatScore(sim), reasons: matched })
    }
  }
  allPairsRaw.sort((a, b) => b.score - a.score)

  const best = allPairsRaw[0]
  const worstRaw = allPairsRaw[allPairsRaw.length - 1]
  const worst: PairResult = {
    ...worstRaw,
    reasons: QUESTIONS
      .filter((_, k) => (worstRaw.p1.answers as number[])[k] !== (worstRaw.p2.answers as number[])[k])
      .map(q => q.dim),
  }

  // 6. 全員のベストマッチ
  const personalBests: PersonalBest[] = finished.map((person) => {
    const related = allPairsRaw.filter((pair) => pair.p1.id === person.id || pair.p2.id === person.id)
    related.sort((a, b) => b.score - a.score)
    const top = related[0]
    const partner = top.p1.id === person.id ? top.p2 : top.p1
    return { me: person, partner, score: top.score, percent: formatScore(top.score) }
  })

  return { best, worst, minority: individualStats[0], personalBests, questionStats, allPairs: allPairsRaw }
}
