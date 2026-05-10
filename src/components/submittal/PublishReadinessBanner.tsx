'use client'

import { useState } from 'react'
import type { PublishReadinessResult } from '@/lib/chat/submittal-publish-readiness'
import type { QAResult } from '@/lib/chat/submittal-coverage-qa'

interface PublishReadinessBannerProps {
  readiness: PublishReadinessResult
  qaResult?: QAResult
  ingestionGradeReasons?: string[]
}

interface PublishState {
  publishedAt: string
}

// One summary line per unique finding type in the modal.
function buildModalLines(
  qaResult: QAResult | undefined,
  ingestionGradeReasons: string[],
): string[] {
  const lines: string[] = [...ingestionGradeReasons]

  if (!qaResult) return lines

  // Group by finding type — each type has at most one "aggregate" line plus
  // potentially many per-item lines (cross_section_duplicate_submittal).
  // We collapse per-item duplicates into one grouped line.
  const byType = new Map<string, { count: number; firstMessage: string; severity: string }>()
  for (const f of qaResult.findings) {
    if (f.severity === 'info') continue
    const existing = byType.get(f.type)
    if (existing) {
      existing.count++
    } else {
      byType.set(f.type, { count: 1, firstMessage: f.message, severity: f.severity })
    }
  }

  for (const [, { count, firstMessage }] of byType) {
    if (count === 1) {
      lines.push(firstMessage)
    } else {
      // e.g. "28 instances: "concrete" appears in 3 different spec sections (and 27 more)"
      lines.push(`${firstMessage} (+${count - 1} more like this)`)
    }
  }

  return lines
}

export function PublishReadinessBanner({
  readiness,
  qaResult,
  ingestionGradeReasons = [],
}: PublishReadinessBannerProps) {
  const [publishState, setPublishState] = useState<PublishState | null>(null)
  const [showModal, setShowModal] = useState(false)

  const { status } = readiness

  const criticalCount = qaResult?.findings.filter(f => f.severity === 'critical').length ?? 0
  const warningCount = qaResult?.findings.filter(f => f.severity === 'warning').length ?? 0

  function handlePublishClick() {
    if (status === 'blocked') return
    if (status === 'needs_review') {
      setShowModal(true)
      return
    }
    doPublish()
  }

  function doPublish() {
    setPublishState({ publishedAt: new Date().toISOString() })
    setShowModal(false)
  }

  if (publishState) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2.5 flex items-center gap-3">
        <span className="text-sm font-medium text-green-800">Register Published</span>
        <span className="text-xs text-green-700">
          {new Date(publishState.publishedAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
        <button
          type="button"
          onClick={() => setPublishState(null)}
          className="ml-auto text-xs text-green-700 hover:underline cursor-pointer"
        >
          Unpublish
        </button>
      </div>
    )
  }

  const containerClass =
    status === 'blocked'
      ? 'border-red-200 bg-red-50'
      : status === 'needs_review'
        ? 'border-amber-200 bg-amber-50'
        : 'border-green-200 bg-green-50'

  const titleClass =
    status === 'blocked'
      ? 'text-red-800'
      : status === 'needs_review'
        ? 'text-amber-800'
        : 'text-green-800'

  const subTextClass =
    status === 'blocked' ? 'text-red-600' : 'text-amber-600'

  const title =
    status === 'blocked'
      ? 'Blocked — Cannot Publish'
      : status === 'needs_review'
        ? 'Needs Review Before Publishing'
        : 'Ready to Publish'

  const buttonClass =
    status === 'blocked'
      ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
      : status === 'needs_review'
        ? 'border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200 cursor-pointer'
        : 'border-green-500 bg-green-600 text-white hover:bg-green-700 cursor-pointer'

  const hasIssues = criticalCount > 0 || warningCount > 0 || ingestionGradeReasons.length > 0

  const modalLines = buildModalLines(qaResult, ingestionGradeReasons)

  return (
    <>
      <div className={`rounded-md border px-4 py-2.5 ${containerClass}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-sm font-medium ${titleClass}`}>{title}</span>

            {/* Severity count pills */}
            {criticalCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                {warningCount} warning{warningCount === 1 ? '' : 's'}
              </span>
            )}
            {ingestionGradeReasons.length > 0 && (
              <span className="text-xs text-amber-700">
                {ingestionGradeReasons[0]}
              </span>
            )}

            {hasIssues && (
              <span className={`text-xs ${subTextClass}`}>
                · See QA details below
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handlePublishClick}
            disabled={status === 'blocked'}
            className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded border transition-colors ${buttonClass}`}
          >
            Publish Register
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-1">
              Publish With Open Issues?
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              These issues remain unresolved:
            </p>
            <ul className="mb-4 space-y-1.5 max-h-48 overflow-y-auto">
              {modalLines.map((line, i) => (
                <li key={i} className="text-sm text-amber-700 leading-snug">
                  · {line}
                </li>
              ))}
            </ul>
            <p className="text-sm text-gray-500 mb-5">
              You can still publish, but these should be addressed before distributing.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 cursor-pointer"
              >
                Go Back
              </button>
              <button
                type="button"
                onClick={doPublish}
                className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 cursor-pointer"
              >
                Publish Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
