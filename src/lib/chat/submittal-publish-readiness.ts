import type { IngestionGrade } from '../eval/ingestion-types'
import type { QAResult } from './submittal-coverage-qa'

export type PublishReadinessStatus = 'ready' | 'needs_review' | 'blocked'

export interface PublishReadinessInput {
  ingestionGrade?: IngestionGrade
  ingestionGradeReasons?: string[]
  qaResult?: QAResult
}

export interface PublishReadinessResult {
  status: PublishReadinessStatus
  reasons: string[]
  requiredActions: string[]
}

export function evaluateRegisterPublishReadiness(
  input: PublishReadinessInput,
): PublishReadinessResult {
  const { ingestionGrade, ingestionGradeReasons = [], qaResult } = input

  const reasons: string[] = []
  const requiredActions: string[] = []
  let blocked = false
  let needsReview = false

  if (ingestionGrade === 'poor_extraction') {
    blocked = true
    reasons.push(
      ...(ingestionGradeReasons.length > 0
        ? ingestionGradeReasons
        : ['Extraction quality is too low to publish']),
    )
    requiredActions.push('Re-run extraction or manually review items before publishing')
  } else if (ingestionGrade === 'needs_review') {
    needsReview = true
    reasons.push(
      ...(ingestionGradeReasons.length > 0
        ? ingestionGradeReasons
        : ['Extraction quality requires manual review']),
    )
    requiredActions.push('Review extraction quality issues before publishing')
  }

  if (qaResult) {
    for (const f of qaResult.findings) {
      if (f.severity === 'critical') {
        blocked = true
        reasons.push(f.message)
        requiredActions.push(f.suggestedAction)
      } else if (f.severity === 'warning') {
        needsReview = true
        reasons.push(f.message)
        requiredActions.push(f.suggestedAction)
      }
    }
  }

  const status: PublishReadinessStatus = blocked
    ? 'blocked'
    : needsReview
      ? 'needs_review'
      : 'ready'

  return { status, reasons, requiredActions }
}
