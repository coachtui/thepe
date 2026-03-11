/**
 * Coordination Queries — Phase 5B
 *
 * Cross-discipline retrieval helpers that anchor on room_number and level
 * from entity_locations to answer "what trades touch this room?" style questions.
 *
 * Design principles:
 *   - No geometry. Coordination is room/level text-anchor based only.
 *   - Results are grouped by discipline in TypeScript post-fetch.
 *   - No clash detection. This is count-by-discipline-per-location.
 *   - All disciplines are queried in a single DB call for efficiency.
 *
 * Entity graph tables are cast via `supabase as any` because project_entities
 * and related tables are not yet in the generated Supabase TypeScript types.
 */

import { createClient } from '@/lib/db/supabase/server'
import { classifyMEPTrade } from './mep-queries'
import type { CoordinationQueryResult, TradePresence } from './types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a discipline + entity_type combination to a display trade name.
 * MEP discipline is further split by entity_type classification.
 */
function toTradeName(discipline: string, entityType: string): string {
  if (discipline === 'mep') return classifyMEPTrade(entityType)
  return discipline
}

function emptyCoordinationResult(
  projectId: string,
  roomFilter?: string | null,
  levelFilter?: string | null
): CoordinationQueryResult {
  return {
    success:              false,
    projectId,
    roomFilter:           roomFilter  ?? null,
    levelFilter:          levelFilter ?? null,
    tradesPresent:        [],
    coordinationNotes:    [],
    totalDisciplineCount: 0,
    confidence:           0,
    formattedAnswer:
      'No entities found for the specified location. Sheets may not yet have been processed for all disciplines.',
  }
}

// ---------------------------------------------------------------------------
// Core cross-discipline query
// ---------------------------------------------------------------------------

/**
 * Fetch all entities in a room/level across all disciplines.
 * Returns raw rows for further processing.
 */
async function fetchEntitiesInLocation(
  projectId: string,
  roomFilter: string | null,
  levelFilter: string | null,
  db: any
): Promise<any[]> {
  const { data: rows, error } = await db
    .from('project_entities')
    .select(`
      id,
      discipline,
      entity_type,
      label,
      status,
      confidence,
      entity_locations ( room_number, level, sheet_number, is_primary ),
      entity_findings ( finding_type, statement, support_level, confidence )
    `)
    .eq('project_id', projectId)

  if (error || !rows) return []

  // Filter by location in TypeScript (entity_locations is a nested array)
  return rows.filter((row: any) => {
    const locs: any[] = row.entity_locations ?? []
    return locs.some((l: any) => {
      const roomMatch  = !roomFilter  || (l.room_number && l.room_number.toUpperCase() === roomFilter.toUpperCase())
      const levelMatch = !levelFilter || (l.level && l.level.toUpperCase() === levelFilter.toUpperCase())
      return roomMatch && levelMatch
    })
  })
}

/**
 * Build TradePresence array from raw entity rows.
 */
