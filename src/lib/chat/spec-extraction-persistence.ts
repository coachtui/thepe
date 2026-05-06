/**
 * Spec extraction persistence (A3b).
 *
 * Given a `SpecExtractionPipelineResult` from `runSpecExtractionPipeline()`,
 * this module writes the rows into the universal entity model:
 *   - project_entities (discipline='spec', entity_type='spec_section'|'spec_requirement')
 *   - entity_citations
 *   - entity_findings
 *
 * Idempotency: callers re-running spec extraction for the same document
 * trigger an explicit DELETE of `project_entities` rows matching
 * (project_id, discipline='spec', source_document_id) BEFORE the insert.
 * The schema's `ON DELETE CASCADE` foreign keys on
 * `entity_findings.entity_id`, `entity_citations.entity_id`, and
 * `entity_relationships.from/to_entity_id` clean up dependent rows
 * automatically — verified against live schema before this was written.
 *
 * Transactional caveat: supabase-js does not expose multi-statement
 * transactions to the JS client. The implementation runs sequential
 * write steps. A failure mid-flow leaves a partial state; the function
 * returns a structured outcome (never throws) so the caller (Inngest
 * function in A3c) can mark the run failed and decide whether to retry.
 *
 * Failure isolation: this is a no-throw boundary. Every internal error is
 * caught and reported via the returned outcome. Callers should not wrap
 * this in try/catch hoping to recover — it has already done that work.
 */

import { createServiceRoleClient } from '../db/supabase/service'
import type { Database } from '../db/supabase/types'
import {
  buildSpecPersistenceRows,
  type SpecPersistenceRowSet,
  type SpecExtractionPipelineResult,
  type BuildSpecPersistenceRowsOptions,
} from './spec-extraction-pipeline.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

/* eslint-disable @typescript-eslint/no-explicit-any */
// Some entity-graph tables (`project_entities`, `entity_findings`,
// `entity_citations`) are not yet in the generated `Database` types — they
// pre-date the workflow_runs regeneration. Until a follow-up regen catches
// them, the inserts use a narrow `any` cast at the boundary so this file
// stays compilable. Same pattern used by `mep-queries.ts`, `graph-queries.ts`,
// `submittal-queries.ts`, etc.
type AnyTable = any
/* eslint-enable @typescript-eslint/no-explicit-any */

void ({} as Database) // keep the import live for future regeneration

export interface PersistSpecExtractionOptions {
  projectId: string
  documentId: string
  result: SpecExtractionPipelineResult
  /** Optional override for the row builder. Mostly for tests. */
  rowBuilderOptions?: BuildSpecPersistenceRowsOptions
  /**
   * If provided, the wrapper uses this client instead of creating its own.
   * Useful for callers that already hold a service-role client (e.g. an
   * Inngest function) and for tests that inject a mock.
   */
  supabase?: ServiceRoleClient
  /**
   * When true, skip the full document-level delete before inserting.
   * Use in batched flows where the caller manages deletion (either a
   * one-time full delete at the start, or per-batch scoped deletes for
   * retry idempotency).
   */
  skipDelete?: boolean
}

export type PersistSpecExtractionStep =
  | 'delete_existing'
  | 'insert_section_entities'
  | 'insert_requirement_entities'
  | 'insert_citations'
  | 'insert_findings'

