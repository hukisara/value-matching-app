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
}

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
    return { aPercent: total > 0 ? Math.round((countA / total) * 100) : 0, bPercent: total > 0 ? Math.round((countB / total) * 100) : 0 }
  })

  // 2. 重心
  const centroid = Array(QUESTIONS.length).fill(0)
  finished.forEach((p) => { (p.answers as number[]).forEach((ans, idx) => { centroid[idx] += ans }) })
  centroid.forEach((_, i) => { centroid[i] /= finished.length })

  // 3. 特異度
  const maxPossibleDistanceSq = QUESTIONS.length * 4
  const individualStats: MinorityResult[] = finished.map((p) => {
    let dist = 0
    ;(p.answers as number[]).forEach((ans, idx) => { dist += Math.pow(ans - centroid[idx], 2) })
    return { ...p, eccentricity: dist, uniquenessScore: Math.min(Math.round((dist / maxPossibleDistanceSq) * 200), 100) }
  })
  individualStats.sort((a, b) => b.eccentricity - a.eccentricity)

  // 4. コサイン類似度
  const allPairs: PairResult[] = []
  for (let i = 0; i < finished.length; i++) {
    for (let j = i + 1; j < finished.length; j++) {
      const p1 = finished[i], p2 = finished[j]
      const a1 = p1.answers as number[], a2 = p2.answers as number[]
      let dot = 0, normA = 0, normB = 0
      const matched: string[] = [], mismatched: string[] = []
      for (let k = 0; k < QUESTIONS.length; k++) {
        dot += a1[k] * a2[k]; normA += a1[k] ** 2; normB += a2[k] ** 2
        if (a1[k] === a2[k]) matched.push(QUESTIONS[k].dim)
        else mismatched.push(QUESTIONS[k].dim)
      }
      const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB))
      allPairs.push({ p1, p2, score: sim, percent: formatScore(sim), reasons: matched })
    }
  }
  allPairs.sort((a, b) => b.score - a.score)
  const best = allPairs[0]
  const worstRaw = allPairs[allPairs.length - 1]
  const worst: PairResult = { ...worstRaw, reasons: QUESTIONS.filter((_, k) => (worstRaw.p1.answers as number[])[k] !== (worstRaw.p2.answers as number[])[k]).map(q => q.dim) }

  // 5. 全員のベストマッチ
  const personalBests: PersonalBest[] = finished.map((person) => {
    const related = allPairs.filter((pair) => pair.p1.id === person.id || pair.p2.id === person.id)
    related.sort((a, b) => b.score - a.score)
    const best = related[0]
    const partner = best.p1.id === person.id ? best.p2 : best.p1
    return { me: person, partner, score: best.score, percent: formatScore(best.score) }
  })

  return { best, worst, minority: individualStats[0], personalBests, questionStats }
}