function buildTradePresence(rows: any[]): TradePresence[] {
  // Map: tradeName → { entityCount, entityTypes (Set), labels (first 3), sheets (Set) }
  const tradeMap = new Map<string, {
    count: number
    entityTypes: Set<string>
    labels: string[]
    sheets: Set<string>
  }>()

  for (const row of rows) {
    const trade = toTradeName(row.discipline, row.entity_type)
    if (!tradeMap.has(trade)) {
      tradeMap.set(trade, { count: 0, entityTypes: new Set(), labels: [], sheets: new Set() })
    }
    const entry = tradeMap.get(trade)!
    entry.count++
    entry.entityTypes.add(row.entity_type)
    if (row.label && entry.labels.length < 3) entry.labels.push(row.label)

    const locs: any[] = row.entity_locations ?? []
    for (const l of locs) {
      if (l.sheet_number) entry.sheets.add(l.sheet_number)
    }
  }

  const tradeOrder = ['architectural', 'structural', 'electrical', 'mechanical', 'plumbing', 'demo', 'utility', 'unknown']
  const sorted = Array.from(tradeMap.entries()).sort(([a], [b]) => {
    const ai = tradeOrder.indexOf(a)
    const bi = tradeOrder.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  return sorted.map(([trade, data]) => ({
    trade,
    entityCount:          data.count,
    entityTypes:          Array.from(data.entityTypes),
    representativeLabels: data.labels,
    sheetsCited:          Array.from(data.sheets).sort(),
  }))
}

/**
 * Extract coordination_note findings from raw entity rows.
 */
function extractCoordinationNotes(rows: any[]): string[] {
  const notes: string[] = []
  for (const row of rows) {
    const findings: any[] = row.entity_findings ?? []
    for (const f of findings) {
      if (f.finding_type === 'coordination_note' && f.statement) {
        notes.push(f.statement as string)
      }
    }
  }
  return notes
}

function avgConfidenceFromRows(rows: any[]): number {
  if (rows.length === 0) return 0
  const sum = rows.reduce((acc: number, r: any) => acc + (r.confidence ?? 0.5), 0)
  return Math.round((sum / rows.length) * 100) / 100
}

// ---------------------------------------------------------------------------
// Public: queryTradesInRoom
// ---------------------------------------------------------------------------

/**
 * Return all disciplines present in a specific room.
 * Groups by trade and returns representative entity data.
 *
 * @param projectId   Supabase project UUID
 * @param roomNumber  Room number (e.g. "105")
 */
export async function queryTradesInRoom(
  projectId: string,
  roomNumber: string
): Promise<CoordinationQueryResult> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(`[Coordination Queries] queryTradesInRoom project=${projectId} room=${roomNumber}`)

  try {
    const rows = await fetchEntitiesInLocation(projectId, roomNumber, null, db)

    if (rows.length === 0) {
      return emptyCoordinationResult(projectId, roomNumber, null)
    }

    const tradesPresent       = buildTradePresence(rows)
    const coordinationNotes   = extractCoordinationNotes(rows)
    const confidence          = avgConfidenceFromRows(rows)

    const result: CoordinationQueryResult = {
      success:              true,
      projectId,
      roomFilter:           roomNumber,
      levelFilter:          null,
      tradesPresent,
      coordinationNotes,
      totalDisciplineCount: tradesPresent.length,
      confidence,
      formattedAnswer:      '',
    }

    result.formattedAnswer = formatTradeCoordinationAnswer(result)
    return result
  } catch (err) {
    console.error('[Coordination Queries] queryTradesInRoom error:', err)
    return emptyCoordinationResult(projectId, roomNumber, null)
  }
}

// ---------------------------------------------------------------------------
// Public: queryCoordinationConstraints
// ---------------------------------------------------------------------------

/**
 * Return entities with explicit coordination_note findings, plus the
 * to_remain/to_protect demo entities that constrain work in a room/level.
 *
 * Used for "what could hold this work up?" queries.
 *
 * @param projectId   Supabase project UUID
 * @param roomFilter  Optional room number. Null = all rooms.
 * @param levelFilter Optional level. Null = all levels.
 */
export async function queryCoordinationConstraints(
  projectId: string,
  roomFilter?: string | null,
  levelFilter?: string | null
): Promise<CoordinationQueryResult> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(
    `[Coordination Queries] queryCoordinationConstraints project=${projectId}` +
    ` room=${roomFilter ?? 'all'} level=${levelFilter ?? 'all'}`
  )

  try {
    const allRows = await fetchEntitiesInLocation(projectId, roomFilter ?? null, levelFilter ?? null, db)

    if (allRows.length === 0) {
      return emptyCoordinationResult(projectId, roomFilter, levelFilter)
    }

    // Surface entities with coordination_note findings OR demo to_remain/to_protect
    const constraintRows = allRows.filter((row: any) => {
      const hasCoordNote = (row.entity_findings ?? []).some(
        (f: any) => f.finding_type === 'coordination_note'
      )
      const isDemoConstraint =
        row.discipline === 'demo' &&
        (row.status === 'to_remain' || row.status === 'to_protect')
      return hasCoordNote || isDemoConstraint
    })

    // Build trade presence from ALL rows (for complete context)
    const tradesPresent     = buildTradePresence(allRows)
    const coordinationNotes = extractCoordinationNotes(allRows)
    const confidence        = avgConfidenceFromRows(constraintRows.length > 0 ? constraintRows : allRows)

    const result: CoordinationQueryResult = {
      success:              true,
      projectId,
      roomFilter:           roomFilter  ?? null,
      levelFilter:          levelFilter ?? null,
      tradesPresent,
      coordinationNotes,
      totalDisciplineCount: tradesPresent.length,
      confidence,
      formattedAnswer:      '',
    }

    result.formattedAnswer = formatCoordinationSequenceAnswer(result, allRows)
    return result
  } catch (err) {
    console.error('[Coordination Queries] queryCoordinationConstraints error:', err)
    return emptyCoordinationResult(projectId, roomFilter, levelFilter)
  }
}

// ---------------------------------------------------------------------------
// Public: queryAffectedArea
// ---------------------------------------------------------------------------

/**
 * Return all disciplines present in a room or level — the "what's affected" view.
 *
 * @param projectId   Supabase project UUID
 * @param roomFilter  Optional room number. Null = no room filter.
 * @param levelFilter Optional level. Null = no level filter.
 */
export async function queryAffectedArea(
  projectId: string,
  roomFilter?: string | null,
  levelFilter?: string | null
): Promise<CoordinationQueryResult> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(
    `[Coordination Queries] queryAffectedArea project=${projectId}` +
    ` room=${roomFilter ?? 'all'} level=${levelFilter ?? 'all'}`
  )

  try {
    const rows = await fetchEntitiesInLocation(projectId, roomFilter ?? null, levelFilter ?? null, db)

    if (rows.length === 0) {
      return emptyCoordinationResult(projectId, roomFilter, levelFilter)
    }

    const tradesPresent     = buildTradePresence(rows)
    const coordinationNotes = extractCoordinationNotes(rows)
    const confidence        = avgConfidenceFromRows(rows)

    const result: CoordinationQueryResult = {
      success:              true,
      projectId,
      roomFilter:           roomFilter  ?? null,
      levelFilter:          levelFilter ?? null,
      tradesPresent,
      coordinationNotes,
      totalDisciplineCount: tradesPresent.length,
      confidence,
      formattedAnswer:      '',
    }

    result.formattedAnswer = formatAffectedAreaAnswer(result)
    return result
  } catch (err) {
    console.error('[Coordination Queries] queryAffectedArea error:', err)
    return emptyCoordinationResult(projectId, roomFilter, levelFilter)
  }
}

