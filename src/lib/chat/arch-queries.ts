/**
 * Arch Queries — Phase 4
 *
 * Read-only retrieval helpers for architectural discipline entities from the
 * universal entity model. Called by retrieval-orchestrator when answerMode is
 * 'arch_element_lookup', 'arch_room_scope', or 'arch_schedule_query'.
 *
 * All functions return failure-safe results (empty arrays, success=false)
 * rather than throwing — the retrieval-orchestrator falls through to
 * vector_search when no arch entities exist (sheets not yet processed).
 *
 * Entity graph tables are cast via `supabase as any` because project_entities
 * and related tables are not yet in the generated Supabase TypeScript types.
 *
 * Schedule linkage strategy:
 *   Tag normalization: UPPER(REGEXP_REPLACE(label, '[^A-Z0-9]', ''))
 *   This ensures "D-14" matches "D14", "d14", "D 14" regardless of how
 *   the extractor stored the label.
 *   Linkage is a two-step query:
 *     1. Find entity by normalized label
 *     2. Find schedule_entry via entity_relationships WHERE described_by
 */

import { createClient } from '@/lib/db/supabase/server'
import type {
  ArchEntity,
  ArchFinding,
  ArchScheduleEntry,
  ArchQueryResult,
  SupportLevel,
} from './types'

// ---------------------------------------------------------------------------
// Tag normalization
// ---------------------------------------------------------------------------

