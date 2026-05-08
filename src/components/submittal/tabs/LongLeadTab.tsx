'use client'

import { useMemo } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import { LifecycleBadge } from '../LifecycleBadge'
import { LifecycleControls } from '../LifecycleControls'
import { resolveEffectiveStatus, isOverdue } from '@/lib/chat/submittal-lifecycle'

interface LongLeadTabProps {
  projectId: string
  items: SubmittalRegisterItem[]
  onPatchItem: (itemId: string, updates: Partial<SubmittalRegisterItem>) => void
}

type RiskLevel = 'critical' | 'high' | 'moderate' | 'ordered'

function deriveRisk(item: SubmittalRegisterItem): RiskLevel {
  const status = resolveEffectiveStatus(item)
  if (status === 'approved' || status === 'approved_as_noted' || status === 'closed') {
    return 'ordered'
  }
  const days = item.lifecycleLeadTimeDays ?? 0
  if (days >= 140) return 'critical' // ≥ 20 weeks
  if (days >= 84) return 'high'      // ≥ 12 weeks
  return 'moderate'
}

const RISK_CLASSES: Record<RiskLevel, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-amber-100 text-amber-800',
  moderate: 'bg-blue-100 text-blue-800',
  ordered: 'bg-green-100 text-green-800',
}

const RISK_LABELS: Record<RiskLevel, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  ordered: 'Ordered',
}

export function LongLeadTab({ projectId, items, onPatchItem }: LongLeadTabProps) {
  const longLeadItems = useMemo(() => {
    return items
      .filter(
        i =>
          i.lifecycleLongLeadFlag === true ||
          (i.lifecycleLeadTimeDays != null && i.lifecycleLeadTimeDays > 0)
      )
      .sort((a, b) => (b.lifecycleLeadTimeDays ?? 0) - (a.lifecycleLeadTimeDays ?? 0))
  }, [items])

  if (longLeadItems.length === 0) {
    return <p className="text-sm text-gray-500 py-4">No long-lead items identified.</p>
  }

  return (
    <div className="space-y-3">
      {longLeadItems.map((item, idx) => {
        const id = item.persistedItemId ?? String(idx)
        const weeks = item.lifecycleLeadTimeDays
          ? Math.round(item.lifecycleLeadTimeDays / 7)
          : null
        const risk = deriveRisk(item)
        const overdue = isOverdue(item.lifecycleDueDate)

        return (
          <div key={id} className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {item.submittalItem}
                </p>
                {item.specSection && (
                  <p className="text-xs text-gray-500 mt-0.5">{item.specSection}</p>
                )}
              </div>
              {weeks !== null && (
                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                  {weeks}wk
                </span>
              )}
              <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${RISK_CLASSES[risk]}`}>
                {RISK_LABELS[risk]}
              </span>
              <LifecycleBadge
                status={resolveEffectiveStatus(item)}
                overdue={overdue}
                compact
              />
              {item.lifecycleDueDate && (
                <span className={`text-xs shrink-0 ${overdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                  Due {item.lifecycleDueDate}
                </span>
              )}
            </div>

            {item.persistedItemId && (
              <LifecycleControls
                item={item}
                projectId={projectId}
                onTransitioned={updates => onPatchItem(item.persistedItemId!, updates)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
