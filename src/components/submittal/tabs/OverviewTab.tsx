'use client'

import { useMemo } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import { LifecycleSummary } from '../LifecycleSummary'
import { LifecycleBadge } from '../LifecycleBadge'
import { CoverageQACard } from '../CoverageQACard'
import { PublishReadinessBanner } from '../PublishReadinessBanner'
import { resolveEffectiveStatus, isOverdue } from '@/lib/chat/submittal-lifecycle'
import type { QAFindingType } from '@/lib/chat/submittal-coverage-qa'
import { evaluateSubmittalCoverageQA } from '@/lib/chat/submittal-coverage-qa'
import { evaluateRegisterPublishReadiness } from '@/lib/chat/submittal-publish-readiness'
import type { IngestionGrade } from '@/lib/eval/ingestion-types'

interface OverviewTabProps {
  items: SubmittalRegisterItem[]
  onSelectFindingType?: (type: QAFindingType) => void
  ingestionGrade?: IngestionGrade
  ingestionGradeReasons?: string[]
}

export function OverviewTab({ items, onSelectFindingType, ingestionGrade, ingestionGradeReasons }: OverviewTabProps) {
  const qaResult = useMemo(() => evaluateSubmittalCoverageQA({ items }), [items])

  const readiness = useMemo(
    () => evaluateRegisterPublishReadiness({ ingestionGrade, ingestionGradeReasons, qaResult }),
    [ingestionGrade, ingestionGradeReasons, qaResult],
  )

  const priorityItems = useMemo(() => {
    return items
      .filter(i => {
        const status = resolveEffectiveStatus(i)
        if (status === 'approved' || status === 'approved_as_noted' || status === 'closed') {
          return false
        }
        return isOverdue(i.lifecycleDueDate) || status === 'revise_resubmit'
      })
      .sort((a, b) => {
        const aOverdue = isOverdue(a.lifecycleDueDate) ? 0 : 1
        const bOverdue = isOverdue(b.lifecycleDueDate) ? 0 : 1
        if (aOverdue !== bOverdue) return aOverdue - bOverdue
        const aDate = a.lifecycleDueDate ?? ''
        const bDate = b.lifecycleDueDate ?? ''
        return aDate < bDate ? -1 : aDate > bDate ? 1 : 0
      })
  }, [items])

  const recentlyApproved = useMemo(() => {
    return items
      .filter(i => {
        const s = resolveEffectiveStatus(i)
        return s === 'approved' || s === 'approved_as_noted'
      })
      .sort((a, b) => {
        const aT = a.lifecycleApprovedAt ?? a.lifecycleSubmittedAt ?? ''
        const bT = b.lifecycleApprovedAt ?? b.lifecycleSubmittedAt ?? ''
        return aT > bT ? -1 : aT < bT ? 1 : 0
      })
      .slice(0, 10)
  }, [items])

  const longLeadRisks = useMemo(() => {
    return items
      .filter(i => i.lifecycleLongLeadFlag === true || (i.lifecycleLeadTimeDays ?? 0) > 0)
      .sort((a, b) => (b.lifecycleLeadTimeDays ?? 0) - (a.lifecycleLeadTimeDays ?? 0))
      .slice(0, 10)
  }, [items])

  const specCoverage = useMemo(() => {
    let specLinked = 0
    let missingSpec = 0
    let govtApproval = 0
    let blockingRisk = 0
    for (const item of items) {
      if (item.specSection) specLinked++
      else missingSpec++
      if (item.approvalAuthority === 'Government') govtApproval++
      if (item.blockingRisk === 'medium' || item.blockingRisk === 'high') blockingRisk++
    }
    return { specLinked, missingSpec, govtApproval, blockingRisk }
  }, [items])

  const workImpact = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const in14d = new Date(today)
    in14d.setDate(in14d.getDate() + 14)

    let blocksWork = 0
    let needByNext14d = 0
    let missingFOW = 0
    for (const item of items) {
      const effectiveBlocks =
        item.blocksWork === true || (item.blockingRisk === 'high' && !!item.activityNeedByDate)
      if (effectiveBlocks) blocksWork++
      if (item.activityNeedByDate) {
        const d = new Date(item.activityNeedByDate)
        if (d >= today && d <= in14d) needByNext14d++
      }
      const isRisky = item.blockingRisk === 'high' || item.blockingRisk === 'medium'
      if (isRisky && !item.relatedFOW && !item.scheduleActivity) missingFOW++
    }
    return { blocksWork, needByNext14d, missingFOW }
  }, [items])

  return (
    <div className="space-y-6">
      <PublishReadinessBanner readiness={readiness} />

      <LifecycleSummary items={items} />

      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Spec Coverage</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { label: 'Spec-linked', value: specCoverage.specLinked, warn: false },
            { label: 'Missing spec link', value: specCoverage.missingSpec, warn: true },
            { label: "Gov't approval required", value: specCoverage.govtApproval, warn: false },
            { label: 'Blocking risk', value: specCoverage.blockingRisk, warn: true },
          ] as const).map(({ label, value, warn }) => (
            <div key={label} className="text-center px-3 py-2 bg-white rounded border border-gray-200">
              <div className={`text-lg font-semibold tabular-nums ${warn && value > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                {value}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {(workImpact.blocksWork > 0 || workImpact.needByNext14d > 0 || workImpact.missingFOW > 0) && (
        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Work Impact</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { label: 'Blocks Work', value: workImpact.blocksWork, warn: true },
              { label: 'Need-by ≤ 14 days', value: workImpact.needByNext14d, warn: true },
              { label: 'Missing FOW linkage', value: workImpact.missingFOW, warn: true },
            ] as const).map(({ label, value, warn }) => (
              <div key={label} className="text-center px-3 py-2 bg-white rounded border border-gray-200">
                <div className={`text-lg font-semibold tabular-nums ${warn && value > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                  {value}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CoverageQACard items={items} onSelectFindingType={onSelectFindingType} />

      {/* High-Priority Action Queue */}
      <section>
        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          High-Priority Action Queue
        </h4>
        {priorityItems.length === 0 ? (
          <p className="text-sm text-gray-500">No overdue or revision-required items.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md overflow-hidden">
            {priorityItems.map((item, idx) => (
              <li key={item.persistedItemId ?? idx} className="flex items-center gap-3 px-4 py-3 bg-white">
                <LifecycleBadge
                  status={resolveEffectiveStatus(item)}
                  overdue={isOverdue(item.lifecycleDueDate)}
                  compact
                />
                <span className="flex-1 text-sm text-gray-900 truncate">{item.submittalItem}</span>
                {item.specSection && (
                  <span className="text-xs text-gray-500 shrink-0">{item.specSection}</span>
                )}
                {item.lifecycleDueDate && (
                  <span className={`text-xs shrink-0 ${isOverdue(item.lifecycleDueDate) ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    Due {item.lifecycleDueDate}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Recently Approved */}
        <section>
          <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Recently Approved
          </h4>
          {recentlyApproved.length === 0 ? (
            <p className="text-sm text-gray-500">No approved items yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md overflow-hidden">
              {recentlyApproved.map((item, idx) => (
                <li key={item.persistedItemId ?? idx} className="flex items-center gap-3 px-4 py-3 bg-white">
                  <LifecycleBadge status={resolveEffectiveStatus(item)} compact />
                  <span className="flex-1 text-sm text-gray-900 truncate">{item.submittalItem}</span>
                  {item.specSection && (
                    <span className="text-xs text-gray-500 shrink-0">{item.specSection}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Long-Lead Risks */}
        <section>
          <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Long-Lead Risks
          </h4>
          {longLeadRisks.length === 0 ? (
            <p className="text-sm text-gray-500">No long-lead items identified.</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md overflow-hidden">
              {longLeadRisks.map((item, idx) => {
                const weeks = item.lifecycleLeadTimeDays
                  ? Math.round(item.lifecycleLeadTimeDays / 7)
                  : null
                return (
                  <li key={item.persistedItemId ?? idx} className="flex items-center gap-3 px-4 py-3 bg-white">
                    {weeks !== null && (
                      <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                        {weeks}wk
                      </span>
                    )}
                    <span className="flex-1 text-sm text-gray-900 truncate">{item.submittalItem}</span>
                    {item.specSection && (
                      <span className="text-xs text-gray-500 shrink-0">{item.specSection}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