// ---------------------------------------------------------------------------
// Public: formatters
// ---------------------------------------------------------------------------

export function formatTradeCoordinationAnswer(result: CoordinationQueryResult): string {
  if (!result.success || result.tradesPresent.length === 0) {
    const scope = result.roomFilter ? ` in Room ${result.roomFilter}` : ''
    return `No entities found${scope}. Sheets may not yet have been processed for all disciplines.`
  }

  const parts: string[] = []
  const scope = result.roomFilter ? ` — Room ${result.roomFilter}` : ''
  parts.push(`DISCIPLINES IN SCOPE${scope} (${result.totalDisciplineCount}):\n`)

  for (const t of result.tradesPresent) {
    const labels = t.representativeLabels.length > 0
      ? ` — e.g. ${t.representativeLabels.join(', ')}`
      : ''
    const types  = t.entityTypes.slice(0, 3).join(', ')
    const sheets = t.sheetsCited.length > 0 ? ` [${t.sheetsCited.join(', ')}]` : ''
    parts.push(`${t.trade.toUpperCase()} (${t.entityCount} entities)${labels}`)
    parts.push(`  Types: ${types}${sheets}`)
  }

  if (result.coordinationNotes.length > 0) {
    parts.push('\nCOORDINATION NOTES (explicit from drawings):')
    result.coordinationNotes.forEach(n => parts.push(`• ${n}`))
  }

  return parts.join('\n')
}

export function formatCoordinationSequenceAnswer(
  result: CoordinationQueryResult,
  allRows?: any[]
): string {
  if (!result.success || result.tradesPresent.length === 0) {
    return 'No entities found for the specified location. Sheets may not yet have been processed.'
  }

  const parts: string[] = []
  const scope = result.roomFilter ? ` in Room ${result.roomFilter}`
    : result.levelFilter ? ` on Level ${result.levelFilter}` : ''

  parts.push(`COORDINATION DATA${scope}:\n`)
  parts.push(`DISCIPLINES PRESENT: ${result.tradesPresent.map(t => t.trade.toUpperCase()).join(', ')}\n`)

  // Surface demo constraints (to_remain, to_protect) from allRows when available
  if (allRows) {
    const demoConstraints = allRows.filter((r: any) =>
      r.discipline === 'demo' &&
      (r.status === 'to_remain' || r.status === 'to_protect')
    )

    if (demoConstraints.length > 0) {
      parts.push('ITEMS TO REMAIN / PROTECT (explicit from demo plans):')
      for (const r of demoConstraints.slice(0, 5)) {
        const label = r.label ?? r.canonical_name ?? r.entity_type
        const locs: any[] = r.entity_locations ?? []
        const loc = locs[0]?.room_number ? ` — Room ${locs[0].room_number}` : ''
        parts.push(`• ${label}: ${r.status.replace('_', ' ')}${loc}`)
      }
      parts.push('')
    }
  }

  if (result.coordinationNotes.length > 0) {
    parts.push('EXPLICIT COORDINATION NOTES (from drawings):')
    result.coordinationNotes.forEach(n => parts.push(`• ${n}`))
    parts.push('')
  }

  return parts.join('\n')
}

export function formatAffectedAreaAnswer(result: CoordinationQueryResult): string {
  if (!result.success || result.tradesPresent.length === 0) {
    const scope = result.levelFilter ? ` on Level ${result.levelFilter}` : ''
    return `No entities found${scope}. Sheets may not yet have been processed for all disciplines.`
  }

  const parts: string[] = []
  const scope = result.levelFilter
    ? ` on Level ${result.levelFilter}`
    : result.roomFilter ? ` in Room ${result.roomFilter}` : ''

  parts.push(`AFFECTED AREA${scope} — DISCIPLINES PRESENT (${result.totalDisciplineCount}):\n`)

  for (const t of result.tradesPresent) {
    const labels = t.representativeLabels.length > 0
      ? `: ${t.representativeLabels.join(', ')}`
      : ''
    const sheets = t.sheetsCited.length > 0 ? ` [${t.sheetsCited.join(', ')}]` : ''
    parts.push(`${t.trade.toUpperCase()} — ${t.entityCount} entities${labels}${sheets}`)
    parts.push(`  Entity types: ${t.entityTypes.join(', ')}`)
  }

  if (result.coordinationNotes.length > 0) {
    parts.push('\nCOORDINATION NOTES (explicit):')
    result.coordinationNotes.forEach(n => parts.push(`• ${n}`))
  }

  return parts.join('\n')
}