/** Normalize a drawing tag for comparison: uppercase, strip non-alphanumeric. */
function normalizeTag(tag: string): string {
  return tag.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toArchFinding(raw: any): ArchFinding {
  return {
    findingType:  raw.finding_type  ?? 'note',
    statement:    raw.statement     ?? '',
    supportLevel: (raw.support_level ?? 'unknown') as SupportLevel,
    textValue:    raw.text_value    ?? null,
    numericValue: raw.numeric_value ?? null,
    unit:         raw.unit          ?? null,
    confidence:   raw.confidence    ?? 0.5,
  }
}

function toArchEntity(raw: any, scheduleEntry: ArchScheduleEntry | null = null): ArchEntity {
  const locations: any[] = raw.entity_locations ?? []
  const primaryLoc = locations.find((l: any) => l.is_primary) ?? locations[0] ?? null

  const findings: ArchFinding[] = (raw.entity_findings ?? []).map(toArchFinding)

  return {
    id:            raw.id,
    entityType:    raw.entity_type,
    subtype:       raw.subtype       ?? null,
    canonicalName: raw.canonical_name,
    displayName:   raw.display_name  ?? raw.canonical_name,
    label:         raw.label         ?? null,
    status:        raw.status        ?? 'unknown',
    confidence:    raw.confidence    ?? 0.5,
    room:          primaryLoc?.room_number  ?? null,
    level:         primaryLoc?.level        ?? null,
    area:          primaryLoc?.area         ?? null,
    gridRef:       primaryLoc?.grid_ref     ?? null,
    sheetNumber:   primaryLoc?.sheet_number ?? null,
    findings,
    scheduleEntry,
  }
}

function toArchScheduleEntry(raw: any): ArchScheduleEntry {
  const findings: ArchFinding[] = (raw.entity_findings ?? []).map(toArchFinding)
  const locations: any[] = raw.entity_locations ?? []
  const primaryLoc = locations.find((l: any) => l.is_primary) ?? locations[0] ?? null

  return {
    id:           raw.id,
    tag:          raw.label        ?? raw.canonical_name,
    scheduleType: (raw.subtype     ?? 'door') as ArchScheduleEntry['scheduleType'],
    canonicalName: raw.canonical_name,
    displayName:  raw.display_name ?? raw.canonical_name,
    sheetNumber:  primaryLoc?.sheet_number ?? null,
    findings,
  }
}

function collectSheets(entities: ArchEntity[]): string[] {
  const sheets = new Set<string>()
  for (const e of entities) {
    if (e.sheetNumber) sheets.add(e.sheetNumber)
    if (e.scheduleEntry?.sheetNumber) sheets.add(e.scheduleEntry.sheetNumber)
  }
  return Array.from(sheets).sort()
}

function avgConfidence(entities: ArchEntity[]): number {
  if (entities.length === 0) return 0
  return Math.round(
    (entities.reduce((acc, e) => acc + e.confidence, 0) / entities.length) * 100
  ) / 100
}

function emptyArchResult(
  projectId: string,
  queryType: ArchQueryResult['queryType'],
  tag: string | null,
  roomFilter: string | null
): ArchQueryResult {
  return {
    success:        false,
    projectId,
    queryType,
    tag,
    roomFilter,
    entities:       [],
    rooms:          [],
    scheduleEntries:[],
    totalCount:     0,
    sheetsCited:    [],
    confidence:     0,
    formattedAnswer:
      'No architectural entities found. Architectural sheets may not yet have been processed.',
  }
}

/** ARCH entity select fragment reused across queries. */
const ARCH_SELECT = `
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
`

// ---------------------------------------------------------------------------
// Schedule entry lookup by entity ID (described_by relationship)
// ---------------------------------------------------------------------------

async function fetchScheduleEntryForEntity(
  db: any,
  entityId: string,
  projectId: string
): Promise<ArchScheduleEntry | null> {
  try {
    // Step 1: Find the described_by relationship
    const { data: relRows, error: relErr } = await db
      .from('entity_relationships')
      .select('to_entity_id')
      .eq('from_entity_id', entityId)
      .eq('project_id', projectId)
      .eq('relationship_type', 'described_by')
      .limit(1)

    if (relErr || !relRows || relRows.length === 0) return null

    const schedEntId = relRows[0].to_entity_id

    // Step 2: Fetch the schedule_entry entity with its findings
    const { data: schedRaw, error: schedErr } = await db
      .from('project_entities')
      .select(ARCH_SELECT)
      .eq('id', schedEntId)
      .eq('discipline', 'architectural')
      .eq('entity_type', 'schedule_entry')
      .single()

    if (schedErr || !schedRaw) return null

    return toArchScheduleEntry(schedRaw)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Public: queryArchElement
// ---------------------------------------------------------------------------

/**
 * Look up a single architectural entity by drawing tag.
 *
 * Tag matching is normalized: "D-14" matches "D14", "d14", "D 14".
 * When multiple entities match the same tag (rare), the one with the
 * highest confidence is returned.
 *
 * @param projectId   Supabase project UUID
 * @param tag         Drawing tag to look up (e.g. "D-14", "W-3A", "WT-A", "7")
 * @param tagType     Optional hint to narrow entity_type filter
 */
export async function queryArchElement(
  projectId: string,
  tag: string,
  tagType?: 'door' | 'window' | 'wall_type' | 'keynote' | null
): Promise<ArchQueryResult> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(`[Arch Queries] queryArchElement project=${projectId} tag=${tag} type=${tagType ?? 'any'}`)

  try {
    const tagNorm = normalizeTag(tag)

    let query = db
      .from('project_entities')
      .select(ARCH_SELECT)
      .eq('project_id', projectId)
      .eq('discipline', 'architectural')

    // Apply entity_type filter when tag type is known
    if (tagType === 'door')      query = query.eq('entity_type', 'door')
    if (tagType === 'window')    query = query.eq('entity_type', 'window')
    if (tagType === 'wall_type') query = query.eq('entity_type', 'wall')
    if (tagType === 'keynote')   query = query.eq('entity_type', 'keynote')

    const { data: rawEntities, error } = await query.limit(200)

    if (error) throw error
    if (!rawEntities || rawEntities.length === 0) {
      return emptyArchResult(projectId, 'element', tag, null)
    }

    // Normalize-and-match in TypeScript (avoids pg function calls in RLS context)
    const matched = (rawEntities as any[]).filter(
      r => r.label && normalizeTag(r.label) === tagNorm
    )

    if (matched.length === 0) {
      return emptyArchResult(projectId, 'element', tag, null)
    }

    // Pick highest-confidence match
    const best = matched.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]

    // Resolve schedule entry via described_by relationship
    const scheduleEntry = await fetchScheduleEntryForEntity(db, best.id, projectId)

    const entity = toArchEntity(best, scheduleEntry)
    const result: ArchQueryResult = {
      success:        true,
      projectId,
      queryType:      'element',
      tag,
      roomFilter:     null,
      entities:       [entity],
      rooms:          [],
      scheduleEntries: scheduleEntry ? [scheduleEntry] : [],
      totalCount:     1,
      sheetsCited:    collectSheets([entity]),
      confidence:     entity.confidence,
      formattedAnswer: '',
    }

    result.formattedAnswer = formatArchElementAnswer(result)
    return result
  } catch (err) {
    console.error('[Arch Queries] queryArchElement error:', err)
    return emptyArchResult(projectId, 'element', tag, null)
  }
}

// ---------------------------------------------------------------------------
// Public: queryArchRoom
// ---------------------------------------------------------------------------

/**
 * Return all architectural entities in a specific room (or all rooms).
 *
 * When roomNumber is null, returns all rooms and their contained elements.
 * Room filter is applied in TypeScript post-fetch (room_number lives in
 * the nested entity_locations table, same pattern as demo-queries.ts).
 *
 * @param projectId    Supabase project UUID
 * @param roomNumber   Room number to scope results (e.g. "105"). Null = all rooms.
 */
export async function queryArchRoom(
  projectId: string,
  roomNumber: string | null
): Promise<ArchQueryResult> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(`[Arch Queries] queryArchRoom project=${projectId} room=${roomNumber ?? 'all'}`)

  try {
    const { data: rawEntities, error } = await db
      .from('project_entities')
      .select(ARCH_SELECT)
      .eq('project_id', projectId)
      .eq('discipline', 'architectural')
      .limit(500)

    if (error) throw error
    if (!rawEntities || rawEntities.length === 0) {
      return emptyArchResult(projectId, 'room', null, roomNumber)
    }

    let entities: ArchEntity[] = (rawEntities as any[]).map(r => toArchEntity(r, null))

    // Apply room filter in TypeScript
    if (roomNumber) {
      const upper = roomNumber.toUpperCase()
      entities = entities.filter(e =>
        e.entityType === 'room'
          ? (e.label === upper || normalizeTag(e.label ?? '') === normalizeTag(upper))
          : e.room === upper
      )
    }

    if (entities.length === 0) {
      return emptyArchResult(projectId, 'room', null, roomNumber)
    }

    // Resolve schedule entries for doors and windows in batch
    // (one extra round-trip per door/window — acceptable for typical room counts)
    const resolved: ArchEntity[] = []
    for (const entity of entities) {
      if (entity.entityType === 'door' || entity.entityType === 'window') {
        const scheduleEntry = await fetchScheduleEntryForEntity(db, entity.id, projectId)
        resolved.push({ ...entity, scheduleEntry })
      } else {
        resolved.push(entity)
      }
    }

    const rooms     = resolved.filter(e => e.entityType === 'room')
    const nonRooms  = resolved.filter(e => e.entityType !== 'room')
    const schedEntries = resolved
      .map(e => e.scheduleEntry)
      .filter((s): s is ArchScheduleEntry => s !== null)

    const result: ArchQueryResult = {
      success:        true,
      projectId,
      queryType:      'room',
      tag:            null,
      roomFilter:     roomNumber,
      entities:       nonRooms,
      rooms,
      scheduleEntries: schedEntries,
      totalCount:     resolved.length,
      sheetsCited:    collectSheets(resolved),
      confidence:     avgConfidence(resolved),
      formattedAnswer: '',
    }

    result.formattedAnswer = formatArchRoomAnswer(result)
    return result
  } catch (err) {
    console.error('[Arch Queries] queryArchRoom error:', err)
    return emptyArchResult(projectId, 'room', null, roomNumber)
  }
}