export interface PersistSpecExtractionOutcome {
  status: 'persisted' | 'skipped' | 'failed'
  sectionsWritten: number
  requirementsWritten: number
  citationsWritten: number
  findingsWritten: number
  /** Section count the row builder skipped (validationFailed + zero requirements). */
  sectionsSkippedByBuilder: number
  /** Step that failed when status === 'failed'. */
  failedAt?: PersistSpecExtractionStep | 'service_role_unavailable' | 'pre_check'
  warning?: string
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function persistSpecExtractionResult(
  opts: PersistSpecExtractionOptions
): Promise<PersistSpecExtractionOutcome> {
  // 1. Acquire a service-role client (or use the injected one).
  let supabase: ServiceRoleClient
  if (opts.supabase) {
    supabase = opts.supabase
  } else {
    try {
      supabase = createServiceRoleClient()
    } catch (err) {
      const warning = `[SpecExtractionPersistence] Service-role client unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`
      console.warn(warning)
      return zeroOutcome('failed', { failedAt: 'service_role_unavailable', warning })
    }
  }

  // 2. Build the row set deterministically.
  const rowSet = buildSpecPersistenceRows(
    opts.projectId,
    opts.documentId,
    opts.result,
    opts.rowBuilderOptions
  )

  // 3. Skip when nothing to write.
  if (rowSet.totalSectionCount === 0) {
    return zeroOutcome('skipped', {
      sectionsSkippedByBuilder: rowSet.skippedSectionCount,
      warning:
        rowSet.skippedSectionCount > 0
          ? `All ${rowSet.skippedSectionCount} sections were skipped by the row builder (validationFailed + zero requirements).`
          : 'Pipeline result contained zero sections.',
    })
  }

  // 4. Idempotent delete. Cascades to findings + citations + relationships
  //    via the schema's ON DELETE CASCADE foreign keys.
  //    Skipped when opts.skipDelete === true (caller manages deletion separately).
  if (!opts.skipDelete) {
    const del = await (supabase.from('project_entities') as AnyTable)
      .delete()
      .eq('project_id', opts.projectId)
      .eq('discipline', 'spec')
      .eq('source_document_id', opts.documentId)
    if (del.error) {
      return zeroOutcome('failed', {
        sectionsSkippedByBuilder: rowSet.skippedSectionCount,
        failedAt: 'delete_existing',
        warning: `delete existing spec entities failed: ${del.error.message}`,
      })
    }
  }

  // 5. Insert section entities. Returning id + canonical_name so we can
  //    correlate ids by canonical_name (which is unique per project).
  const sectionRows = rowSet.sections.map(s => s.sectionEntity)
  const sectionInsert = await (supabase.from('project_entities') as AnyTable)
    .insert(sectionRows)
    .select('id, canonical_name')
  if (sectionInsert.error) {
    return zeroOutcome('failed', {
      sectionsSkippedByBuilder: rowSet.skippedSectionCount,
      failedAt: 'insert_section_entities',
      warning: `section entity insert failed: ${sectionInsert.error.message}`,
    })
  }
  const sectionIdByCanonical = buildIdMap(sectionInsert.data)

  // 6. Insert requirement entities (flat across sections).
  const requirementRows = rowSet.sections.flatMap(s =>
    s.requirements.map(r => r.requirementEntity)
  )
  if (requirementRows.length === 0) {
    return {
      status: 'persisted',
      sectionsWritten: sectionRows.length,
      requirementsWritten: 0,
      citationsWritten: 0,
      findingsWritten: 0,
      sectionsSkippedByBuilder: rowSet.skippedSectionCount,
    }
  }
  const requirementInsert = await (supabase.from('project_entities') as AnyTable)
    .insert(requirementRows)
    .select('id, canonical_name')
  if (requirementInsert.error) {
    return zeroOutcome('failed', {
      sectionsWritten: sectionRows.length,
      sectionsSkippedByBuilder: rowSet.skippedSectionCount,
      failedAt: 'insert_requirement_entities',
      warning: `requirement entity insert failed: ${requirementInsert.error.message}`,
    })
  }
  const requirementIdByCanonical = buildIdMap(requirementInsert.data)

  // 7. Insert citations. Each citation is bound to its requirement entity
  //    by canonical_name → id mapping.
  const citationInsertRows = rowSet.sections.flatMap(s =>
    s.requirements.map(r => {
      const entity_id = requirementIdByCanonical.get(r.requirementEntity.canonical_name)
      return { ...r.citation, entity_id }
    })
  )
  const missingForCitations = citationInsertRows.filter(r => !r.entity_id).length
  if (missingForCitations > 0) {
    return zeroOutcome('failed', {
      sectionsWritten: sectionRows.length,
      requirementsWritten: requirementRows.length,
      sectionsSkippedByBuilder: rowSet.skippedSectionCount,
      failedAt: 'pre_check',
      warning: `${missingForCitations} citation row(s) missing entity_id after requirement insert — canonical_name correlation failed.`,
    })
  }
  const citationInsert = await (supabase.from('entity_citations') as AnyTable)
    .insert(citationInsertRows)
    .select('id, entity_id')
  if (citationInsert.error) {
    return zeroOutcome('failed', {
      sectionsWritten: sectionRows.length,
      requirementsWritten: requirementRows.length,
      sectionsSkippedByBuilder: rowSet.skippedSectionCount,
      failedAt: 'insert_citations',
      warning: `citation insert failed: ${citationInsert.error.message}`,
    })
  }
  const citationIdByEntityId = buildCitationMap(citationInsert.data)

  // 8. Insert findings. Each finding carries entity_id (from requirement
  //    map) and citation_id (from citation map).
  const findingInsertRows = rowSet.sections.flatMap(s =>
    s.requirements.map(r => {
      const entity_id = requirementIdByCanonical.get(r.requirementEntity.canonical_name)
      const citation_id = entity_id ? citationIdByEntityId.get(entity_id) : undefined
      return { ...r.finding, entity_id, citation_id }
    })
  )
  const findingInsert = await (supabase.from('entity_findings') as AnyTable).insert(findingInsertRows)
  if (findingInsert.error) {
    return zeroOutcome('failed', {
      sectionsWritten: sectionRows.length,
      requirementsWritten: requirementRows.length,
      citationsWritten: citationInsertRows.length,
      sectionsSkippedByBuilder: rowSet.skippedSectionCount,
      failedAt: 'insert_findings',
      warning: `finding insert failed: ${findingInsert.error.message}`,
    })
  }

  return {
    status: 'persisted',
    sectionsWritten: sectionRows.length,
    requirementsWritten: requirementRows.length,
    citationsWritten: citationInsertRows.length,
    findingsWritten: findingInsertRows.length,
    sectionsSkippedByBuilder: rowSet.skippedSectionCount,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IdRow {
  id: string
  canonical_name: string
}

function buildIdMap(rows: unknown): Map<string, string> {
  const map = new Map<string, string>()
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    if (
      r &&
      typeof r === 'object' &&
      typeof (r as IdRow).id === 'string' &&
      typeof (r as IdRow).canonical_name === 'string'
    ) {
      map.set((r as IdRow).canonical_name, (r as IdRow).id)
    }
  }
  return map
}

function buildCitationMap(rows: unknown): Map<string, string> {
  const map = new Map<string, string>()
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    if (
      r &&
      typeof r === 'object' &&
      typeof (r as { id?: unknown; entity_id?: unknown }).id === 'string' &&
      typeof (r as { id?: unknown; entity_id?: unknown }).entity_id === 'string'
    ) {
      map.set(
        (r as { entity_id: string }).entity_id,
        (r as { id: string }).id
      )
    }
  }
  return map
}

function zeroOutcome(
  status: PersistSpecExtractionOutcome['status'],
  partial: Partial<PersistSpecExtractionOutcome> = {}
): PersistSpecExtractionOutcome {
  return {
    status,
    sectionsWritten: 0,
    requirementsWritten: 0,
    citationsWritten: 0,
    findingsWritten: 0,
    sectionsSkippedByBuilder: 0,
    ...partial,
  }
}

export type { SpecPersistenceRowSet }
