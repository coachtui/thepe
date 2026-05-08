import { useMemo } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import { resolveEffectiveStatus, isOverdue } from '@/lib/chat/submittal-lifecycle'

interface LifecycleSummaryProps {
  items: SubmittalRegisterItem[]
}

interface StatCardProps {
  label: string
  value: number
  highlight?: 'warn' | 'ok' | 'alert'
}

function StatCard({ label, value, highlight }: StatCardProps) {
  const valueClass =
    highlight === 'alert' && value > 0
      ? 'text-red-700'
      : highlight === 'warn' && value > 0
      ? 'text-amber-700'
      : highlight === 'ok' && value > 0
      ? 'text-green-700'
      : 'text-gray-900'

  return (
    <div className="text-center px-3 py-2 bg-white rounded border border-gray-200">
      <div className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5 whitespace-nowrap">{label}</div>
    </div>
  )
}

export function LifecycleSummary({ items }: LifecycleSummaryProps) {
  const stats = useMemo(() => {
    let pendingReview = 0
    let revisionRequired = 0
    let longLead = 0
    let approved = 0
    let overdue = 0

    for (const item of items) {
      const status = resolveEffectiveStatus(item)
      if (status === 'pending_review') pendingReview++
      if (status === 'revise_resubmit') revisionRequired++
      if (item.lifecycleLongLeadFlag) longLead++
      if (status === 'approved' || status === 'approved_as_noted') approved++
      if (isOverdue(item.lifecycleDueDate)) overdue++
    }

    return { total: items.length, pendingReview, revisionRequired, longLead, approved, overdue }
  }, [items])

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        Lifecycle Overview
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Pending Review" value={stats.pendingReview} highlight="warn" />
        <StatCard label="Revision Required" value={stats.revisionRequired} highlight="alert" />
        <StatCard label="Long Lead" value={stats.longLead} highlight="warn" />
        <StatCard label="Approved" value={stats.approved} highlight="ok" />
        <StatCard label="Overdue" value={stats.overdue} highlight="alert" />
      </div>
    </div>
  )
}
