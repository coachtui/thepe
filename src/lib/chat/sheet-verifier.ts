/**
 * Sheet Verifier — mandatory pre-answer verification for Type B/C/D queries.
 *
 * Before the response-writer answers global, enumeration, or measurement
 * questions, this module:
 *   1. Classifies the query into Type A/B/C/D
 *   2. Queries ALL relevant structured tables for the entity
 *   3. Synthesizes confirmed findings with sheet citations
 *   4. Returns a VerificationResult that the response-writer must honour
 *
 * Verification classes:
 *   skip        (A) — simple retrieval, trust the existing pipeline
 *   enumeration (B) — "how many waterlines", "what utilities exist"
 *   measurement (C) — "what size is Water Line B", "what pipe material"
 *   global      (D) — "where does Water Line B start", "what utilities cross Road A"
 *
 * The key rule enforced here:
 *   The AI cannot answer a global/enumeration question unless ALL relevant
 *   structured data has been consulted and every finding is cited.
 */

import type { QueryAnalysis, EvidenceItem } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationClass = 'skip' | 'enumeration' | 'measurement' | 'global'

/**
 * Coverage result from verification:
 *   complete     — findings found with no evidence gaps
 *   partial      — findings found but some aspects could not be confirmed
 *   insufficient — no confirmed findings; answer must be gated
 */
export type CoverageStatus = 'complete' | 'partial' | 'insufficient'

export interface VerifiedFinding {
  /** Human-readable statement of what was confirmed */
  statement: string
  /** Sheet number where this was found (e.g. "CU110") */
  sheetNumber: string
  /** Entity name as it appears on the drawings */
  entityValue: string
  /** What class of data this represents */
  entityType: 'utility_system' | 'pipe_size' | 'station' | 'crossing' | 'component' | 'structural' | 'architectural' | 'mep' | 'general'
  /** 0–1 confidence from the source data */
  confidence: number
}

