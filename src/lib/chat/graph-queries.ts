/**
 * Graph Queries — Phase 2
 *
 * Read-only retrieval helpers backed by the universal entity model.
 * These are parallel to (NOT replacements for) the legacy vision-queries.ts
 * functions. They are used exclusively in the validation harness during Phase 2.
 *
 * Each function mirrors the return type of its legacy counterpart so results
 * can be compared directly in graph-validator.ts.
 *
 * Phase 3 note: if graph-backed results are validated correct, the smart-router
 * can be updated to call these instead of (or alongside) the legacy functions.
 */

import { createClient } from '@/lib/db/supabase/server';
import {
  COMPONENT_PATTERNS,
  type ComponentQueryResult,
  type CrossingQueryResult,
  type LengthQueryResult,
} from './vision-queries';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract size from item display_name (mirrors vision-queries.ts extractSize)
 */
function extractSize(name: string): string | null {
  const match = name.match(/(\d+[\-"]?\s*(?:IN|INCH|")?)/i);
  return match ? match[1].toUpperCase().replace(/\s+/g, '-') : null;
}

/**
 * Compute canonical_name from a utility name string.
 * Must match the SQL rule used in the backfill migration.
 */
export function toCanonicalName(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------
// Graph-backed component count
// ---------------------------------------------------------------------------

/**
 * Query entity graph for component counts.
 *
 * Reads project_entities (entity_type = 'component') filtered by
 * COMPONENT_PATTERNS on display_name, then sums entity_findings quantities.
 *
 * Returns the same ComponentQueryResult shape as queryComponentCount().
 */
export async function queryGraphComponentCount(
  projectId: string,
  componentType: string,
  utilityFilter?: string,
  sizeFilter?: string
): Promise<ComponentQueryResult> {
  const supabase = await createClient();

  console.log(`[Graph Queries] Component count: ${componentType} project=${projectId}`);

  try {
    // Cast to any: project_entities is not yet in the generated Supabase types
    const db = supabase as any;
    const { data: entities, error } = await db
      .from('project_entities')
      .select(`
        id, canonical_name, display_name, label, subtype, confidence,
        entity_findings(finding_type, numeric_value, unit, confidence, metadata),
        entity_locations(station_value, sheet_number)
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'utility')
      .eq('entity_type', 'component');

    if (error) throw error;

    const patterns = COMPONENT_PATTERNS[componentType.toLowerCase()] ?? [
      new RegExp(componentType, 'i'),
    ];

    const matched = (entities ?? []).filter((e: any) => {
      const name = (e.display_name ?? '').toLowerCase();
      if (!patterns.some((p) => p.test(name))) return false;

      if (sizeFilter) {
        const num = sizeFilter.match(/(\d+)/)?.[1];
        const sizeNum = extractSize(e.display_name ?? '')?.match(/(\d+)/)?.[1];
        if (!num || num !== sizeNum) return false;
      }

      if (utilityFilter) {
        const f = utilityFilter.toLowerCase();
        if (!name.includes(f)) return false;
      }

      return true;
    });

    let totalCount = 0;
    const itemsBySize: Record<string, { count: number; items: ComponentQueryResult['items'] }> = {};

    for (const entity of matched) {
      const quantityFinding = (entity.entity_findings as any[])?.find(
        (f) => f.finding_type === 'quantity'
      );
      const qty = quantityFinding?.numeric_value ?? 1;
      const size = extractSize(entity.display_name ?? '') ?? 'Unknown';
      const station =
        ((entity.entity_locations as any[])?.[0]?.station_value) ?? undefined;
      const sheet =
        ((entity.entity_locations as any[])?.[0]?.sheet_number) ?? undefined;

      if (!itemsBySize[size]) itemsBySize[size] = { count: 0, items: [] };
      itemsBySize[size].count += qty;
      itemsBySize[size].items.push({
        itemName:    entity.display_name ?? entity.canonical_name,
        quantity:    qty,
        size,
        station,
        sheetNumber: sheet,
        confidence:  entity.confidence ?? 0.8,
      });
      totalCount += qty;
    }

    const avgConfidence =
      matched.length > 0
        ? matched.reduce((s: number, e: any) => s + (e.confidence ?? 0.8), 0) / matched.length
        : 0;

    const formattedAnswer =
      totalCount === 0
        ? `No ${componentType}s found in entity graph${utilityFilter ? ` for ${utilityFilter}` : ''}.`
        : `**${componentType} count (graph-backed):** ${totalCount}\n` +
          Object.entries(itemsBySize)
            .map(([s, v]) => `  - ${s}: ${v.count}`)
            .join('\n');

    console.log(`[Graph Queries] Found ${totalCount} ${componentType}(s) from ${matched.length} entities`);

    return {
      success: totalCount > 0,
      componentType,
      totalCount,
      items: Object.values(itemsBySize).flatMap((v) => v.items),
      source: 'Entity graph (project_entities + entity_findings)',
      confidence: avgConfidence,
      formattedAnswer,
    };
  } catch (err) {
    console.error('[Graph Queries] Error in queryGraphComponentCount:', err);
    return {
      success: false,
      componentType,
      totalCount: 0,
      items: [],
      source: 'Error querying entity graph',
      confidence: 0,
      formattedAnswer: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Graph-backed crossings
// ---------------------------------------------------------------------------

/**
 * Query entity graph for utility crossings.
 *
 * Reads project_entities (entity_type = 'crossing') + their findings/locations.
 * Returns the same CrossingQueryResult shape as queryCrossings().
 */
export async function queryGraphCrossings(
  projectId: string,
  utilityFilter?: string
): Promise<CrossingQueryResult> {
  const supabase = await createClient();

  console.log(`[Graph Queries] Crossings for project=${projectId}`);

  try {
    const db = supabase as any;
    let query = db
      .from('project_entities')
      .select(`
        id, canonical_name, display_name, label, subtype, status, confidence,
        metadata,
        entity_locations(station_value, station_numeric, sheet_number, is_primary),
        entity_findings(finding_type, numeric_value, text_value, unit, statement)
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'utility')
      .eq('entity_type', 'crossing');

    if (utilityFilter) {
      query = query.ilike('display_name', `%${utilityFilter}%`);
    }

    const { data: entities, error } = await query;
    if (error) throw error;

    const crossings: CrossingQueryResult['crossings'] = (entities ?? []).map((e: any) => {
      const loc = ((e.entity_locations as any[]) ?? []).find((l) => l.is_primary) ?? (e.entity_locations as any[])?.[0];
      const elevFinding = ((e.entity_findings as any[]) ?? []).find((f) => f.finding_type === 'elevation');
      const meta = e.metadata as Record<string, unknown> | null ?? {};

      return {
        crossingUtility: (e.label ?? e.subtype ?? '').toUpperCase(),
        utilityFullName:
          ((e.display_name ?? '').replace(/ crossing at .*/i, '').trim()) || (e.label ?? ''),
        station:     loc?.station_value   ?? undefined,
        elevation:   elevFinding?.numeric_value ?? (meta.elevation as number | undefined) ?? undefined,
        isExisting:  e.status === 'existing',
        isProposed:  e.status === 'proposed',
        size:        (meta.size as string | undefined) ?? undefined,
        sheetNumber: loc?.sheet_number ?? undefined,
        confidence:  e.confidence ?? 0.8,
      };
    });

    // Build summary counts by crossing utility type
    const summaryMap: Record<string, CrossingQueryResult['summary'][0]> = {};
    for (const c of crossings) {
      const key = c.crossingUtility;
      if (!summaryMap[key]) {
        summaryMap[key] = {
          crossingUtility: c.crossingUtility,
          utilityFullName: c.utilityFullName,
          totalCount:    0,
          existingCount: 0,
          proposedCount: 0,
        };
      }
      summaryMap[key].totalCount++;
      if (c.isExisting) summaryMap[key].existingCount++;
      if (c.isProposed) summaryMap[key].proposedCount++;
    }

    const summary = Object.values(summaryMap);
    const avgConfidence =
      crossings.length > 0
        ? crossings.reduce((s, c) => s + c.confidence, 0) / crossings.length
        : 0;

    const formattedAnswer =
      crossings.length === 0
        ? `No utility crossings found in entity graph${utilityFilter ? ` for ${utilityFilter}` : ''}.`
        : `**Utility Crossings (graph-backed):** ${crossings.length} total\n` +
          summary.map((s) => `  - ${s.utilityFullName} (${s.crossingUtility}): ${s.totalCount} (${s.existingCount} existing, ${s.proposedCount} proposed)`).join('\n');

    console.log(`[Graph Queries] Found ${crossings.length} crossings`);

    return {
      success: crossings.length > 0,
      totalCrossings: crossings.length,
      crossings,
      summary,
      source: 'Entity graph (project_entities, entity_type=crossing)',
      confidence: avgConfidence,
      formattedAnswer,
    };
  } catch (err) {
    console.error('[Graph Queries] Error in queryGraphCrossings:', err);
    return {
      success: false,
      totalCrossings: 0,
      crossings: [],
      summary: [],
      source: 'Error querying entity graph',
      confidence: 0,
      formattedAnswer: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Graph-backed utility length
// ---------------------------------------------------------------------------

/**
 * Compute utility length from junction entities in the entity graph.
 *
 * Strategy:
 *  1. Find the linear_asset entity for the utility by canonical_name match.
 *  2. Find all junction entities related to it via 'located_in' relationships.
 *  3. Extract BEGIN and END station_numerics.
 *  4. Compute length = END.station_numeric - BEGIN.station_numeric.
 *
 * Falls back to direct junction search by display_name if no linear_asset
 * is found (handles cases where only termination rows exist, no quantity row).
 *
 * Returns the same LengthQueryResult shape as queryUtilityLength().
 */
export async function queryGraphUtilityLength(
  projectId: string,
  utilityName: string
): Promise<LengthQueryResult> {
  const supabase = await createClient();

  console.log(`[Graph Queries] Utility length: "${utilityName}" project=${projectId}`);

  try {
    // Cast to any: entity graph tables not yet in generated Supabase types
    const db = supabase as any;

    // --- Strategy 1: via entity_relationships (preferred) ---
    const canonicalName = toCanonicalName(utilityName);

    const { data: linearAsset } = await db
      .from('project_entities')
      .select('id, display_name')
      .eq('project_id', projectId)
      .eq('discipline', 'utility')
      .eq('entity_type', 'linear_asset')
      .eq('canonical_name', canonicalName)
      .maybeSingle();

    let junctions: Array<{
      id: string;
      display_name: string | null;
      metadata: Record<string, unknown> | null;
      entity_locations: Array<{
        station_value: string | null;
        station_numeric: number | null;
        sheet_number: string | null;
      }>;
    }> = [];

    if (linearAsset) {
      // Traverse relationships to find linked junctions
      const { data: rels } = await db
        .from('entity_relationships')
        .select('from_entity_id')
        .eq('project_id', projectId)
        .eq('to_entity_id', linearAsset.id)
        .eq('relationship_type', 'located_in');

      const junctionIds = (rels ?? []).map((r: any) => r.from_entity_id);

      if (junctionIds.length > 0) {
        const { data: junctionEntities } = await db
          .from('project_entities')
          .select(`
            id, display_name, metadata,
            entity_locations(station_value, station_numeric, sheet_number)
          `)
          .in('id', junctionIds)
          .eq('entity_type', 'junction');

        junctions = (junctionEntities ?? []) as typeof junctions;
      }
    }

    // --- Strategy 2: fallback — match junction display_name ---
    if (junctions.length === 0) {
      const { data: fallbackJunctions } = await db
        .from('project_entities')
        .select(`
          id, display_name, metadata,
          entity_locations(station_value, station_numeric, sheet_number)
        `)
        .eq('project_id', projectId)
        .eq('discipline', 'utility')
        .eq('entity_type', 'junction')
        .ilike('display_name', `%${utilityName}%`);

      junctions = (fallbackJunctions ?? []) as typeof junctions;
    }

    if (junctions.length === 0) {
      return {
        success: false,
        utilityName,
        lengthLf: 0,
        beginStation: '',
        endStation: '',
        confidence: 0,
        source: 'Entity graph — no junction entities found',
        formattedAnswer: `No termination/junction entities found for "${utilityName}" in entity graph.`,
      };
    }

    // Extract BEGIN and END termination types — handle branched utilities
    const beginJunctions = junctions.filter(
      (j) => (j.metadata as any)?.termination_type === 'BEGIN'
    );
    const endJunctions = junctions.filter(
      (j) => (j.metadata as any)?.termination_type === 'END'
    );

    if (beginJunctions.length === 0 || endJunctions.length === 0) {
      const types = junctions
        .map((j) => (j.metadata as any)?.termination_type)
        .filter(Boolean)
        .join(', ');
      return {
        success: false,
        utilityName,
        lengthLf: 0,
        beginStation: '',
        endStation: '',
        confidence: 0,
        source: 'Entity graph — missing BEGIN or END junction',
        formattedAnswer:
          `Partial junction data for "${utilityName}". Found: ${types || 'none'}. Cannot compute length.`,
      };
    }

    if (beginJunctions.length > 1 || endJunctions.length > 1) {
      console.warn(
        `[Graph Queries] Multiple BEGIN/END junctions for "${utilityName}" ` +
        `(${beginJunctions.length} BEGIN, ${endJunctions.length} END) — ` +
        `utility may be branched. Using min-station BEGIN, max-station END.`
      );
    }

    // Pick lowest-station BEGIN (true start of main line)
    const beginJunction = beginJunctions.sort((a, b) => {
      const aS = a.entity_locations?.[0]?.station_numeric ?? Infinity;
      const bS = b.entity_locations?.[0]?.station_numeric ?? Infinity;
      return aS - bS;
    })[0];

    // Pick highest-station END (true end of main line)
    const endJunction = endJunctions.sort((a, b) => {
      const aS = a.entity_locations?.[0]?.station_numeric ?? -Infinity;
      const bS = b.entity_locations?.[0]?.station_numeric ?? -Infinity;
      return bS - aS;
    })[0];

    const beginLoc = beginJunction.entity_locations?.[0];
    const endLoc   = endJunction.entity_locations?.[0];

    if (beginLoc?.station_numeric == null || endLoc?.station_numeric == null) {
      return {
        success: false,
        utilityName,
        lengthLf: 0,
        beginStation: beginLoc?.station_value ?? '',
        endStation:   endLoc?.station_value   ?? '',
        confidence: 0,
        source: 'Entity graph — station numerics missing',
        formattedAnswer:
          `Junction entities found for "${utilityName}" but station_numeric is null — cannot compute length.`,
      };
    }

    const lengthLf = endLoc.station_numeric - beginLoc.station_numeric;

    return {
      success: true,
      utilityName,
      lengthLf,
      beginStation: beginLoc.station_value ?? '',
      endStation:   endLoc.station_value   ?? '',
      beginSheet:   beginLoc.sheet_number  ?? undefined,
      endSheet:     endLoc.sheet_number    ?? undefined,
      confidence: 0.95,
      source: 'Entity graph (junction entities + located_in relationships)',
      formattedAnswer:
        `**${utilityName} length (graph-backed):** ${lengthLf.toFixed(2)} LF\n` +
        `  Begin: Sta. ${beginLoc.station_value}${beginLoc.sheet_number ? ` (Sheet ${beginLoc.sheet_number})` : ''}\n` +
        `  End:   Sta. ${endLoc.station_value}${endLoc.sheet_number ? ` (Sheet ${endLoc.sheet_number})` : ''}`,
    };
  } catch (err) {
    console.error('[Graph Queries] Error in queryGraphUtilityLength:', err);
    return {
      success: false,
      utilityName,
      lengthLf: 0,
      beginStation: '',
      endStation: '',
      confidence: 0,
      source: 'Error querying entity graph',
      formattedAnswer: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Graph-backed terminations
// ---------------------------------------------------------------------------

/**
 * Query junction entities for a specific utility.
 * Returns raw junction data comparable to getTerminationPointsForUtility().
 */
export interface GraphTerminationResult {
  success:          boolean;
  utilityName:      string;
  terminations: Array<{
    terminationType: string;
    station:         string | null;
    stationNumeric:  number | null;
    sheetNumber:     string | null;
    notes:           string | null;
    confidence:      number;
    entityId:        string;
  }>;
  source:           string;
}

export async function queryGraphTerminations(
  projectId: string,
  utilityName: string
): Promise<GraphTerminationResult> {
  const supabase = await createClient();

  try {
    const db = supabase as any;
    const { data: junctions, error } = await db
      .from('project_entities')
      .select(`
        id, display_name, confidence, metadata,
        entity_locations(station_value, station_numeric, sheet_number, is_primary)
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'utility')
      .eq('entity_type', 'junction')
      .ilike('display_name', `%${utilityName}%`);

    if (error) throw error;

    const terminations = (junctions ?? []).map((j: any) => {
      const meta = (j.metadata as Record<string, unknown>) ?? {};
      const loc  = ((j.entity_locations as any[]) ?? []).find((l: any) => l.is_primary) ??
                   (j.entity_locations as any[])?.[0];
      return {
        terminationType: (meta.termination_type as string) ?? '',
        station:         (meta.station as string)          ?? loc?.station_value  ?? null,
        stationNumeric:  (meta.station_numeric as number)  ?? loc?.station_numeric ?? null,
        sheetNumber:     loc?.sheet_number ?? null,
        notes:           (meta.notes as string)            ?? null,
        confidence:      j.confidence ?? 0.8,
        entityId:        j.id,
      };
    });

    return {
      success:     terminations.length > 0,
      utilityName,
      terminations,
      source: 'Entity graph (junction entities)',
    };
  } catch (err) {
    console.error('[Graph Queries] Error in queryGraphTerminations:', err);
    return {
      success:     false,
      utilityName,
      terminations: [],
      source: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Graph-backed entity summary
// ---------------------------------------------------------------------------

/**
 * Aggregate entity counts for a project.
 * Comparable to getVisionDataSummary() from vision-queries.ts.
 */
export interface GraphEntitySummary {
  totalEntities:      number;
  byEntityType:       Record<string, number>;
  linearAssetCount:   number;
  componentCount:     number;
  junctionCount:      number;
  crossingCount:      number;
  findingCount:       number;
  citationCount:      number;
  relationshipCount:  number;
}

export async function queryGraphEntitySummary(
  projectId: string
): Promise<GraphEntitySummary> {
  const supabase = await createClient();
  // Cast to any: entity graph tables not in generated Supabase types
  const db = supabase as any;

  const [entitiesRes, findingsRes, citationsRes, relsRes] = await Promise.all([
    db
      .from('project_entities')
      .select('entity_type')
      .eq('project_id', projectId)
      .eq('discipline', 'utility'),
    db
      .from('entity_findings')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId),
    db
      .from('entity_citations')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId),
    db
      .from('entity_relationships')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId),
  ]);

  const entities = (entitiesRes.data ?? []) as Array<{ entity_type: string }>;
  const byEntityType: Record<string, number> = {};
  for (const e of entities) {
    byEntityType[e.entity_type] = (byEntityType[e.entity_type] ?? 0) + 1;
  }

  return {
    totalEntities:     entities.length,
    byEntityType,
    linearAssetCount:  byEntityType['linear_asset']  ?? 0,
    componentCount:    byEntityType['component']      ?? 0,
    junctionCount:     byEntityType['junction']       ?? 0,
    crossingCount:     byEntityType['crossing']       ?? 0,
    findingCount:      findingsRes.count  ?? 0,
    citationCount:     citationsRes.count ?? 0,
    relationshipCount: relsRes.count      ?? 0,
  };
}