// ---------------------------------------------------------------------------
// Public: queryArchSchedule
// ---------------------------------------------------------------------------

/**
 * Return schedule entries by type with optional tag filter.
 *
 * @param projectId     Supabase project UUID
 * @param scheduleType  'door' | 'window' | 'room_finish'
 * @param tag           Optional tag filter (e.g. "D-14"). Null = all entries.
 */
export async function queryArchSchedule(
  projectId: string,
  scheduleType: 'door' | 'window' | 'room_finish',
  tag?: string | null
): Promise<ArchScheduleEntry[]> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(`[Arch Queries] queryArchSchedule project=${projectId} type=${scheduleType} tag=${tag ?? 'all'}`)

  try {
    let query = db
      .from('project_entities')
      .select(ARCH_SELECT)
      .eq('project_id', projectId)
      .eq('discipline', 'architectural')
      .eq('entity_type', 'schedule_entry')
      .eq('subtype', scheduleType)

    const { data: rawRows, error } = await query

    if (error) throw error
    if (!rawRows || rawRows.length === 0) return []

    let entries: ArchScheduleEntry[] = (rawRows as any[]).map(toArchScheduleEntry)

    // Tag filter in TypeScript (normalized match)
    if (tag) {
      const norm = normalizeTag(tag)
      entries = entries.filter(e => normalizeTag(e.tag) === norm)
    }

    return entries
  } catch (err) {
    console.error('[Arch Queries] queryArchSchedule error:', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Public: queryArchKeynote
// ---------------------------------------------------------------------------

/**
 * Look up a keynote entity by its number.
 *
 * @param projectId      Supabase project UUID
 * @param keynoteNumber  The keynote number as a string (e.g. "7", "12")
 * @param sheetFilter    Optional sheet number to scope the search
 */
export async function queryArchKeynote(
  projectId: string,
  keynoteNumber: string,
  sheetFilter?: string | null
): Promise<ArchEntity | null> {
  const supabase = await createClient()
  const db = supabase as any

  try {
    const { data: rawRows, error } = await db
      .from('project_entities')
      .select(ARCH_SELECT)
      .eq('project_id', projectId)
      .eq('discipline', 'architectural')
      .eq('entity_type', 'keynote')

    if (error || !rawRows || rawRows.length === 0) return null

    const matched = (rawRows as any[]).filter(r => {
      const labelNum = (r.label ?? '').replace(/\D/g, '')
      if (labelNum !== keynoteNumber) return false
      if (sheetFilter) {
        const locations: any[] = r.entity_locations ?? []
        return locations.some((l: any) => l.sheet_number === sheetFilter)
      }
      return true
    })

    if (matched.length === 0) return null

    return toArchEntity(matched[0], null)
  } catch (err) {
    console.error('[Arch Queries] queryArchKeynote error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Public: formatArchElementAnswer
// ---------------------------------------------------------------------------

/**
 * Format a single-element ArchQueryResult as a structured context string for the LLM.
 */
export function formatArchElementAnswer(result: ArchQueryResult): string {
  if (!result.success || result.entities.length === 0) {
    return `No architectural entity found for tag "${result.tag}". Architectural sheets may not yet have been processed.`
  }

  const entity = result.entities[0]
  const parts: string[] = []

  const sheetsLabel = result.sheetsCited.length > 0
    ? `Architectural Drawing(s) (${result.sheetsCited.join(', ')})`
    : 'Architectural Drawings'

  parts.push(`Based on ${sheetsLabel}:\n`)
  parts.push(`${entity.entityType.toUpperCase()} ${entity.label ?? entity.displayName}:`)

  if (entity.room)      parts.push(`• Location: Room ${entity.room}${entity.gridRef ? `, Grid ${entity.gridRef}` : ''}`)
  if (entity.level)     parts.push(`• Level: ${entity.level}`)
  if (entity.subtype)   parts.push(`• Type: ${entity.subtype}`)
  if (entity.status && entity.status !== 'unknown') parts.push(`• Status: ${entity.status}`)

  // Dimension findings
  const dimFindings = entity.findings.filter(f => f.findingType === 'dimension')
  for (const f of dimFindings) {
    parts.push(`• ${f.statement}`)
  }

  // Material / finish findings
  const matFindings = entity.findings.filter(f => f.findingType === 'material')
  for (const f of matFindings) {
    parts.push(`• ${f.statement}`)
  }

  // Notes
  const noteFindings = entity.findings.filter(f => f.findingType === 'note')
  for (const f of noteFindings) {
    parts.push(`• Note: ${f.statement}`)
  }

  // Schedule entry details
  if (entity.scheduleEntry) {
    parts.push('')
    parts.push(`SCHEDULE (${entity.scheduleEntry.scheduleType.toUpperCase()}) — ${entity.scheduleEntry.displayName}:`)
    const schedRow = entity.scheduleEntry.findings.find(f => f.findingType === 'schedule_row')
    if (schedRow?.textValue) {
      // Each line of the schedule row on its own bullet
      schedRow.textValue.split('\n').filter(Boolean).forEach(l => parts.push(`• ${l.trim()}`))
    } else {
      // Fall back to individual findings
      for (const f of entity.scheduleEntry.findings) {
        parts.push(`• ${f.statement}`)
      }
    }
    if (entity.scheduleEntry.sheetNumber) {
      parts.push(`• Schedule Sheet: ${entity.scheduleEntry.sheetNumber}`)
    }
  }

  // Constraint findings at the end
  const constraintFindings = entity.findings.filter(f => f.findingType === 'constraint')
  if (constraintFindings.length > 0) {
    parts.push('')
    parts.push('CONSTRAINTS:')
    for (const f of constraintFindings) {
      parts.push(`• ${f.statement}`)
    }
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Public: formatArchRoomAnswer
// ---------------------------------------------------------------------------

/**
 * Format a room-scope ArchQueryResult as a structured context string for the LLM.
 */
export function formatArchRoomAnswer(result: ArchQueryResult): string {
  if (!result.success || (result.rooms.length === 0 && result.entities.length === 0)) {
    const label = result.roomFilter ? ` for Room ${result.roomFilter}` : ''
    return `No architectural entities found${label}. Architectural sheets may not yet have been processed.`
  }

  const parts: string[] = []
  const sheetsLabel = result.sheetsCited.length > 0
    ? `Architectural Drawing(s) (${result.sheetsCited.join(', ')})`
    : 'Architectural Drawings'

  parts.push(`Based on ${sheetsLabel}:\n`)

  const allRooms = result.rooms.length > 0 ? result.rooms : [null]

  for (const room of allRooms) {
    const roomLabel = room
      ? `ROOM ${room.label ?? room.displayName}${room.subtype ? ` — ${room.subtype.replace(/_/g, ' ').toUpperCase()}` : ''}`
      : result.roomFilter
        ? `ROOM ${result.roomFilter}`
        : 'ARCHITECTURAL ENTITIES'

    parts.push(roomLabel)

    // Elements in this room
    const roomNum = room?.label ?? result.roomFilter ?? null
    const inRoom = roomNum
      ? result.entities.filter(e => e.room === roomNum.toUpperCase())
      : result.entities

    // Doors
    const doors = inRoom.filter(e => e.entityType === 'door')
    if (doors.length > 0) {
      parts.push(`• Doors (${doors.length}): ${doors.map(d => formatEntityShort(d)).join(', ')}`)
    }

    // Windows
    const windows = inRoom.filter(e => e.entityType === 'window')
    if (windows.length > 0) {
      parts.push(`• Windows (${windows.length}): ${windows.map(w => formatEntityShort(w)).join(', ')}`)
    }

    // Wall types
    const walls = inRoom.filter(e => e.entityType === 'wall')
    if (walls.length > 0) {
      parts.push(`• Wall types: ${walls.map(w => w.label ?? w.displayName).join(', ')}`)
    }

    // Finish tags
    const finishes = inRoom.filter(e => e.entityType === 'finish_tag')
    if (finishes.length > 0) {
      const finishLine = finishes.map(f => {
        const mat = f.findings.find(fi => fi.findingType === 'material')
        return mat ? `${f.label}: ${mat.textValue ?? mat.statement}` : (f.label ?? f.displayName)
      }).join(' | ')
      parts.push(`• Finishes: ${finishLine}`)
    }

    // Room finish schedule entry
    const finishSched = result.scheduleEntries.find(
      s => s.scheduleType === 'room_finish' && normalizeTag(s.tag) === normalizeTag(roomNum ?? '')
    )
    if (finishSched) {
      const row = finishSched.findings.find(f => f.findingType === 'schedule_row')
      if (row?.textValue) {
        parts.push(`• Finish Schedule: ${row.textValue.replace(/\n/g, ' | ')}`)
      }
    }

    // Notes and keynotes in this room
    const notes = inRoom.filter(e => e.entityType === 'keynote' || e.entityType === 'note')
    if (notes.length > 0) {
      parts.push(`• Notes/Keynotes (${notes.length}):`)
      notes.forEach(n => {
        const text = n.findings.find(f => f.findingType === 'note')?.statement ?? n.displayName
        parts.push(`  — ${n.label ? `[${n.label}] ` : ''}${text}`)
      })
    }

    parts.push('')
  }

  if (result.rooms.length === 0 && result.entities.length === 0) {
    parts.push('No entities found.')
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Internal: short entity line for lists
// ---------------------------------------------------------------------------

function formatEntityShort(entity: ArchEntity): string {
  let s = entity.label ?? entity.displayName
  if (entity.scheduleEntry) {
    const row = entity.scheduleEntry.findings.find(f => f.findingType === 'schedule_row')
    const dim  = entity.scheduleEntry.findings.find(f => f.findingType === 'dimension')
    if (row?.textValue) {
      // Extract size from schedule row text (first parenthetical or dimension-looking string)
      const sizeMatch = row.textValue.match(/\d+['"\s-]+\d+\s*[×x]\s*\d+['"\s-]+\d+/)
      if (sizeMatch) s += ` (${sizeMatch[0]})`
    } else if (dim?.textValue) {
      s += ` (${dim.textValue})`
    }
    if (entity.scheduleEntry.findings.find(f => f.findingType === 'material')?.textValue) {
      const mat = entity.scheduleEntry.findings.find(f => f.findingType === 'material')!
      s += ` — ${mat.textValue}`
    }
  }
  return s
}
