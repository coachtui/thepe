/**
 * MEP Queries — Phase 5A
 *
 * Read-only retrieval helpers for MEP discipline entities from the universal
 * entity model. Called by retrieval-orchestrator when answerMode is
 * 'mep_element_lookup' or 'mep_area_scope'.
 *
 * Trade (electrical / mechanical / plumbing) is derived from entity_type
 * at query time — there is no separate discipline column for this distinction.
 * All MEP entities use discipline = 'mep'.
 *
 * Entity graph tables are cast via `supabase as any` because project_entities
 * and related tables are not yet in the generated Supabase TypeScript types.
 */

import { createClient } from '@/lib/db/supabase/server'
import type { MEPEntity, MEPFinding, MEPQueryResult, MEPScheduleEntry, SupportLevel } from './types'

// ---------------------------------------------------------------------------
// Trade classification — derived from entity_type
// ---------------------------------------------------------------------------

const ELECTRICAL_ENTITY_TYPES = new Set([
  'panel', 'transformer', 'electrical_fixture', 'conduit', 'schedule_entry',
])

const MECHANICAL_ENTITY_TYPES = new Set([
  'air_handler', 'vav_box', 'diffuser', 'duct_run', 'mechanical_equipment',
])

const PLUMBING_ENTITY_TYPES = new Set([
  'plumbing_fixture', 'floor_drain', 'cleanout', 'piping_segment', 'plumbing_equipment',
])

/**
 * Classify the trade from entity_type.
 * This is the single source of truth — not stored in the DB.
 */
