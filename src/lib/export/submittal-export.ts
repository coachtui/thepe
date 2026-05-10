import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import {
  evaluateSubmittalCoverageQA,
  getSubmittalItemKey,
} from '@/lib/chat/submittal-coverage-qa'

// Flat record of string values — one row per submittal item.
// Format-agnostic: used by XLSX today, reusable for PDF/CSV later.
export type ExportRow = Record<string, string>

// Column display order for consistent sheet layout.
export const EXPORT_COLUMNS: { key: string; width: number }[] = [
  // A — Identification
  { key: 'Spec Section',        width: 12 },
  { key: 'Section Title',       width: 24 },
  { key: 'Submittal Item',      width: 48 },
  { key: 'Submittal Type',      width: 20 },
  { key: 'SD Code',             width: 8  },
  { key: 'Approval Required',   width: 14 },
  { key: 'Approval Authority',  width: 18 },
  // B — Review
  { key: 'Review Status',       width: 16 },
  { key: 'Review Notes',        width: 32 },
  { key: 'Reviewed At',         width: 16 },
  { key: 'Reviewed By',         width: 14 },
  // C — Lifecycle
  { key: 'Lifecycle Status',    width: 18 },
  { key: 'Due Date',            width: 12 },
  { key: 'Responsible Party',   width: 20 },
  { key: 'Submitted At',        width: 16 },
  { key: 'Approved At',         width: 16 },
  { key: 'Lead Time (days)',    width: 13 },
  { key: 'Long Lead',           width: 9  },
  // D — Work Impact
  { key: 'Feature of Work',     width: 24 },
  { key: 'Schedule Activity',   width: 24 },
  { key: 'Need-by Date',        width: 12 },
  { key: 'Blocks Work',         width: 10 },
  { key: 'Blocking Risk',       width: 12 },
  // E — Source Trace
  { key: 'Source Page',         width: 10 },
  { key: 'Source Excerpt',      width: 48 },
  { key: 'Document',            width: 26 },
  // F — QA
  { key: 'QA Findings',         width: 38 },
  { key: 'Confidence',          width: 10 },
  { key: 'Source Quality',      width: 13 },
  { key: 'Notes',               width: 32 },
  // G — Extraction Provenance
  { key: 'Extraction Source',        width: 16 },
  { key: 'Extraction Confidence',    width: 18 },
  { key: 'Extraction Source Reason', width: 52 },
]

const QA_LABEL: Record<string, string> = {
  missing_sd_code:                    'Missing SD code',
  missing_approval_authority:         'Missing authority',
  blocking_risk_no_due_date:          'No due date',
  blocking_risk_missing_work_linkage: 'Missing FOW/activity',
  missing_source_excerpt:             'Missing excerpt',
  duplicate_submittal:                    'Duplicate',
  cross_section_duplicate_submittal:      'Cross-section duplicate',
  conditional_approval_authority:         'Conditional authority',
  spec_section_no_submittals:             'No submittals in section',
  low_extraction_confidence:              'Low extraction confidence',
}

function str(v: string | number | null | undefined): string {
  return v != null ? String(v) : ''
}

function bool(v: boolean | null | undefined): string {
  return v == null ? '' : v ? 'Yes' : 'No'
}

export function buildExportRows(items: SubmittalRegisterItem[]): ExportRow[] {
  if (items.length === 0) return []

  const { findings } = evaluateSubmittalCoverageQA({ items })

  // Map itemKey → QA finding labels for that item
  const findingMap = new Map<string, string[]>()
  for (const f of findings) {
    for (const id of f.affectedItemIds) {
      const arr = findingMap.get(id) ?? []
      arr.push(QA_LABEL[f.type] ?? f.type)
      findingMap.set(id, arr)
    }
  }

  return items.map((item, i) => {
    const key = getSubmittalItemKey(item, i)
    const qaFindings = (findingMap.get(key) ?? []).join(' | ')

    const effectiveBlocksWork =
      item.blocksWork === true ||
      (item.blockingRisk === 'high' && !!item.activityNeedByDate)

    return {
      // A — Identification
      'Spec Section':       str(item.specSection),
      'Section Title':      str(item.sectionTitle),
      'Submittal Item':     str(item.submittalItem),
      'Submittal Type':     str(item.submittalType),
      'SD Code':            str(item.sdCode),
      'Approval Required':  bool(item.approvalRequired),
      'Approval Authority': str(item.approvalAuthority),

      // B — Review
      'Review Status':  str(item.reviewStatus ?? 'pending'),
      'Review Notes':   str(item.reviewNotes),
      'Reviewed At':    str(item.reviewedAt),
      'Reviewed By':    str(item.reviewedByRole),

      // C — Lifecycle
      'Lifecycle Status':  str(item.lifecycleStatus ?? 'draft'),
      'Due Date':          str(item.lifecycleDueDate),
      'Responsible Party': str(item.lifecycleResponsibleParty),
      'Submitted At':      str(item.lifecycleSubmittedAt),
      'Approved At':       str(item.lifecycleApprovedAt),
      'Lead Time (days)':  str(item.lifecycleLeadTimeDays),
      'Long Lead':         bool(item.lifecycleLongLeadFlag),

      // D — Work Impact
      'Feature of Work':   str(item.relatedFOW),
      'Schedule Activity': str(item.scheduleActivity),
      'Need-by Date':      str(item.activityNeedByDate),
      'Blocks Work':       bool(effectiveBlocksWork),
      'Blocking Risk':     str(item.blockingRisk),

      // E — Source Trace
      'Source Page':    str(item.sourcePage),
      'Source Excerpt': str(item.sourceExcerpt ?? item.excerpt),
      'Document':       str(item.sourceReference?.documentName ?? item.sourceReference?.filename),

      // F — QA
      'QA Findings':   qaFindings,
      'Confidence':    item.confidence != null ? `${Math.round(item.confidence * 100)}%` : '',
      'Source Quality': str(item.sourceQuality),
      'Notes':          str(item.notes),

      // G — Extraction Provenance
      'Extraction Source':
        item.extractionSource ?? '',
      'Extraction Confidence':
        item.extractionConfidence != null
          ? `${Math.round(item.extractionConfidence * 100)}%`
          : '',
      'Extraction Source Reason':
        item.extractionSourceReason ?? '',
    }
  })
}
