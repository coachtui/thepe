/**
 * Sheet Indexer — Phase 2 document intelligence layer.
 *
 * Populates document_pages and sheet_entities tables from vision analysis
 * results. Called from the Inngest vision-process-document function after
 * each page is analyzed.
 *
 * document_pages  — one row per PDF page with normalized sheet metadata
 * sheet_entities  — one row per detected entity per page
 *
 * This creates the fast lookup layer used by the chat query router to:
 *   - Find which pages mention Water Line B without scanning all chunks
 *   - Answer "which sheets contain sewer" in a single query
 *   - Quickly locate which pages have plan vs. profile views
 *   - Select candidate sheets for pre-answer verification (Phase 1)
 */

import { createServiceRoleClient } from '@/lib/db/supabase/service'
import type { VisionAnalysisResult } from '@/lib/vision/claude-vision'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SheetIndexInput {
  documentId: string
  projectId: string
  pageNumber: number
  visionResult: VisionAnalysisResult
  textContent?: string
}

export interface SheetIndexResult {
  documentPageId: string | null
  entityCount: number
  success: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Extract utility type keywords from a designation or title */
function extractUtilityTypes(text: string): string[] {
  const types: string[] = []
  const t = text.toLowerCase()
  if (/water|domestic|potable|irrigation/i.test(t)) types.push('water')
  if (/sewer|sanitary|waste/i.test(t)) types.push('sewer')
  if (/storm|drainage|culvert|inlet/i.test(t)) types.push('storm')
  if (/gas|natural gas/i.test(t)) types.push('gas')
  if (/electric|power|conduit|duct bank/i.test(t)) types.push('electrical')
  if (/telecom|fiber|comm|telephone/i.test(t)) types.push('telecom')
  return [...new Set(types)]
}

/** Detect sheet type from title and raw classification */
function resolveSheetType(
  title: string | undefined,
  rawType: string | undefined
): string {
  const t = (title || '').toLowerCase()
  const r = (rawType || '').toLowerCase()

  if (/plan\s*and\s*profile|plan\/profile|plan&profile/.test(t)) return 'plan'
  if (/^plan/.test(t) || r === 'plan') return 'plan'
  if (/profile/.test(t) || r === 'profile') return 'profile'
  if (/detail/.test(t) || r === 'detail') return 'detail'
  if (/section/.test(t) || r === 'section') return 'section'
  if (/legend|symbol/.test(t) || r === 'legend') return 'legend'
  if (/note|general note/.test(t) || r === 'notes') return 'notes'
  if (/title|cover/.test(t) || r === 'title') return 'title'
  if (/schedule|index|list/.test(t)) return 'schedule'
  if (/summary/.test(t) || r === 'summary') return 'summary'
  return 'unknown'
}

/** Normalise a station string to a numeric value for range queries */
function parseStationNumeric(station: string | undefined): number | null {
  if (!station) return null
  const m = station.trim().match(/^(\d{1,3})\+(\d{2}(?:\.\d{1,2})?)$/)
  if (!m) return null
  return parseFloat(m[1]) * 100 + parseFloat(m[2])
}

/** Deduplicate an array of strings */
function unique(arr: (string | undefined | null)[]): string[] {
  return [...new Set(arr.filter((s): s is string => !!s && s.trim().length > 0))]
}

// ---------------------------------------------------------------------------
// Entity extraction from VisionAnalysisResult
// ---------------------------------------------------------------------------

interface RawEntity {
  entityType: string
  entityValue: string
  entityContext: string
  confidence: number
}

function extractEntitiesFromVision(result: VisionAnalysisResult): RawEntity[] {
  const entities: RawEntity[] = []

  // Termination points → utility designations + stations
  for (const tp of result.terminationPoints ?? []) {
    if (tp.utilityName) {
      entities.push({
        entityType: 'utility_designation',
        entityValue: tp.utilityName,
        entityContext: `${tp.terminationType} at ${tp.station ?? 'unknown station'}`,
        confidence: tp.confidence ?? 0.9,
      })
    }
    if (tp.station) {
      entities.push({
        entityType: 'station',
        entityValue: tp.station,
        entityContext: `${tp.terminationType} for ${tp.utilityName}`,
        confidence: tp.confidence ?? 0.9,
      })
    }
  }

  // Quantities → component labels and sizes
  for (const qty of result.quantities ?? []) {
    if (!qty.itemName) continue

    // Extract size if present (e.g. "12-IN GATE VALVE" → "12-IN")
    const sizeMatch = qty.itemName.match(/(\d+["-]?\s*(?:IN|INCH|DIP|PVC|HDPE|RCP|VCP|CMP))/i)
    if (sizeMatch) {
      entities.push({
        entityType: 'pipe_size',
        entityValue: sizeMatch[1].toUpperCase(),
        entityContext: qty.itemName,
        confidence: qty.confidence ?? 0.85,
      })
    }

    // Determine if this is a utility designation or a component
    if (/(water\s*line|sewer|storm\s*drain|waterline|ss\s*line)/i.test(qty.itemName)) {
      entities.push({
        entityType: 'utility_designation',
        entityValue: qty.itemName,
        entityContext: qty.description ?? '',
        confidence: qty.confidence ?? 0.85,
      })
    } else {
      entities.push({
        entityType: 'equipment_label',
        entityValue: qty.itemName,
        entityContext: qty.description ?? '',
        confidence: qty.confidence ?? 0.8,
      })
    }
  }

  // Utility crossings → crossing utility labels
  for (const cx of (result as VisionAnalysisResult & { utilityCrossings?: Array<{ crossingUtility?: string; utilityFullName?: string; station?: string; confidence?: number }> }).utilityCrossings ?? []) {
    if (cx.crossingUtility) {
      entities.push({
        entityType: 'utility_designation',
        entityValue: cx.utilityFullName ?? cx.crossingUtility,
        entityContext: `Crosses at station ${cx.station ?? 'unknown'}`,
        confidence: cx.confidence ?? 0.8,
      })
    }
  }

  // Spatial info → stations
  const spatialInfo = (result as VisionAnalysisResult & { spatialInfo?: { stationRange?: { start?: string; end?: string } } }).spatialInfo
  if (spatialInfo?.stationRange?.start) {
    entities.push({
      entityType: 'station',
      entityValue: spatialInfo.stationRange.start,
      entityContext: 'Station range start',
      confidence: 0.95,
    })
  }
  if (spatialInfo?.stationRange?.end) {
    entities.push({
      entityType: 'station',
      entityValue: spatialInfo.stationRange.end,
      entityContext: 'Station range end',
      confidence: 0.95,
    })
  }

  return entities
}

/** Derive utility designations from entities */
function deriveUtilityDesignations(entities: RawEntity[]): string[] {
  return unique(
    entities
      .filter(e => e.entityType === 'utility_designation')
      .map(e => e.entityValue)
  )
}

/** Derive utility types from designations and sheet title */
function deriveUtilityTypes(designations: string[], sheetTitle: string): string[] {
  const all: string[] = []
  for (const d of designations) all.push(...extractUtilityTypes(d))
  all.push(...extractUtilityTypes(sheetTitle))
  return unique(all)
}

/** Derive discipline from sheet type/title/utilities */
function deriveDisciplines(sheetType: string, sheetTitle: string, utilities: string[]): string[] {
  const disciplines: string[] = []
  const t = sheetTitle.toLowerCase()

  if (utilities.length > 0 || /utility|water|sewer|storm|gas/i.test(t)) disciplines.push('civil')
  if (/structural|footing|column|beam|rebar|concrete/i.test(t)) disciplines.push('structural')
  if (/arch|floor plan|elevation|section|building|room/i.test(t)) disciplines.push('architectural')
  if (/mep|electrical|mechanical|plumbing|hvac/i.test(t)) disciplines.push('mep')
  if (/demo|demolish|removal/i.test(t)) disciplines.push('demo')
  if (/landscape|planting|irrigation/i.test(t)) disciplines.push('landscape')
  if (disciplines.length === 0) disciplines.push('general')
  return unique(disciplines)
}

// ---------------------------------------------------------------------------
// Main indexing function
// ---------------------------------------------------------------------------

/**
 * Index one PDF page into document_pages + sheet_entities.
 *
 * Idempotent: uses UPSERT on (document_id, page_number).
 * Safe to call multiple times for the same page.
 */
export async function indexDocumentPage(input: SheetIndexInput): Promise<SheetIndexResult> {
  const supabase = createServiceRoleClient()
  const { documentId, projectId, pageNumber, visionResult, textContent } = input

  // Cast to any: document_pages and sheet_entities are new tables not yet in
  // the generated Supabase types. They will be included after running migration 00044.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  try {
    const meta = visionResult.sheetMetadata ?? {}
    const sheetNumber = meta.sheetNumber ?? null
    const sheetTitle  = meta.sheetTitle  ?? ''
    const sheetType   = resolveSheetType(sheetTitle, meta.sheetType ?? undefined)

    // Extract entities from the vision result
    const entities = extractEntitiesFromVision(visionResult)

    // Derive sheet-level metadata
    const utilityDesignations = deriveUtilityDesignations(entities)
    const utilities = deriveUtilityTypes(utilityDesignations, sheetTitle)
    const disciplines = deriveDisciplines(sheetType, sheetTitle, utilities)

    // Detect view types
    const hasPlanView = /plan/i.test(sheetTitle) || sheetType === 'plan'
    const hasProfileView = /profile/i.test(sheetTitle) || sheetType === 'profile'
    const hasStations = entities.some(e => e.entityType === 'station')
    const hasQuantities = (visionResult.quantities?.length ?? 0) > 0

    // Station range for this page
    const stationEntities = entities.filter(e => e.entityType === 'station')
    const stations = stationEntities.map(e => e.entityValue)
    const stationNumerics = stations
      .map(s => parseStationNumeric(s))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b)

    const stationStart        = stations.length > 0 ? stations[0] : null
    const stationEnd          = stations.length > 1 ? stations[stations.length - 1] : null
    const stationStartNumeric = stationNumerics.length > 0 ? stationNumerics[0] : null
    const stationEndNumeric   = stationNumerics.length > 0 ? stationNumerics[stationNumerics.length - 1] : null

    // Upsert document_pages
    const { data: pageRow, error: pageErr } = await sb
      .from('document_pages')
      .upsert(
        {
          document_id: documentId,
          project_id: projectId,
          page_number: pageNumber,
          sheet_number: sheetNumber,
          sheet_title: sheetTitle || null,
          sheet_type: sheetType,
          disciplines: disciplines.length > 0 ? disciplines : null,
          utilities: utilities.length > 0 ? utilities : null,
          utility_designations: utilityDesignations.length > 0 ? utilityDesignations : null,
          has_plan_view: hasPlanView,
          has_profile_view: hasProfileView,
          has_stations: hasStations,
          has_quantities: hasQuantities,
          station_start: stationStart,
          station_end: stationEnd,
          station_start_numeric: stationStartNumeric,
          station_end_numeric: stationEndNumeric,
          text_content: textContent ?? null,
          vision_data: visionResult,
          indexed_at: new Date().toISOString(),
        },
        {
          onConflict: 'document_id,page_number',
          ignoreDuplicates: false,
        }
      )
      .select('id')
      .single()

    if (pageErr || !pageRow) {
      console.error('[SheetIndexer] Failed to upsert document_pages:', pageErr)
      return { documentPageId: null, entityCount: 0, success: false, error: pageErr?.message }
    }

    const documentPageId = pageRow.id as string

    // Delete existing sheet_entities for this page (full refresh on re-index)
    await sb
      .from('sheet_entities')
      .delete()
      .eq('document_page_id', documentPageId)

    // Insert sheet_entities
    if (entities.length > 0) {
      const entityRows = entities.map(e => ({
        document_page_id: documentPageId,
        document_id: documentId,
        project_id: projectId,
        page_number: pageNumber,
        sheet_number: sheetNumber,
        entity_type: e.entityType,
        entity_value: e.entityValue,
        entity_context: e.entityContext || null,
        confidence: e.confidence,
      }))

      const { error: entErr } = await sb
        .from('sheet_entities')
        .insert(entityRows)

      if (entErr) {
        console.error('[SheetIndexer] Failed to insert sheet_entities:', entErr)
        // Non-fatal: page row was saved, entities are supplementary
      }
    }

    console.log(
      `[SheetIndexer] Indexed page ${pageNumber}: sheet=${sheetNumber} type=${sheetType}` +
      ` utilities=${utilities.join(',')} entities=${entities.length}`
    )

    return { documentPageId, entityCount: entities.length, success: true }
  } catch (err) {
    console.error('[SheetIndexer] Unexpected error:', err)
    return {
      documentPageId: null,
      entityCount: 0,
      success: false,
      error: err instanceof Error ? err.message : 'unknown error',
    }
  }
}

// ---------------------------------------------------------------------------
// Sheet index query helpers (used by sheet-verifier Phase 1+)
// ---------------------------------------------------------------------------

/**
 * Find all document_pages for a project that mention a specific keyword.
 * Used by the sheet verifier to find candidate pages for verification.
 */
export async function findPagesByKeyword(
  projectId: string,
  keyword: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<Array<{ page_number: number; document_id: string; sheet_number: string | null; sheet_type: string | null }>> {
  const { data, error } = await supabase
    .from('document_pages')
    .select('page_number, document_id, sheet_number, sheet_type')
    .eq('project_id', projectId)
    .or(`sheet_title.ilike.%${keyword}%,text_content.ilike.%${keyword}%`)
    .order('sheet_number')
    .limit(50)

  if (error) {
    console.error('[SheetIndexer] findPagesByKeyword error:', error)
    return []
  }
  return data ?? []
}

/**
 * Find all document_pages containing a specific utility designation.
 */
export async function findPagesByUtilityDesignation(
  projectId: string,
  designation: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<Array<{ page_number: number; document_id: string; sheet_number: string | null }>> {
  // First try via sheet_entities (faster, more accurate)
  const { data: entityData, error: entErr } = await supabase
    .from('sheet_entities')
    .select('page_number, document_id, sheet_number')
    .eq('project_id', projectId)
    .eq('entity_type', 'utility_designation')
    .ilike('entity_value', `%${designation}%`)
    .limit(30)

  if (!entErr && entityData && entityData.length > 0) return entityData

  // Fallback: text search on document_pages
  const { data: pageData, error: pageErr } = await supabase
    .from('document_pages')
    .select('page_number, document_id, sheet_number')
    .eq('project_id', projectId)
    .contains('utility_designations', [designation])
    .limit(30)

  if (pageErr) {
    console.error('[SheetIndexer] findPagesByUtilityDesignation fallback error:', pageErr)
    return []
  }
  return pageData ?? []
}

/**
 * Get all distinct utility designations indexed for a project.
 * Used for Type B (enumeration) verification.
 */
export async function getAllUtilityDesignations(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<Array<{ designation: string; sheets: string[] }>> {
  const { data, error } = await supabase
    .from('sheet_entities')
    .select('entity_value, sheet_number')
    .eq('project_id', projectId)
    .eq('entity_type', 'utility_designation')
    .order('entity_value')

  if (error) {
    console.error('[SheetIndexer] getAllUtilityDesignations error:', error)
    return []
  }

  // Group sheets by designation
  const map = new Map<string, Set<string>>()
  for (const row of data ?? []) {
    const key = (row.entity_value as string).toUpperCase()
    if (!map.has(key)) map.set(key, new Set())
    if (row.sheet_number) map.get(key)!.add(row.sheet_number as string)
  }

  return [...map.entries()].map(([designation, sheetSet]) => ({
    designation,
    sheets: [...sheetSet].sort(),
  }))
}