export function classifyMEPTrade(
  entityType: string
): 'electrical' | 'mechanical' | 'plumbing' | 'unknown' {
  if (ELECTRICAL_ENTITY_TYPES.has(entityType)) return 'electrical'
  if (MECHANICAL_ENTITY_TYPES.has(entityType)) return 'mechanical'
  if (PLUMBING_ENTITY_TYPES.has(entityType))   return 'plumbing'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Normalize an equipment tag for comparison: uppercase, strip non-alphanumeric. */
function normalizeTag(tag: string): string {
  return tag.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Convert a raw project_entities DB row to MEPEntity. */
function toMEPEntity(raw: any): MEPEntity {
  const locations: any[] = raw.entity_locations ?? []
  const primaryLoc = locations.find((l: any) => l.is_primary) ?? locations[0] ?? null

  const findings: MEPFinding[] = (raw.entity_findings ?? []).map(
    (f: any): MEPFinding => ({
      findingType:  f.finding_type  ?? 'note',
      statement:    f.statement     ?? '',
      supportLevel: (f.support_level ?? 'unknown') as SupportLevel,
      textValue:    f.text_value    ?? null,
      numericValue: f.numeric_value ?? null,
      unit:         f.unit          ?? null,
      confidence:   f.confidence    ?? 0.5,
    })
  )

  return {
    id:            raw.id,
    entityType:    raw.entity_type,
    subtype:       raw.subtype      ?? null,
    canonicalName: raw.canonical_name,
    displayName:   raw.display_name ?? raw.canonical_name,
    label:         raw.label        ?? null,
    trade:         classifyMEPTrade(raw.entity_type),
    status:        raw.status       ?? 'unknown',
    confidence:    raw.confidence   ?? 0.5,
    room:          primaryLoc?.room_number ?? null,
    level:         primaryLoc?.level       ?? null,
    area:          primaryLoc?.area        ?? null,
    gridRef:       primaryLoc?.grid_ref    ?? null,
    sheetNumber:   primaryLoc?.sheet_number ?? null,
    findings,
    scheduleEntry: null,  // filled by fetchScheduleEntryForMEPEntity when needed
  }
}

function collectSheets(entities: MEPEntity[]): string[] {
  const sheets = new Set<string>()
  for (const e of entities) {
    if (e.sheetNumber) sheets.add(e.sheetNumber)
  }
  return Array.from(sheets).sort()
}

function avgConfidence(entities: MEPEntity[]): number {
  if (entities.length === 0) return 0
  const sum = entities.reduce((acc, e) => acc + e.confidence, 0)
  return Math.round((sum / entities.length) * 100) / 100
}

function emptyMEPResult(
  projectId: string,
  queryType: 'element' | 'area',
  tag?: string | null,
  roomFilter?: string | null,
  levelFilter?: string | null,
  disciplineFilter?: 'electrical' | 'mechanical' | 'plumbing' | null
): MEPQueryResult {
  return {
    success:          false,
    projectId,
    queryType,
    tag:              tag              ?? null,
    roomFilter:       roomFilter       ?? null,
    levelFilter:      levelFilter      ?? null,
    disciplineFilter: disciplineFilter ?? null,
    entities:         [],
    totalCount:       0,
    sheetsCited:      [],
    confidence:       0,
    formattedAnswer:
      'No MEP entities found. Mechanical (M-xxx), electrical (E-xxx), or plumbing (P-xxx) sheets may not yet have been processed.',
  }
}

// ---------------------------------------------------------------------------
// Public: fetchScheduleEntryForMEPEntity
// ---------------------------------------------------------------------------

/**
 * Fetch the schedule_entry linked to a MEP entity via the 'described_by'
 * relationship. Returns null when no schedule linkage exists.
 *
 * Same two-step pattern as arch-queries.fetchScheduleEntryForEntity().
 */
async function fetchScheduleEntryForMEPEntity(
  projectId: string,
  entityId: string,
  db: any
): Promise<MEPScheduleEntry | null> {
  try {
    // Step 1: find the described_by relationship
    const { data: relRows, error: relError } = await db
      .from('entity_relationships')
      .select('to_entity_id')
      .eq('project_id', projectId)
      .eq('from_entity_id', entityId)
      .eq('relationship_type', 'described_by')
      .limit(1)

    if (relError || !relRows || relRows.length === 0) return null

    const scheduleEntityId: string = relRows[0].to_entity_id

    // Step 2: fetch the schedule_entry entity with its findings
    const { data: schedRow, error: schedError } = await db
      .from('project_entities')
      .select(`
        id,
        entity_type,
        subtype,
        canonical_name,
        display_name,
        label,
        entity_locations ( sheet_number, is_primary ),
        entity_findings ( finding_type, statement, support_level, text_value, numeric_value, unit, confidence )
      `)
      .eq('id', scheduleEntityId)
      .eq('project_id', projectId)
      .single()

    if (schedError || !schedRow) return null

    const locs: any[] = schedRow.entity_locations ?? []
    const sheetNumber = (locs.find((l: any) => l.is_primary) ?? locs[0])?.sheet_number ?? null

    const findings: MEPFinding[] = (schedRow.entity_findings ?? []).map(
      (f: any): MEPFinding => ({
        findingType:  f.finding_type  ?? 'schedule_row',
        statement:    f.statement     ?? '',
        supportLevel: 'explicit' as SupportLevel,
        textValue:    f.text_value    ?? null,
        numericValue: f.numeric_value ?? null,
        unit:         f.unit          ?? null,
        confidence:   f.confidence    ?? 0.85,
      })
    )

    // Determine schedule type from entity subtype
    const scheduleType: MEPScheduleEntry['scheduleType'] =
      schedRow.subtype === 'plumbing_fixture_schedule' ? 'plumbing_fixture' :
      schedRow.subtype === 'equipment_schedule'        ? 'equipment'        :
      'panel'

    return {
      id:           schedRow.id,
      tag:          schedRow.label         ?? '',
      scheduleType,
      canonicalName: schedRow.canonical_name,
      displayName:   schedRow.display_name ?? schedRow.canonical_name,
      sheetNumber,
      findings,
    }
  } catch (err) {
    console.error('[MEP Queries] fetchScheduleEntryForMEPEntity error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Public: queryMEPElement
// ---------------------------------------------------------------------------

/**
 * Query a MEP entity by equipment tag (label).
 *
 * @param projectId   Supabase project UUID
 * @param tag         Equipment tag to look up (e.g. "LP-1", "AHU-1", "WC-3")
 * @param discipline  Optional discipline hint to narrow the search
 */
export async function queryMEPElement(
  projectId: string,
  tag: string,
  discipline?: 'electrical' | 'mechanical' | 'plumbing' | null
): Promise<MEPQueryResult> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(
    `[MEP Queries] queryMEPElement project=${projectId}` +
    ` tag=${tag} discipline=${discipline ?? 'any'}`
  )

  try {
    const { data: rawEntities, error } = await db
      .from('project_entities')
      .select(`
        id,
        entity_type,
        subtype,
        canonical_name,
        display_name,
        label,
        status,
        confidence,
        entity_locations ( room_number, level, area, grid_ref, sheet_number, is_primary ),
        entity_findings ( finding_type, statement, support_level, text_value, numeric_value, unit, confidence )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'mep')

    if (error) throw error
    if (!rawEntities || rawEntities.length === 0) {
      return emptyMEPResult(projectId, 'element', tag, null, null, discipline)
    }

    const normTag = normalizeTag(tag)

    // Filter by normalized label + optional discipline
    let entities: MEPEntity[] = (rawEntities as any[])
      .map(toMEPEntity)
      .filter((e: MEPEntity) => e.label && normalizeTag(e.label) === normTag)

    if (discipline && entities.length > 1) {
      const tradeFiltered = entities.filter(e => e.trade === discipline)
      if (tradeFiltered.length > 0) entities = tradeFiltered
    }

    if (entities.length === 0) {
      return emptyMEPResult(projectId, 'element', tag, null, null, discipline)
    }

    // Fetch schedule entry for the first entity (most common case: single result)
    if (entities[0].entityType !== 'schedule_entry') {
      entities[0].scheduleEntry = await fetchScheduleEntryForMEPEntity(
        projectId, entities[0].id, db
      )
    }

    const sheetsCited = collectSheets(entities)
    const confidence  = avgConfidence(entities)

    const result: MEPQueryResult = {
      success:          true,
      projectId,
      queryType:        'element',
      tag,
      roomFilter:       null,
      levelFilter:      null,
      disciplineFilter: discipline ?? null,
      entities,
      totalCount:       entities.length,
      sheetsCited,
      confidence,
      formattedAnswer:  '',
    }

    result.formattedAnswer = formatMEPElementAnswer(result)
    return result
  } catch (err) {
    console.error('[MEP Queries] queryMEPElement error:', err)
    return emptyMEPResult(projectId, 'element', tag, null, null, discipline)
  }
}

// ---------------------------------------------------------------------------
// Public: queryMEPByArea
// ---------------------------------------------------------------------------

/**
 * Query all MEP entities for a project, filtered by room, level, and/or discipline.
 *
 * @param projectId       Supabase project UUID
 * @param roomFilter      Room number to scope results (e.g. "105"). Null = all rooms.
 * @param levelFilter     Level to filter on (e.g. "L1"). Null = all levels.
 * @param disciplineFilter  Trade to filter on. Null = all trades.
 */
export async function queryMEPByArea(
  projectId: string,
  roomFilter?: string | null,
  levelFilter?: string | null,
  disciplineFilter?: 'electrical' | 'mechanical' | 'plumbing' | null
): Promise<MEPQueryResult> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(
    `[MEP Queries] queryMEPByArea project=${projectId}` +
    ` room=${roomFilter ?? 'all'} level=${levelFilter ?? 'all'}` +
    ` discipline=${disciplineFilter ?? 'all'}`
  )

  try {
    const { data: rawEntities, error } = await db
      .from('project_entities')
      .select(`
        id,
        entity_type,
        subtype,
        canonical_name,
        display_name,
        label,
        status,
        confidence,
        entity_locations ( room_number, level, area, grid_ref, sheet_number, is_primary ),
        entity_findings ( finding_type, statement, support_level, text_value, numeric_value, unit, confidence )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'mep')

    if (error) throw error
    if (!rawEntities || rawEntities.length === 0) {
      return emptyMEPResult(projectId, 'area', null, roomFilter, levelFilter, disciplineFilter)
    }

    let entities: MEPEntity[] = (rawEntities as any[]).map(toMEPEntity)

    // Apply location filters in TypeScript
    if (roomFilter) {
      const upper = roomFilter.toUpperCase()
      entities = entities.filter(e => e.room === upper)
    }
    if (levelFilter) {
      const upper = levelFilter.toUpperCase()
      entities = entities.filter(e => e.level && e.level.toUpperCase() === upper)
    }
    if (disciplineFilter) {
      entities = entities.filter(e => e.trade === disciplineFilter)
    }

    if (entities.length === 0) {
      return emptyMEPResult(projectId, 'area', null, roomFilter, levelFilter, disciplineFilter)
    }

    const sheetsCited = collectSheets(entities)
    const confidence  = avgConfidence(entities)

    const result: MEPQueryResult = {
      success:          true,
      projectId,
      queryType:        'area',
      tag:              null,
      roomFilter:       roomFilter       ?? null,
      levelFilter:      levelFilter      ?? null,
      disciplineFilter: disciplineFilter ?? null,
      entities,
      totalCount:       entities.length,
      sheetsCited,
      confidence,
      formattedAnswer:  '',
    }

    result.formattedAnswer = formatMEPAreaAnswer(result)
    return result
  } catch (err) {
    console.error('[MEP Queries] queryMEPByArea error:', err)
    return emptyMEPResult(projectId, 'area', null, roomFilter, levelFilter, disciplineFilter)
  }
}

// ---------------------------------------------------------------------------
// Public: formatMEPElementAnswer
// ---------------------------------------------------------------------------

export function formatMEPElementAnswer(result: MEPQueryResult): string {
  if (!result.success || result.entities.length === 0) {
    return `No MEP entity found for tag "${result.tag}". MEP sheets may not have been processed.`
  }

  const parts: string[] = []
  const sheetsLabel =
    result.sheetsCited.length > 0
      ? `MEP Plans (${result.sheetsCited.join(', ')})`
      : 'MEP Plans'

  parts.push(`Based on ${sheetsLabel}:\n`)

  for (const e of result.entities.slice(0, 3)) {
    parts.push(formatMEPEntityBlock(e))
    parts.push('')
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Public: formatMEPAreaAnswer
// ---------------------------------------------------------------------------

export function formatMEPAreaAnswer(result: MEPQueryResult): string {
  if (!result.success || result.entities.length === 0) {
    const scope = result.roomFilter
      ? ` in Room ${result.roomFilter}`
      : result.levelFilter ? ` on Level ${result.levelFilter}` : ''
    return `No MEP entities found${scope}. MEP sheets may not have been processed.`
  }

  const parts: string[] = []
  const scope = result.roomFilter
    ? ` in Room ${result.roomFilter}`
    : result.levelFilter ? ` on Level ${result.levelFilter}` : ''

  const sheetsLabel =
    result.sheetsCited.length > 0
      ? `MEP Plans (${result.sheetsCited.join(', ')})`
      : 'MEP Plans'

  parts.push(`Based on ${sheetsLabel}:\n`)
  parts.push(`MEP ENTITIES${scope} (${result.totalCount}):\n`)

  // Group by trade
  const byTrade = new Map<string, MEPEntity[]>()
  for (const e of result.entities) {
    const arr = byTrade.get(e.trade) ?? []
    arr.push(e)
    byTrade.set(e.trade, arr)
  }

  const tradeOrder = ['electrical', 'mechanical', 'plumbing', 'unknown']
  for (const trade of tradeOrder) {
    const group = byTrade.get(trade)
    if (!group || group.length === 0) continue

    parts.push(`${trade.toUpperCase()} (${group.length}):`)
    for (const e of group.slice(0, 8)) {
      parts.push(formatMEPEntityLine(e))
    }
    if (group.length > 8) {
      parts.push(`  ... and ${group.length - 8} more`)
    }
    parts.push('')
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Internal: entity formatters
// ---------------------------------------------------------------------------

function formatMEPEntityBlock(entity: MEPEntity): string {
  const lines: string[] = []
  const typeLabel = entity.entityType.replace(/_/g, ' ').toUpperCase()

  lines.push(`${typeLabel}: ${entity.displayName}${entity.label ? ` (Tag: ${entity.label})` : ''}`)
  lines.push(`  Trade: ${entity.trade.toUpperCase()}`)

  if (entity.level)   lines.push(`  Level: ${entity.level}`)
  if (entity.room)    lines.push(`  Room:  ${entity.room}`)
  if (entity.status && entity.status !== 'unknown') lines.push(`  Status: ${entity.status}`)

  for (const f of entity.findings.slice(0, 5)) {
    lines.push(`  • [${f.findingType}] ${f.statement}`)
  }

  if (entity.scheduleEntry) {
    lines.push(`\n  Schedule: ${entity.scheduleEntry.displayName}`)
    for (const f of entity.scheduleEntry.findings.slice(0, 3)) {
      lines.push(`    • ${f.statement}`)
    }
  }

  return lines.join('\n')
}

function formatMEPEntityLine(entity: MEPEntity): string {
  let line = `  • ${entity.displayName}`
  if (entity.label && entity.label !== entity.displayName) line += ` (${entity.label})`
  if (entity.room)  line += ` — Room ${entity.room}`
  if (entity.level && !entity.room) line += ` — Level ${entity.level}`

  const cap = entity.findings.find(f => f.findingType === 'capacity')
  const equip = entity.findings.find(f => f.findingType === 'equipment_tag')
  if (cap?.statement) line += `. ${cap.statement}`
  else if (equip?.statement) line += `. ${equip.statement}`

  return line
}
