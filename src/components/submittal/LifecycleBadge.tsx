import type { SubmittalLifecycleStatus } from '@/lib/chat/submittal-lifecycle'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/chat/submittal-lifecycle'

interface LifecycleBadgeProps {
  status: SubmittalLifecycleStatus
  overdue?: boolean
  compact?: boolean
}

export function LifecycleBadge({ status, overdue, compact }: LifecycleBadgeProps) {
  const label = STATUS_LABELS[status]
  const colors = STATUS_COLORS[status]

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
      {!compact && overdue && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="Overdue" />
      )}
      {label}
      {compact && overdue && (
        <span className="text-red-600 font-bold leading-none">!</span>
      )}
    </span>
  )
}
