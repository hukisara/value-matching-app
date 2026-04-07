import { QUESTIONS } from './questions'
import type { Participant } from '@/types/database'

export interface PairResult {
  p1: Participant
  p2: Participant
  score: number
  percent: number
  reasons: string[]
}

export interface MatchResult {
  best: PairResult
  worst: PairResult
}

export function calculateResults(
  participants: Participant[]
): MatchResult | null {
  const finished = participants.filter(
    (p) => p.is_finished && (p.answers as number[]).length === QUESTIONS.length
  )
  if (finished.length < 2) return null

  let best: PairResult = {
    p1: finished[0],
    p2: finished[1],
    score: -2,
    percent: 0,
    reasons: [],
  }
  let worst: PairResult = {
    p1: finished[0],
    p2: finished[1],
    score: 2,
    percent: 0,
    reasons: [],
  }

  for (let i = 0; i < finished.length; i++) {
    for (let j = i + 1; j < finished.length; j++) {
      const p1 = finished[i]
      const p2 = finished[j]
      const a1 = p1.answers as number[]
      const a2 = p2.answers as number[]

      let dot = 0
      let normA = 0
      let normB = 0
      const matched: string[] = []
      const mismatched: string[] = []

      for (let k = 0; k < QUESTIONS.length; k++) {
        dot += a1[k] * a2[k]
        normA += a1[k] ** 2
        normB += a2[k] ** 2
        if (a1[k] === a2[k]) matched.push(QUESTIONS[k].dim)
        else mismatched.push(QUESTIONS[k].dim)
      }

      const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB))

      if (similarity > best.score) {
        best = {
          p1,
          p2,
          score: similarity,
          percent: formatScore(similarity),
          reasons: matched,
        }
      }
      if (similarity < worst.score) {
        worst = {
          p1,
          p2,
          score: similarity,
          percent: formatScore(similarity),
          reasons: mismatched,
        }
      }
    }
  }

  return { best, worst }
}

function formatScore(similarity: number): number {
  return Math.round(((similarity + 1) / 2) * 100)
}
