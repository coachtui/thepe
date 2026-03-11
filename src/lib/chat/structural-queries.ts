/**
 * Structural Queries — Phase 5A
 *
 * Read-only retrieval helpers for structural discipline entities from the
 * universal entity model. Called by retrieval-orchestrator when answerMode
 * is 'struct_element_lookup' or 'struct_area_scope'.
 *
 * All functions return failure-safe results rather than throwing.
 * The retrieval-orchestrator falls through to vector_search when no
 * structural entities exist (sheets not yet processed).
 *
 * Entity graph tables are cast via `supabase as any` because project_entities
 * and related tables are not yet in the generated Supabase TypeScript types.
 */

import { createClient } from '@/lib/db/supabase/server'
import type { StructuralEntity, StructuralFinding, StructuralQueryResult, SupportLevel } from './types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Normalize a structural mark for comparison: uppercase, strip non-alphanumeric. */
function normalizeMark(mark: string): string {
  return mark.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Convert a raw project_entities DB row to StructuralEntity. */
function toStructuralEntity(raw: any): StructuralEntity {
  const locations: any[] = raw.entity_locations ?? []
  const primaryLoc = locations.find((l: any) => l.is_primary) ?? locations[0] ?? null

  const findings: StructuralFinding[] = (raw.entity_findings ?? []).map(
    (f: any): StructuralFinding => ({
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
    status:        raw.status       ?? 'unknown',
    confidence:    raw.confidence   ?? 0.5,
    room:          primaryLoc?.room_number ?? null,
    level:         primaryLoc?.level       ?? null,
    gridRef:       primaryLoc?.grid_ref    ?? null,
    area:          primaryLoc?.area        ?? null,
    sheetNumber:   primaryLoc?.sheet_number ?? null,
    findings,
  }
}

function collectSheets(entities: StructuralEntity[]): string[] {
  const sheets = new Set<string>()
  for (const e of entities) {
    if (e.sheetNumber) sheets.add(e.sheetNumber)
  }
  return Array.from(sheets).sort()
}

function avgConfidence(entities: StructuralEntity[]): number {
  if (entities.length === 0) return 0
  const sum = entities.reduce((acc, e) => acc + e.confidence, 0)
  return Math.round((sum / entities.length) * 100) / 100
}

function emptyStructuralResult(
  projectId: string,
  queryType: 'element' | 'area',
  mark?: string | null,
  gridFilter?: string | null,
  levelFilter?: string | null
): StructuralQueryResult {
  return {
    success:     false,
    projectId,
    queryType,
    mark:        mark        ?? null,
    gridFilter:  gridFilter  ?? null,
    levelFilter: levelFilter ?? null,
    entities:    [],
    totalCount:  0,
    sheetsCited: [],
    confidence:  0,
    formattedAnswer:
      'No structural entities found. Structural plan sheets (S-xxx) may not yet have been processed.',
  }
}

// ---------------------------------------------------------------------------
// Public: queryStructuralElement
// ---------------------------------------------------------------------------

/**
 * Query a structural entity by mark (label).
 *
 * @param projectId   Supabase project UUID
 * @param mark        Structural mark to look up (e.g. "F-1", "C-4", "W12×26")
 * @param entityType  Optional entity type hint to narrow the search
 */
export async function queryStructuralElement(
  projectId: string,
  mark: string,
  entityType?: 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line' | null
): Promise<StructuralQueryResult> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(
    `[Structural Queries] queryStructuralElement project=${projectId}` +
    ` mark=${mark} entityType=${entityType ?? 'any'}`
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
      .eq('discipline', 'structural')

    if (error) throw error
    if (!rawEntities || rawEntities.length === 0) {
      return emptyStructuralResult(projectId, 'element', mark)
    }

    const normMark = normalizeMark(mark)

    // Filter in TypeScript using normalized label matching (same pattern as arch tag)
    let entities: StructuralEntity[] = (rawEntities as any[])
      .map(toStructuralEntity)
      .filter((e: StructuralEntity) => e.label && normalizeMark(e.label) === normMark)

    // Apply optional entity_type filter
    if (entityType && entities.length > 1) {
      const typed = entities.filter(e => e.entityType === entityType)
      if (typed.length > 0) entities = typed
    }

    if (entities.length === 0) {
      return emptyStructuralResult(projectId, 'element', mark)
    }

    const sheetsCited = collectSheets(entities)
    const confidence  = avgConfidence(entities)

    const result: StructuralQueryResult = {
      success:     true,
      projectId,
      queryType:   'element',
      mark,
      gridFilter:  null,
      levelFilter: null,
      entities,
      totalCount:  entities.length,
      sheetsCited,
      confidence,
      formattedAnswer: '',
    }

    result.formattedAnswer = formatStructuralElementAnswer(result)
    return result
  } catch (err) {
    console.error('[Structural Queries] queryStructuralElement error:', err)
    return emptyStructuralResult(projectId, 'element', mark)
  }
}

// ---------------------------------------------------------------------------
// Public: queryStructuralByArea
// ---------------------------------------------------------------------------

/**
 * Query all structural entities for a project, optionally filtered by
 * grid reference and/or level.
 *
 * @param projectId  Supabase project UUID
 * @param gridRef    Grid reference to filter on (e.g. "A-3"). Null = all grids.
 * @param level      Level to filter on (e.g. "L1"). Null = all levels.
 */
export async function queryStructuralByArea(
  projectId: string,
  gridRef?: string | null,
  level?: string | null
): Promise<StructuralQueryResult> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(
    `[Structural Queries] queryStructuralByArea project=${projectId}` +
    ` grid=${gridRef ?? 'all'} level=${level ?? 'all'}`
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
      .eq('discipline', 'structural')

    if (error) throw error
    if (!rawEntities || rawEntities.length === 0) {
      return emptyStructuralResult(projectId, 'area', null, gridRef, level)
    }

    let entities: StructuralEntity[] = (rawEntities as any[]).map(toStructuralEntity)

    // Apply filters in TypeScript (location data is in nested array)
    if (level) {
      const normLevel = level.toUpperCase()
      entities = entities.filter(e => e.level && e.level.toUpperCase() === normLevel)
    }
    if (gridRef) {
      const normGrid = gridRef.toUpperCase().replace(/[^A-Z0-9/]/g, '')
      entities = entities.filter(e =>
        e.gridRef && e.gridRef.toUpperCase().replace(/[^A-Z0-9/]/g, '').includes(normGrid)
      )
    }

    if (entities.length === 0) {
      return emptyStructuralResult(projectId, 'area', null, gridRef, level)
    }

    const sheetsCited = collectSheets(entities)
    const confidence  = avgConfidence(entities)

    const result: StructuralQueryResult = {
      success:     true,
      projectId,
      queryType:   'area',
      mark:        null,
      gridFilter:  gridRef   ?? null,
      levelFilter: level     ?? null,
      entities,
      totalCount:  entities.length,
      sheetsCited,
      confidence,
      formattedAnswer: '',
    }

    result.formattedAnswer = formatStructuralAreaAnswer(result)
    return result
  } catch (err) {
    console.error('[Structural Queries] queryStructuralByArea error:', err)
    return emptyStructuralResult(projectId, 'area', null, gridRef, level)
  }
}

// ---------------------------------------------------------------------------
// Public: formatStructuralElementAnswer
// ---------------------------------------------------------------------------

export function formatStructuralElementAnswer(result: StructuralQueryResult): string {
  if (!result.success || result.entities.length === 0) {
    return `No structural entity found for mark "${result.mark}". Structural sheets may not have been processed.`
  }

  const parts: string[] = []
  const sheetsLabel =
    result.sheetsCited.length > 0
      ? `Structural Plans (${result.sheetsCited.join(', ')})`
      : 'Structural Plans'

  parts.push(`Based on ${sheetsLabel}:\n`)

  for (const e of result.entities.slice(0, 5)) {
    parts.push(formatStructuralEntityBlock(e))
    parts.push('')
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Public: formatStructuralAreaAnswer
// ---------------------------------------------------------------------------

export function formatStructuralAreaAnswer(result: StructuralQueryResult): string {
  if (!result.success || result.entities.length === 0) {
    const scope = result.levelFilter
      ? ` on Level ${result.levelFilter}`
      : result.gridFilter ? ` at Grid ${result.gridFilter}` : ''
    return `No structural entities found${scope}. Structural sheets may not have been processed.`
  }

  const parts: string[] = []
  const scope = result.levelFilter
    ? ` on Level ${result.levelFilter}`
    : result.gridFilter ? ` at Grid ${result.gridFilter}` : ' (all levels)'

  const sheetsLabel =
    result.sheetsCited.length > 0
      ? `Structural Plans (${result.sheetsCited.join(', ')})`
      : 'Structural Plans'

  parts.push(`Based on ${sheetsLabel}:\n`)
  parts.push(`STRUCTURAL ELEMENTS${scope} (${result.totalCount}):\n`)

  // Group by entity_type
  const byType = new Map<string, StructuralEntity[]>()
  for (const e of result.entities) {
    const arr = byType.get(e.entityType) ?? []
    arr.push(e)
    byType.set(e.entityType, arr)
  }

  const typeOrder = ['footing', 'column', 'beam', 'foundation_wall', 'slab_edge', 'structural_opening', 'grid_line', 'structural_note']
  const orderedTypes = [...typeOrder.filter(t => byType.has(t)), ...Array.from(byType.keys()).filter(t => !typeOrder.includes(t))]

  for (const entityType of orderedTypes) {
    const group = byType.get(entityType)!
    const label = entityType.replace(/_/g, ' ').toUpperCase()
    parts.push(`${label} (${group.length}):`)
    for (const e of group.slice(0, 8)) {
      parts.push(formatStructuralEntityLine(e))
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

function formatStructuralEntityBlock(entity: StructuralEntity): string {
  const lines: string[] = []
  const typeLabel = entity.entityType.replace(/_/g, ' ').toUpperCase()

  lines.push(`${typeLabel}: ${entity.displayName}${entity.label ? ` (Mark: ${entity.label})` : ''}`)

  if (entity.level)   lines.push(`  Level: ${entity.level}`)
  if (entity.gridRef) lines.push(`  Grid:  ${entity.gridRef}`)
  if (entity.room)    lines.push(`  Room:  ${entity.room}`)
  if (entity.status && entity.status !== 'unknown') lines.push(`  Status: ${entity.status}`)

  for (const f of entity.findings.slice(0, 4)) {
    const prefix = f.findingType === 'load_bearing' ? '  ⚠ ' : '  • '
    lines.push(`${prefix}${f.statement}`)
  }

  return lines.join('\n')
}

function formatStructuralEntityLine(entity: StructuralEntity): string {
  let line = `  • ${entity.displayName}`
  if (entity.label && entity.label !== entity.displayName) line += ` (${entity.label})`
  if (entity.gridRef) line += ` — Grid ${entity.gridRef}`
  if (entity.level)   line += ` — Level ${entity.level}`

  const dim = entity.findings.find(f => f.findingType === 'dimension')
  const mat = entity.findings.find(f => f.findingType === 'material')
  if (dim?.statement) line += `. ${dim.statement}`
  else if (mat?.statement) line += `. ${mat.statement}`

  return line
}
