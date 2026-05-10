'use client'

import { useMemo } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import {
  evaluateSubmittalCoverageQA,
  type QAFindingType,
  type QASeverity,
} from '@/lib/chat/submittal-coverage-qa'

interface CoverageQACardProps {
  items: SubmittalRegisterItem[]
  onSelectFindingType?: (type: QAFindingType) => void
}

const SEVERITY_BADGE: Record<QASeverity, string> = {
  critical: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-800',
  info: 'bg-gray-100 text-gray-600',
}

const SEVERITY_LABEL: Record<QASeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
}

export function CoverageQACard({ items, onSelectFindingType }: CoverageQACardProps) {
  const result = useMemo(() => evaluateSubmittalCoverageQA({ items }), [items])

  const counts = useMemo(
    () => ({
      critical: result.findings.filter(f => f.severity === 'critical').length,
      warning: result.findings.filter(f => f.severity === 'warning').length,
      info: result.findings.filter(f => f.severity === 'info').length,
    }),
    [result.findings],
  )

  const headerBadgeClass =
    counts.critical > 0
      ? 'bg-red-100 text-red-800'
      : counts.warning > 0
        ? 'bg-amber-100 text-amber-800'
        : result.findings.length === 0
          ? 'bg-green-100 text-green-800'
          : 'bg-gray-100 text-gray-600'

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Coverage QA</p>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${headerBadgeClass}`}>
          {result.findings.length === 0
            ? 'All clear'
            : `${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {result.findings.length === 0 ? (
        <p className="text-xs text-gray-500">No QA issues found across {result.totalItems} items.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {counts.critical > 0 && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                {counts.critical} critical
              </span>
            )}
            {counts.warning > 0 && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                {counts.warning} warning{counts.warning === 1 ? '' : 's'}
              </span>
            )}
            {counts.info > 0 && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                {counts.info} info
              </span>
            )}
          </div>

          <ul className="space-y-2">
            {result.findings.slice(0, 5).map(finding => (
              <li key={finding.id} className="flex items-start gap-2">
                <span
                  className={`shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${SEVERITY_BADGE[finding.severity]}`}
                >
                  {SEVERITY_LABEL[finding.severity]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-900">{finding.message}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{finding.suggestedAction}</p>
                </div>
                {onSelectFindingType && finding.type !== 'spec_section_no_submittals' && finding.affectedItemIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectFindingType(finding.type)}
                    className="shrink-0 text-xs text-indigo-600 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    Show in Register →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