export interface SheetVerificationResult {
  verificationClass: VerificationClass
  /**
   * A/B/C/D query type letter:
   *   A — simple retrieval (skip, trust the pipeline)
   *   B — enumeration ("how many waterlines?", "what utilities exist?")
   *   C — measurement / attribute lookup ("what size is Water Line B?")
   *   D — global / cross-sheet reasoning ("where does Water Line B start?")
   */
  questionType: 'A' | 'B' | 'C' | 'D'
  /** True when verification actually ran (false for 'skip' class) */
  wasVerified: boolean
  /** Confirmed findings with citations */
  verifiedFindings: VerifiedFinding[]
  /** All sheet numbers inspected (confirmed + checked-but-empty) */
  sheetsInspected: string[]
  /**
   * All sheets in the project that have indexed structured data —
   * gathered at the start of verification so callers can see how many
   * sheets were candidates vs. how many were actually matched.
   */
  candidateSheets: string[]
  /** Overall coverage result — drives hard answer gating */
  coverageStatus: CoverageStatus
  /** Formatted context block injected into the system prompt */
  confirmedContext: string
  /** Aspects not confirmed — used for the "could not be confirmed" footer */
  evidenceGaps: string[]
  /** Canonical alias for evidenceGaps */
  missingEvidence: string[]
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify what kind of verification is needed for this query.
 *
 * Type B (enumeration) — enumerating all items of a type:
 *   "How many waterlines are there?"
 *   "What utilities exist on this project?"
 *
 * Type C (measurement) — specific attribute of a named system:
 *   "What size is Water Line B?"
 *   "What material is the sewer pipe?"
 *
 * Type D (global/cross-sheet) — spatial/longitudinal reasoning:
 *   "Where does Water Line B start and end?"
 *   "What utilities cross Road A?"
 *   "Which sheets contain sewer?"
 */
export function classifyVerificationNeed(analysis: QueryAnalysis): VerificationClass {
  const q = analysis.rawQuery.toLowerCase()
  const mode = analysis.answerMode

  // ── Type D: cross-sheet / spatial reasoning ──────────────────────────────
  if (mode === 'crossing_lookup') return 'global'

  if (
    (mode === 'sheet_lookup' || mode === 'quantity_lookup') &&
    /\bstart\b|\bend\b|\bbegin\b|\bterminus\b|\bwhere does\b|\bwhich sheets\b|\bcovers?\b|\bspan\b|\bextend/i.test(q)
  ) {
    return 'global'
  }

  if (mode === 'project_summary' || mode === 'scope_summary') return 'global'

  // ── Type B: enumeration ──────────────────────────────────────────────────
  if (
    mode === 'quantity_lookup' &&
    analysis.retrievalHints.isAggregation &&
    !analysis.entities.itemName  // no specific named system → enumerating all
  ) {
    return 'enumeration'
  }

  if (
    /\bhow many\b.*\b(water\s*line|sewer|storm|drain|utility|utilities|line|system)/i.test(q) ||
    /\blist\s+all\b.*\b(water\s*line|sewer|storm|drain|utility|utilities)\b/i.test(q) ||
    /\bwhat\s+(water|sewer|storm|utility|utilities)\b.*\b(exist|are there|on this|in this)/i.test(q)
  ) {
    return 'enumeration'
  }

  // ── Type C: measurement / attribute ─────────────────────────────────────
  // Require measurement keywords. itemName is preferred but not mandatory —
  // a query like "What size is the storm drain pipe near station 15+00?" may
  // have utilitySystem set instead, or nothing (ambiguous system). Either way
  // the user expects a document-backed measurement answer, not a skip.
  const hasMeasurementKeyword = /\bsize\b|\bdiameter\b|\bwidth\b|\bdepth\b|\bmaterial\b|\bpipe\b|\bclass\b|\bgauge\b|\bpressure\b|\bspec\b|\bstrength\b|\bwall thickness\b|\bhow long\b|\blength\b|\bhow far\b|\bdistance\b|\btotal lf\b|\blinear feet\b/i.test(q)

  if (hasMeasurementKeyword) {
    // Has a named target system OR is asking about an entity attribute
    const hasTarget = !!(
      analysis.entities.itemName ||
      analysis.entities.utilitySystem ||
      analysis.entities.componentType ||
      analysis.entities.sheetNumber ||
      // Structural/arch/MEP tag patterns in query
      /\b([fcbw][-\s]?\d+|d[-\s]\d+[a-z]?|lp[-\s]\d+|ahu[-\s]\d+)\b/i.test(q)
    )
    if (hasTarget) return 'measurement'
  }

  return 'skip'
}

/** Map VerificationClass to its A/B/C/D letter. */
function classToQuestionType(vc: VerificationClass): 'A' | 'B' | 'C' | 'D' {
  switch (vc) {
    case 'skip':        return 'A'
    case 'enumeration': return 'B'
    case 'measurement': return 'C'
    case 'global':      return 'D'
  }
}

/** Derive CoverageStatus from the verification findings and gaps. */
function computeCoverageStatus(findings: VerifiedFinding[], gaps: string[]): CoverageStatus {
  if (findings.length === 0) return 'insufficient'
  if (gaps.length === 0) return 'complete'
  return 'partial'
}

/**
 * Query all distinct sheet numbers that have been indexed for a project.
 * These are the "candidate sheets" — sheets that should have been inspected
 * for any global/enumeration/measurement query.
 */
async function queryCandidateSheets(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<string[]> {
  try {
    // Query all data sources in parallel.
    // entity_locations covers structural, architectural, MEP, demo, spec, RFI —
    // every discipline that has been extracted into the project_entities graph.
    const [qResult, tResult, cResult, eResult] = await Promise.all([
      supabase
        .from('project_quantities')
        .select('sheet_number')
        .eq('project_id', projectId)
        .not('sheet_number', 'is', null),
      supabase
        .from('utility_termination_points')
        .select('sheet_number')
        .eq('project_id', projectId)
        .not('sheet_number', 'is', null),
      supabase
        .from('utility_crossings')
        .select('sheet_number')
        .eq('project_id', projectId)
        .not('sheet_number', 'is', null),
      // entity_locations joins all disciplines via project_entities
      supabase
        .from('entity_locations')
        .select('sheet_number, project_entities!inner(project_id)')
        .eq('project_entities.project_id', projectId)
        .not('sheet_number', 'is', null),
    ])

    const all = [
      ...(qResult.data ?? []).map((r: { sheet_number: string }) => r.sheet_number),
      ...(tResult.data ?? []).map((r: { sheet_number: string }) => r.sheet_number),
      ...(cResult.data ?? []).map((r: { sheet_number: string }) => r.sheet_number),
      ...(eResult.data ?? []).map((r: { sheet_number: string }) => r.sheet_number),
    ]

    return [...new Set(all.filter(Boolean).map(normalizeSheetNumber))].sort()
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Candidate data retrieval helpers
// ---------------------------------------------------------------------------

/** Row from project_quantities with the fields we use */
interface QuantityRow {
  item_name: string
  item_type: string | null
  sheet_number: string | null
  confidence: number | null
  description: string | null
  size?: string | null
  metadata?: Record<string, unknown> | null
}

/** Row from utility_termination_points */
interface TerminationRow {
  utility_name: string
  termination_type: string
  station: string | null
  sheet_number: string | null
  confidence: number | null
}

/** Row from utility_crossings */
interface CrossingRow {
  utility_name: string
  crossing_utility: string
  utility_full_name: string | null
  station: string | null
  elevation: number | null
  is_existing: boolean
  is_proposed: boolean
  size: string | null
  sheet_number: string | null
  confidence: number | null
}

// ---------------------------------------------------------------------------
// Synthesis helpers
// ---------------------------------------------------------------------------

function unique(arr: (string | null | undefined)[]): string[] {
  return [...new Set(arr.filter((s): s is string => !!s && s.trim().length > 0))]
}

function normalizeSheetNumber(raw: string | null | undefined): string {
  if (!raw) return 'Unknown'
  return raw.trim().toUpperCase()
}

function deduplicateFindings(findings: VerifiedFinding[]): VerifiedFinding[] {
  const seen = new Set<string>()
  return findings.filter(f => {
    const key = `${f.entityValue}::${f.sheetNumber}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatConfirmedContext(
  verificationClass: VerificationClass,
  findings: VerifiedFinding[],
  sheetsInspected: string[],
  gaps: string[]
): string {
  if (findings.length === 0) {
    const sheetsStr = sheetsInspected.length > 0 ? sheetsInspected.join(', ') : 'none'
    return [
      '## VERIFICATION RESULT',
      '',
      `Verification class: ${verificationClass.toUpperCase()}`,
      `Sheets inspected: ${sheetsStr}`,
      '',
      '**No confirmed findings.** The information could not be confirmed from the available drawings.',
      ...(gaps.length > 0 ? ['', 'Evidence gaps:', ...gaps.map(g => `  - ${g}`)] : []),
    ].join('\n')
  }

  const lines: string[] = [
    '## VERIFICATION RESULT',
    '',
    `Verification class: ${verificationClass.toUpperCase()}`,
    `Sheets inspected: ${[...new Set(sheetsInspected)].join(', ')}`,
    '',
    '**Confirmed findings from drawings:**',
    '',
  ]

  // Group by entity type for cleaner output
  const byType: Record<string, VerifiedFinding[]> = {}
  for (const f of findings) {
    if (!byType[f.entityType]) byType[f.entityType] = []
    byType[f.entityType].push(f)
  }

  for (const [entityType, group] of Object.entries(byType)) {
    const label = {
      utility_system: 'Utility Systems',
      pipe_size: 'Pipe Sizes',
      station: 'Stations / Termination Points',
      crossing: 'Utility Crossings',
      component: 'Components',
      structural: 'Structural Elements',
      architectural: 'Architectural Elements',
      mep: 'MEP Elements',
      general: 'Other Findings',
    }[entityType] || entityType

    lines.push(`### ${label}`)
    for (const f of group) {
      lines.push(`- ${f.statement}`)
    }
    lines.push('')
  }

  lines.push(`**Total confirmed items: ${findings.length}**`)

  if (gaps.length > 0) {
    lines.push('')
    lines.push('**Evidence gaps (not confirmed from drawings):**')
    for (const g of gaps) {
      lines.push(`  - ${g}`)
    }
  }

  lines.push('')
  lines.push('---')
  lines.push('**CITATION REQUIREMENT**: Your response MUST include sheet number citations')
  lines.push('for every finding listed above. Do not state any fact that is not in this')
  lines.push('confirmed list. If asked about something not listed, respond:')
  lines.push('"The information could not be confirmed from the available drawings.')
  lines.push(`Relevant sheets analyzed: ${[...new Set(sheetsInspected)].join(', ')}"`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Phase 2: Query sheet_entities if indexed (faster, more accurate)
// ---------------------------------------------------------------------------

async function querySheetEntities(
  projectId: string,
  entityType: string | null,
  keyword: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<Array<{ entity_value: string; entity_context: string; sheet_number: string | null; confidence: number }>> {
  try {
    let query = supabase
      .from('sheet_entities')
      .select('entity_value, entity_context, sheet_number, confidence')
      .eq('project_id', projectId)
      .limit(100)

    if (entityType) query = query.eq('entity_type', entityType)
    if (keyword) query = query.ilike('entity_value', `%${keyword}%`)

    const { data, error } = await query
    if (error) return []
    return data ?? []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Entity graph query — project_entities JOIN entity_findings JOIN entity_locations
//
// This is the canonical source for ALL disciplines:
//   structural (footings, columns, beams), architectural (doors, rooms, walls),
//   MEP (panels, equipment), demo, utility, spec, RFI — everything that has
//   been extracted into the project_entities graph.
//
// Used by all three verification tiers so that non-utility questions ("what
// is the concrete strength for the slab", "which sheet shows footing F3")
// get the same rigorous confirmation as utility questions.
// ---------------------------------------------------------------------------

interface EntityGraphRow {
  id: string
  discipline: string
  entity_type: string
  canonical_name: string
  display_name: string | null
  label: string | null
  confidence: number | null
  // from entity_findings (may be null if no findings)
  finding_statement: string | null
  finding_type: string | null
  // from entity_locations (may be null if no location)
  sheet_number: string | null
  location_type: string | null
  station_value: string | null
  room_number: string | null
  level: string | null
}

/**
 * Query the entity graph for a keyword.
 *
 * Matches against canonical_name, display_name, and label using ILIKE.
 * Returns de-duplicated rows (one per entity × finding × location combo).
 * Callers are responsible for grouping by entity id.
 */
async function queryEntityGraph(
  projectId: string,
  keyword: string,
  disciplineFilter: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<EntityGraphRow[]> {
  try {
    // Build the joined query via three separate fetches and join in JS.
    // Supabase JS client does not support multi-table JOINs in a single call,
    // so we fetch entities first, then findings + locations by entity ids.

    let entityQuery = supabase
      .from('project_entities')
      .select('id, discipline, entity_type, canonical_name, display_name, label, confidence')
      .eq('project_id', projectId)
      .or(`canonical_name.ilike.%${keyword}%,display_name.ilike.%${keyword}%,label.ilike.%${keyword}%`)
      .limit(50)

    if (disciplineFilter) {
      entityQuery = entityQuery.eq('discipline', disciplineFilter)
    }

    const { data: entities, error: eErr } = await entityQuery
    if (eErr || !entities || entities.length === 0) return []

    const ids: string[] = entities.map((e: { id: string }) => e.id)

    // Fetch findings for these entities
    const { data: findings } = await supabase
      .from('entity_findings')
      .select('entity_id, finding_type, statement')
      .in('entity_id', ids)

    // Fetch primary locations for these entities
    const { data: locations } = await supabase
      .from('entity_locations')
      .select('entity_id, location_type, sheet_number, station_value, room_number, level')
      .in('entity_id', ids)

    // Index findings and locations by entity_id
    const findingsByEntity = new Map<string, Array<{ finding_type: string; statement: string }>>()
    for (const f of findings ?? []) {
      if (!findingsByEntity.has(f.entity_id)) findingsByEntity.set(f.entity_id, [])
      findingsByEntity.get(f.entity_id)!.push(f)
    }

    const locationsByEntity = new Map<string, Array<{ location_type: string; sheet_number: string | null; station_value: string | null; room_number: string | null; level: string | null }>>()
    for (const l of locations ?? []) {
      if (!locationsByEntity.has(l.entity_id)) locationsByEntity.set(l.entity_id, [])
      locationsByEntity.get(l.entity_id)!.push(l)
    }

    // Build flat result rows: one row per (entity × finding × location) combination
    const rows: EntityGraphRow[] = []

    for (const entity of entities) {
      const entityFindings = findingsByEntity.get(entity.id) ?? [null]
      const entityLocations = locationsByEntity.get(entity.id) ?? [null]

      // Cross-product but deduplicate by (finding_statement, sheet_number)
      const seen = new Set<string>()
      for (const finding of entityFindings) {
        for (const loc of entityLocations) {
          const key = `${finding?.statement}::${loc?.sheet_number}`
          if (seen.has(key)) continue
          seen.add(key)

          rows.push({
            id: entity.id,
            discipline: entity.discipline,
            entity_type: entity.entity_type,
            canonical_name: entity.canonical_name,
            display_name: entity.display_name,
            label: entity.label,
            confidence: entity.confidence,
            finding_statement: finding?.statement ?? null,
            finding_type: finding?.finding_type ?? null,
            sheet_number: loc?.sheet_number ?? null,
            location_type: loc?.location_type ?? null,
            station_value: loc?.station_value ?? null,
            room_number: loc?.room_number ?? null,
            level: loc?.level ?? null,
          })
        }
      }
    }

    return rows
  } catch (err) {
    console.error('[SheetVerifier] queryEntityGraph error:', err)
    return []
  }
}

/** Map an entity discipline to a VerifiedFinding entityType */
function disciplineToEntityType(discipline: string): VerifiedFinding['entityType'] {
  switch (discipline) {
    case 'structural': return 'structural'
    case 'architectural': return 'architectural'
    case 'mep': return 'mep'
    case 'utility': return 'utility_system'
    default: return 'general'
  }
}

/** Convert entity graph rows into VerifiedFindings */
function entityRowsToFindings(rows: EntityGraphRow[]): VerifiedFinding[] {
  const findings: VerifiedFinding[] = []

  // Group by entity id to avoid one finding per location × finding combo
  const byEntity = new Map<string, EntityGraphRow[]>()
  for (const row of rows) {
    if (!byEntity.has(row.id)) byEntity.set(row.id, [])
    byEntity.get(row.id)!.push(row)
  }

  for (const [, entityRows] of byEntity) {
    const first = entityRows[0]
    const name = first.display_name || first.label || first.canonical_name

    // Collect unique sheets and findings
    const sheets = unique(entityRows.map(r => r.sheet_number))
    const findingStatements = unique(entityRows.map(r => r.finding_statement))
    const sheetStr = sheets.length > 0 ? `Sheet${sheets.length > 1 ? 's' : ''}: ${sheets.join(', ')}` : 'Sheet unknown'

    if (findingStatements.length > 0) {
      // One finding per statement
      for (const stmt of findingStatements) {
        findings.push({
          statement: `${name}: ${stmt} (${sheetStr})`,
          sheetNumber: sheets[0] || 'Unknown',
          entityValue: name,
          entityType: disciplineToEntityType(first.discipline),
          confidence: first.confidence ?? 0.85,
        })
      }
    } else {
      // No findings yet — just confirm the entity exists and its location
      findings.push({
        statement: sheetStr !== 'Sheet unknown'
          ? `${name} — found on ${sheetStr}`
          : `${name} — indexed (no sheet location recorded)`,
        sheetNumber: sheets[0] || 'Unknown',
        entityValue: name,
        entityType: disciplineToEntityType(first.discipline),
        confidence: first.confidence ?? 0.75,
      })
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// Discipline / keyword derivation from raw query
// ---------------------------------------------------------------------------

/**
 * Extract the best keyword to search project_entities with.
 * Returns the most specific label mentioned in the query, or null if not found.
 */
function deriveEntityKeyword(q: string): string | null {
  // Structural: footing marks (F-1, F3), column marks (C-4), beam marks (W12×26)
  const structMatch = q.match(/\b([fcbw][-\s]?\d+[a-z]?)\b/i)
  if (structMatch) return structMatch[1].toUpperCase().replace(/\s/, '-')

  // Arch: door/window/wall tags (D-14, W-3A, WT-A)
  const archMatch = q.match(/\b(d[-\s]\d+[a-z]?|w[-\s]\d+[a-z]?|wt[-\s][a-z]\d*)\b/i)
  if (archMatch) return archMatch[1].toUpperCase().replace(/\s/, '-')

  // MEP: panel/equipment tags (LP-1, AHU-1, T-1)
  const mepMatch = q.match(/\b([a-z]{1,4}[-\s]\d+[a-z]?)\b/i)
  if (mepMatch) return mepMatch[1].toUpperCase().replace(/\s/, '-')

  // Manhole (MH-12), catch basin (CB-4)
  const structureMatch = q.match(/\b(mh[-\s]?\d+|cb[-\s]?\d+|dmi[-\s]?\d+)\b/i)
  if (structureMatch) return structureMatch[1].toUpperCase()

  // Room number
  const roomMatch = q.match(/\broom\s+(\d+[a-z]?)\b/i)
  if (roomMatch) return roomMatch[1]

  return null
}

/**
 * Derive a discipline filter for project_entities from the query.
 * Returns the discipline string or null to query all disciplines.
 */
function deriveEntityDiscipline(q: string): string | null {
  if (/\bfooting|column|beam|rebar|slab|shear wall|bearing wall|structural/i.test(q)) return 'structural'
  if (/\bdoor|window|room|ceiling|floor finish|wall type|partition|arch/i.test(q)) return 'architectural'
  if (/\bpanel|circuit|ahu|vav|hvac|plumbing|mechanical|electrical|mep\b/i.test(q)) return 'mep'
  if (/\bdemolish|demo|removal|remove|protect|remain/i.test(q)) return 'demo'
  // Utilities are handled by the dedicated utility path — skip here
  if (/\bwater\s*line|sewer|storm\s*drain|waterline/i.test(q)) return null
  return null
}

// ---------------------------------------------------------------------------
// Type B: Enumeration verification
// ---------------------------------------------------------------------------

async function verifyEnumeration(
  analysis: QueryAnalysis,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ findings: VerifiedFinding[]; sheets: string[]; gaps: string[] }> {
  const findings: VerifiedFinding[] = []
  const sheets: string[] = []
  const gaps: string[] = []

  const q = analysis.rawQuery.toLowerCase()

  // Determine what the user is enumerating
  const wantsWater = /water|waterline/i.test(q)
  const wantsSewer = /sewer|sanitary/i.test(q)
  const wantsStorm = /storm|drain/i.test(q)
  const wantsAll = /utilities|all systems|all lines|utility systems/i.test(q)
  const wantsAny = wantsAll || (!wantsWater && !wantsSewer && !wantsStorm)

  // Query project_quantities for distinct system names
  const { data: quantities, error: qErr } = await supabase
    .from('project_quantities')
    .select('item_name, item_type, sheet_number, confidence, description, size, metadata')
    .eq('project_id', projectId)
    .not('item_name', 'is', null)
    .order('item_name')

  if (qErr) {
    gaps.push(`Could not query project quantities: ${qErr.message}`)
  } else if (quantities && quantities.length > 0) {
    const rows = quantities as QuantityRow[]

    // Collect distinct item types/names based on query focus
    const systemsByName: Map<string, { sheets: Set<string>; type: string }> = new Map()

    for (const row of rows) {
      const name = (row.item_name || '').trim()
      const type = (row.item_type || '').toLowerCase()

      // Filter by what the user is asking about
      if (!wantsAny) {
        if (wantsWater && !/(waterline|water.*line)/i.test(type) && !/(water.*line|waterline)/i.test(name)) continue
        if (wantsSewer && !/sewer/i.test(type) && !/sewer/i.test(name)) continue
        if (wantsStorm && !/(storm|drain)/i.test(type) && !/(storm|drain)/i.test(name)) continue
      }

      // Only track named systems (not individual components)
      if (/(water line|waterline|sewer|storm drain|storm sewer|utility)/i.test(name)) {
        const key = name.toUpperCase()
        if (!systemsByName.has(key)) {
          systemsByName.set(key, { sheets: new Set(), type })
        }
        if (row.sheet_number) {
          systemsByName.get(key)!.sheets.add(normalizeSheetNumber(row.sheet_number))
        }
      }
    }

    for (const [name, info] of systemsByName) {
      const sheetList = [...info.sheets].sort()
      sheetList.forEach(s => sheets.push(s))

      findings.push({
        statement: sheetList.length > 0
          ? `${name} — Sheets: ${sheetList.join(', ')}`
          : `${name} — Sheet location unknown`,
        sheetNumber: sheetList[0] || 'Unknown',
        entityValue: name,
        entityType: 'utility_system',
        confidence: 0.85,
      })
    }
  }

  // Also check utility_termination_points for systems not in project_quantities
  const { data: terminations, error: tErr } = await supabase
    .from('utility_termination_points')
    .select('utility_name, termination_type, station, sheet_number, confidence')
    .eq('project_id', projectId)

  if (!tErr && terminations) {
    const rows = terminations as TerminationRow[]
    const knownSystems = new Set(findings.map(f => f.entityValue.toUpperCase()))

    for (const row of rows) {
      const name = (row.utility_name || '').trim().toUpperCase()
      if (!name) continue
      if (knownSystems.has(name)) {
        if (row.sheet_number) sheets.push(normalizeSheetNumber(row.sheet_number))
        continue
      }

      if (!wantsAny) {
        if (wantsWater && !/(water)/i.test(name)) continue
        if (wantsSewer && !/(sewer)/i.test(name)) continue
        if (wantsStorm && !/(storm|drain)/i.test(name)) continue
      }

      knownSystems.add(name)
      const sheet = normalizeSheetNumber(row.sheet_number)
      if (row.sheet_number) sheets.push(sheet)

      findings.push({
        statement: `${name} — ${row.termination_type} at Station ${row.station || 'unknown'}, Sheet: ${sheet}`,
        sheetNumber: sheet,
        entityValue: name,
        entityType: 'utility_system',
        confidence: row.confidence ?? 0.8,
      })
    }
  }

  // Phase 2 supplement: query sheet_entities for utility designations
  // (available after document_pages + sheet_entities have been populated)
  const entityRows = await querySheetEntities(projectId, 'utility_designation', null, supabase)
  if (entityRows.length > 0) {
    const knownSystems = new Set(findings.map(f => f.entityValue.toUpperCase()))
    const bySys: Map<string, Set<string>> = new Map()

    for (const row of entityRows) {
      const name = (row.entity_value || '').trim().toUpperCase()
      if (!name) continue
      if (!wantsAny) {
        if (wantsWater && !/(water)/i.test(name)) continue
        if (wantsSewer && !/(sewer)/i.test(name)) continue
        if (wantsStorm && !/(storm|drain)/i.test(name)) continue
      }

      if (!bySys.has(name)) bySys.set(name, new Set())
      if (row.sheet_number) {
        bySys.get(name)!.add(normalizeSheetNumber(row.sheet_number))
      }
    }

    for (const [name, sheetSet] of bySys) {
      const sheetList = [...sheetSet].sort()
      sheetList.forEach(s => sheets.push(s))

      if (!knownSystems.has(name)) {
        findings.push({
          statement: sheetList.length > 0
            ? `${name} — Sheets: ${sheetList.join(', ')}`
            : `${name} — Sheet location unknown`,
          sheetNumber: sheetList[0] || 'Unknown',
          entityValue: name,
          entityType: 'utility_system',
          confidence: 0.9,  // sheet_entities are vision-confirmed
        })
      }
    }
  }

  // Entity graph: handles non-utility enumeration ("how many footings",
  // "what structural elements exist", "list all doors") using project_entities.
  // We derive the discipline/keyword from the query and run a broad match.
  const entityKeyword = deriveEntityKeyword(q)
  const entityDiscipline = deriveEntityDiscipline(q)

  if (entityKeyword || entityDiscipline) {
    const kw = entityKeyword || ''
    const graphRows = await queryEntityGraph(projectId, kw, entityDiscipline, supabase)

    if (graphRows.length > 0) {
      const graphFindings = entityRowsToFindings(graphRows)
      for (const f of graphFindings) {
        findings.push(f)
        if (f.sheetNumber !== 'Unknown') sheets.push(f.sheetNumber)
      }
    }
  }

  return { findings: deduplicateFindings(findings), sheets, gaps }
}

// ---------------------------------------------------------------------------
// Type C: Measurement verification
// ---------------------------------------------------------------------------

async function verifyMeasurement(
  analysis: QueryAnalysis,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ findings: VerifiedFinding[]; sheets: string[]; gaps: string[] }> {
  const findings: VerifiedFinding[] = []
  const sheets: string[] = []
  const gaps: string[] = []

  const targetSystem = analysis.entities.itemName || analysis.entities.utilitySystem
  if (!targetSystem) {
    gaps.push('No specific system identified in query — cannot perform targeted measurement verification')
    return { findings, sheets, gaps }
  }

  const measureQ = analysis.rawQuery.toLowerCase()
  const isLengthQuery = /\bhow long\b|\blength\b|\bhow far\b|\bdistance\b|\btotal lf\b|\blinear feet\b/i.test(measureQ)

  // ── Length queries: compute from begin→end termination points ────────────
  // This is authoritative and avoids trusting project_quantities segment rows
  // which may represent individual callouts, not the full system length.
  if (isLengthQuery) {
    const { data: terminations } = await supabase
      .from('utility_termination_points')
      .select('utility_name, termination_type, station, sheet_number, confidence')
      .eq('project_id', projectId)
      .ilike('utility_name', `%${targetSystem}%`)
      .order('confidence', { ascending: false })

    if (terminations && terminations.length > 0) {
      // Find the best begin and end records
      const beginRow = (terminations as TerminationRow[]).find(r =>
        /begin|start/i.test(r.termination_type || '')
      )
      const endRow = (terminations as TerminationRow[]).find(r =>
        /end|terminus/i.test(r.termination_type || '')
      )

      if (beginRow && endRow) {
        const beginSheet = normalizeSheetNumber(beginRow.sheet_number)
        const endSheet   = normalizeSheetNumber(endRow.sheet_number)
        if (beginRow.sheet_number) sheets.push(beginSheet)
        if (endRow.sheet_number) sheets.push(endSheet)

        // Parse stations to compute length
        const parseStation = (s: string | null): number | null => {
          if (!s) return null
          const m = s.trim().match(/^(\d{1,3})\+(\d{2}(?:\.\d{1,2})?)$/)
          return m ? parseFloat(m[1]) * 100 + parseFloat(m[2]) : null
        }

        const beginNum = parseStation(beginRow.station)
        const endNum   = parseStation(endRow.station)

        if (beginNum !== null && endNum !== null) {
          const lengthLF = Math.round((endNum - beginNum) * 100) / 100
          findings.push({
            statement: `${targetSystem} length: ${lengthLF.toLocaleString()} LF (Station ${beginRow.station} to ${endRow.station}, Sheets: ${beginSheet}–${endSheet})`,
            sheetNumber: beginSheet,
            entityValue: `${lengthLF} LF`,
            entityType: 'station',
            confidence: Math.min(beginRow.confidence ?? 0.9, endRow.confidence ?? 0.9),
          })
        } else {
          // Stations present but couldn't parse numerics — still surface them
          findings.push({
            statement: `${targetSystem}: begins at Station ${beginRow.station ?? 'unknown'} (Sheet: ${beginSheet}), ends at Station ${endRow.station ?? 'unknown'} (Sheet: ${endSheet})`,
            sheetNumber: beginSheet,
            entityValue: `${beginRow.station} to ${endRow.station}`,
            entityType: 'station',
            confidence: 0.8,
          })
          gaps.push(`Could not compute numeric length — station format may be non-standard`)
        }
      } else {
        gaps.push(`Begin and/or end termination point not found for "${targetSystem}" — cannot compute length from stations`)
      }
    } else {
      gaps.push(`No termination points indexed for "${targetSystem}" — length cannot be confirmed from structured data`)
    }

    return { findings: deduplicateFindings(findings), sheets, gaps }
  }

  // Query project_quantities for the specific system
  const { data: quantities, error: qErr } = await supabase
    .from('project_quantities')
    .select('item_name, item_type, sheet_number, confidence, description, size, metadata')
    .eq('project_id', projectId)
    .ilike('item_name', `%${targetSystem}%`)

  if (qErr) {
    gaps.push(`Could not query project quantities: ${qErr.message}`)
  } else if (quantities && quantities.length > 0) {
    const rows = quantities as QuantityRow[]

    for (const row of rows) {
      const sheet = normalizeSheetNumber(row.sheet_number)
      if (row.sheet_number) sheets.push(sheet)

      // Extract size information from item_name or dedicated size field
      const sizeFromName = (row.item_name || '').match(/(\d+["\-]\s*(?:IN|INCH|DIP|PVC|HDPE|RCP|VCP|ABS)?)/i)?.[1]
      const size = row.size || sizeFromName

      if (size) {
        findings.push({
          statement: `${row.item_name}: ${size}${row.description ? ` — ${row.description}` : ''} (Sheet: ${sheet})`,
          sheetNumber: sheet,
          entityValue: size,
          entityType: 'pipe_size',
          confidence: row.confidence ?? 0.85,
        })
      } else {
        findings.push({
          statement: `${row.item_name}${row.description ? `: ${row.description}` : ''} (Sheet: ${sheet})`,
          sheetNumber: sheet,
          entityValue: row.item_name,
          entityType: 'general',
          confidence: row.confidence ?? 0.75,
        })
      }
    }
  }

  // Also check document_chunks for this system (vision_data may have sizes not in project_quantities)
  const { data: chunks, error: cErr } = await supabase
    .from('document_chunks')
    .select('sheet_number, content, vision_data, page_number')
    .eq('project_id', projectId)
    .ilike('content', `%${targetSystem}%`)
    .not('vision_data', 'is', null)
    .limit(20)

  if (!cErr && chunks) {
    for (const chunk of chunks) {
      const sheet = normalizeSheetNumber(chunk.sheet_number)
      if (chunk.sheet_number && !sheets.includes(sheet)) {
        sheets.push(sheet)
      }

      // Extract size from vision_data quantities if present
      const vd = chunk.vision_data
      if (vd?.quantities) {
        for (const qty of (vd.quantities as Array<{ itemName: string; description?: string; confidence: number }>) ) {
          const isRelevant = (qty.itemName || '').toLowerCase().includes(targetSystem.toLowerCase())
          if (!isRelevant) continue

          const sizeMatch = (qty.itemName || '').match(/(\d+["\-]?\s*(?:IN|INCH|DIP|PVC|HDPE|RCP))/i)
          if (sizeMatch) {
            findings.push({
              statement: `${qty.itemName}: ${sizeMatch[1]}${qty.description ? ` — ${qty.description}` : ''} (Sheet: ${sheet})`,
              sheetNumber: sheet,
              entityValue: sizeMatch[1],
              entityType: 'pipe_size',
              confidence: qty.confidence ?? 0.8,
            })
          }
        }
      }
    }
  }

  // Reverse lookup: if no size found yet, look for sized items on the same
  // sheets as the target system. Vision often stores "12-IN WATER LINE" as a
  // separate item rather than an attribute of "WATER LINE B".
  if (findings.filter(f => f.entityType === 'pipe_size').length === 0 && sheets.length > 0) {
    const distinctSheets = [...new Set(sheets)]
    const { data: sizedItems } = await supabase
      .from('project_quantities')
      .select('item_name, size, sheet_number, confidence, description')
      .eq('project_id', projectId)
      .in('sheet_number', distinctSheets)
      .not('item_name', 'is', null)

    if (sizedItems) {
      for (const row of sizedItems as QuantityRow[]) {
        const sizeFromName = (row.item_name || '').match(/(\d+["\-]?\s*(?:IN|INCH|DIP|PVC|HDPE|RCP|VCP|ABS|CMP))/i)?.[1]
        const size = row.size || sizeFromName
        if (!size) continue

        // Only include if it looks like the same utility type
        const sameType = new RegExp(targetSystem.replace(/\s+/g, '\\s+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(row.item_name || '')
          || /water\s*line|waterline/i.test(row.item_name || '')

        if (!sameType) continue

        const sheet = normalizeSheetNumber(row.sheet_number)
        findings.push({
          statement: `${row.item_name}: ${size}${row.description ? ` — ${row.description}` : ''} (Sheet: ${sheet})`,
          sheetNumber: sheet,
          entityValue: size,
          entityType: 'pipe_size',
          confidence: (row.confidence ?? 0.75) * 0.9, // slight discount — inferred by co-location
        })
      }
    }
  }

  // Phase 2 supplement: query sheet_entities for pipe_size records matching
  // the target system (fast vision-confirmed lookup)
  const pipeSizeRows = await querySheetEntities(projectId, 'pipe_size', targetSystem, supabase)
  if (pipeSizeRows.length > 0) {
    for (const row of pipeSizeRows) {
      const sheet = normalizeSheetNumber(row.sheet_number)
      if (row.sheet_number && !sheets.includes(sheet)) sheets.push(sheet)
      findings.push({
        statement: `${row.entity_value}${row.entity_context ? ` — ${row.entity_context}` : ''} (Sheet: ${sheet})`,
        sheetNumber: sheet,
        entityValue: row.entity_value,
        entityType: 'pipe_size',
        confidence: row.confidence ?? 0.9,
      })
    }
  }

  // Entity graph: handles non-utility measurements ("what is the concrete
  // strength for footing F3", "what size is column C-4", "what door type is D-14").
  // Run even when utility query also ran — different disciplines don't overlap.
  const entityKeyword = deriveEntityKeyword(measureQ) || targetSystem
  const entityDiscipline = deriveEntityDiscipline(measureQ)

  if (entityKeyword) {
    const graphRows = await queryEntityGraph(projectId, entityKeyword, entityDiscipline, supabase)
    if (graphRows.length > 0) {
      const graphFindings = entityRowsToFindings(graphRows)
      for (const f of graphFindings) {
        findings.push(f)
        if (f.sheetNumber !== 'Unknown') sheets.push(f.sheetNumber)
      }
    }
  }

  if (findings.length === 0) {
    gaps.push(`No size/material data found for "${targetSystem ?? entityKeyword}" in structured records.`)
    gaps.push('Visual inspection of the plan sheets may be required for this measurement.')
  }

  return { findings: deduplicateFindings(findings), sheets, gaps }
}

// ---------------------------------------------------------------------------
// Type D: Global / cross-sheet reasoning
// ---------------------------------------------------------------------------

async function verifyGlobal(
  analysis: QueryAnalysis,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ findings: VerifiedFinding[]; sheets: string[]; gaps: string[] }> {
  const findings: VerifiedFinding[] = []
  const sheets: string[] = []
  const gaps: string[] = []

  const targetSystem = analysis.entities.itemName || analysis.entities.utilitySystem
  const q = analysis.rawQuery.toLowerCase()

  // ── Termination points (start / end) ─────────────────────────────────────
  if (/start|end|begin|terminus|where does/i.test(q) || analysis.answerMode === 'quantity_lookup') {
    let terminationQuery = supabase
      .from('utility_termination_points')
      .select('utility_name, termination_type, station, sheet_number, confidence')
      .eq('project_id', projectId)
      .order('confidence', { ascending: false })

    if (targetSystem) {
      terminationQuery = terminationQuery.ilike('utility_name', `%${targetSystem}%`)
    }

    // Narrow to start or end records when the query is specific
    const wantsStart = /\bstart\b|\bbegin\b|\bwhere does.*start\b/i.test(q)
    const wantsEnd   = /\bend\b|\bterminus\b|\bwhere does.*end\b/i.test(q)
    if (wantsStart && !wantsEnd) {
      terminationQuery = terminationQuery.or('termination_type.ilike.%begin%,termination_type.ilike.%start%')
    } else if (wantsEnd && !wantsStart) {
      terminationQuery = terminationQuery.or('termination_type.ilike.%end%,termination_type.ilike.%terminus%')
    }

    const { data: terminations, error: tErr } = await terminationQuery

    if (tErr) {
      gaps.push(`Could not query termination points: ${tErr.message}`)
    } else if (terminations && terminations.length > 0) {
      // Deduplicate: keep highest-confidence record per (utility_name, termination_type)
      // This prevents multiple vision passes producing duplicate/conflicting stations
      const best = new Map<string, TerminationRow>()
      for (const row of terminations as TerminationRow[]) {
        const key = `${(row.utility_name || '').toUpperCase()}::${(row.termination_type || '').toUpperCase()}`
        const existing = best.get(key)
        if (!existing || (row.confidence ?? 0) > (existing.confidence ?? 0)) {
          best.set(key, row)
        }
      }

      for (const row of best.values()) {
        const sheet = normalizeSheetNumber(row.sheet_number)
        if (row.sheet_number) sheets.push(sheet)

        findings.push({
          statement: `${row.utility_name} — ${row.termination_type} at Station ${row.station || 'unknown'} (Sheet: ${sheet})`,
          sheetNumber: sheet,
          entityValue: `${row.utility_name} ${row.termination_type}`,
          entityType: 'station',
          confidence: row.confidence ?? 0.9,
        })
      }
    }
  }

  // ── Utility crossings ────────────────────────────────────────────────────
  if (analysis.answerMode === 'crossing_lookup' || /cross|crossing|utilities crossing/i.test(q)) {
    const crossingQuery = supabase
      .from('utility_crossings')
      .select('utility_name, crossing_utility, utility_full_name, station, elevation, is_existing, is_proposed, size, sheet_number, confidence')
      .eq('project_id', projectId)

    if (targetSystem) {
      crossingQuery.ilike('utility_name', `%${targetSystem}%`)
    }

    const { data: crossings, error: cErr } = await crossingQuery

    if (cErr) {
      gaps.push(`Could not query utility crossings: ${cErr.message}`)
    } else if (crossings && crossings.length > 0) {
      for (const row of crossings as CrossingRow[]) {
        const sheet = normalizeSheetNumber(row.sheet_number)
        if (row.sheet_number) sheets.push(sheet)

        const crossType = row.is_existing ? 'Existing' : row.is_proposed ? 'Proposed' : 'Unknown'
        const elevStr = row.elevation != null ? ` @ El. ${row.elevation.toFixed(2)} ft` : ''
        const sizeStr = row.size ? ` (${row.size})` : ''

        findings.push({
          statement: `${row.utility_name} × ${row.utility_full_name || row.crossing_utility} — ${crossType}${sizeStr}${elevStr}, Station: ${row.station || 'unknown'} (Sheet: ${sheet})`,
          sheetNumber: sheet,
          entityValue: `${row.crossing_utility}${sizeStr}`,
          entityType: 'crossing',
          confidence: row.confidence ?? 0.85,
        })
      }
    } else if (!crossings || crossings.length === 0) {
      gaps.push('No utility crossing records found — profile view sheets may not have been fully indexed.')
    }
  }

  // ── Sheet coverage (which sheets contain X) ──────────────────────────────
  if (/which sheets|what sheets|where is/i.test(q)) {
    const keyword = targetSystem || analysis.entities.itemName || ''
    if (keyword) {
      const { data: chunks } = await supabase
        .from('document_chunks')
        .select('sheet_number, content')
        .eq('project_id', projectId)
        .ilike('content', `%${keyword}%`)
        .not('sheet_number', 'is', null)
        .limit(50)

      if (chunks && chunks.length > 0) {
        const distinctSheets = [...new Set<string>(chunks.map((c: { sheet_number: string }) => normalizeSheetNumber(c.sheet_number)))]
        for (const sheet of distinctSheets) {
          sheets.push(sheet)
          findings.push({
            statement: `"${keyword}" appears on Sheet ${sheet}`,
            sheetNumber: sheet,
            entityValue: keyword,
            entityType: 'utility_system',
            confidence: 0.8,
          })
        }
      } else {
        gaps.push(`No sheets found mentioning "${keyword}".`)
      }
    }
  }

  // Phase 2 supplement: query sheet_entities for structure/equipment records
  // (e.g. "where is manhole MH-12", "which sheet has catch basin CB-4")
  const structKeyword = deriveEntityKeyword(q) || targetSystem
  if (structKeyword) {
    const structRows = await querySheetEntities(projectId, 'structure', structKeyword, supabase)
    const equipRows = await querySheetEntities(projectId, 'equipment_label', structKeyword, supabase)
    const detailRows = await querySheetEntities(projectId, 'detail_reference', structKeyword, supabase)

    for (const row of [...structRows, ...equipRows, ...detailRows]) {
      const sheet = normalizeSheetNumber(row.sheet_number)
      if (row.sheet_number && !sheets.includes(sheet)) sheets.push(sheet)
      findings.push({
        statement: `${row.entity_value}${row.entity_context ? ` — ${row.entity_context}` : ''} on Sheet ${sheet}`,
        sheetNumber: sheet,
        entityValue: row.entity_value,
        entityType: 'component',
        confidence: row.confidence ?? 0.9,
      })
    }
  }

  // Entity graph: handles non-utility global queries ("which sheet shows
  // footing F3?", "where is column C-4?", "where does door D-14 appear?")
  const entityKeyword = deriveEntityKeyword(q) || targetSystem
  const entityDiscipline = deriveEntityDiscipline(q)
  if (entityKeyword) {
    const graphRows = await queryEntityGraph(projectId, entityKeyword, entityDiscipline, supabase)
    if (graphRows.length > 0) {
      const graphFindings = entityRowsToFindings(graphRows)
      for (const f of graphFindings) {
        findings.push(f)
        if (f.sheetNumber !== 'Unknown') sheets.push(f.sheetNumber)
      }
    }
  }

  return { findings: deduplicateFindings(findings), sheets, gaps }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main verification entry point.
 *
 * Classifies the query, runs the appropriate verification tier, and returns
 * a SheetVerificationResult with confirmed findings and sheet citations.
 *
 * Returns verificationClass='skip' immediately for Type A queries.
 */
export async function verifyBeforeAnswering(
  analysis: QueryAnalysis,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<SheetVerificationResult> {
  const verificationClass = classifyVerificationNeed(analysis)

  const questionType = classToQuestionType(verificationClass)
  console.log('[SheetVerifier] Class:', verificationClass, `(Type ${questionType})`, '| Mode:', analysis.answerMode)

  if (verificationClass === 'skip') {
    return {
      verificationClass: 'skip',
      questionType: 'A',
      wasVerified: false,
      verifiedFindings: [],
      sheetsInspected: [],
      candidateSheets: [],
      coverageStatus: 'complete',  // Type A: trust the existing pipeline
      confirmedContext: '',
      evidenceGaps: [],
      missingEvidence: [],
    }
  }

  // Gather candidate sheets before running verification so callers can compare
  // what was available vs. what was found.
  const candidateSheets = await queryCandidateSheets(projectId, supabase)

  let findings: VerifiedFinding[] = []
  let sheets: string[] = []
  let gaps: string[] = []

  try {
    if (verificationClass === 'enumeration') {
      ;({ findings, sheets, gaps } = await verifyEnumeration(analysis, projectId, supabase))
    } else if (verificationClass === 'measurement') {
      ;({ findings, sheets, gaps } = await verifyMeasurement(analysis, projectId, supabase))
    } else {
      // 'global'
      ;({ findings, sheets, gaps } = await verifyGlobal(analysis, projectId, supabase))
    }
  } catch (err) {
    console.error('[SheetVerifier] Verification error:', err)
    gaps.push(`Verification failed: ${err instanceof Error ? err.message : 'unknown error'}`)
  }

  const distinctSheets = [...new Set(sheets)].sort()
  const coverageStatus = computeCoverageStatus(findings, gaps)
  const confirmedContext = formatConfirmedContext(verificationClass, findings, distinctSheets, gaps)

  console.log('[SheetVerifier] Verified:', {
    class: verificationClass,
    questionType,
    findings: findings.length,
    sheets: distinctSheets.length,
    candidates: candidateSheets.length,
    coverageStatus,
    gaps: gaps.length,
  })

  return {
    verificationClass,
    questionType,
    wasVerified: true,
    verifiedFindings: findings,
    sheetsInspected: distinctSheets,
    candidateSheets,
    coverageStatus,
    confirmedContext,
    evidenceGaps: gaps,
    missingEvidence: gaps,
  }
}

/**
 * Convert a SheetVerificationResult into EvidenceItems that can be
 * merged into the existing EvidencePacket.
 *
 * This injects verification findings at the TOP of the evidence list
 * so the response-writer treats them as highest-priority.
 */
export function verificationToEvidenceItems(result: SheetVerificationResult): EvidenceItem[] {
  if (!result.wasVerified || result.verifiedFindings.length === 0) return []

  return result.verifiedFindings.map(f => ({
    source: 'vision_db' as const,
    content: f.statement,
    citation: {
      sheetNumber: f.sheetNumber !== 'Unknown' ? f.sheetNumber : undefined,
    },
    confidence: f.confidence,
    rawData: { entityType: f.entityType, entityValue: f.entityValue },
  }))
}
