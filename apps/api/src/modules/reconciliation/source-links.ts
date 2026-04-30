import { supabaseAdmin } from "../../db/supabase.js";

type SourceLinkRow = {
  id: string;
  initiative_id: string;
  source_record_id: string;
  confidence: number | null;
  is_primary: boolean;
  source_records?:
    | {
        source_id?: string | null;
        sources?:
          | {
              system?: string | null;
              priority?: number | null;
            }
          | Array<{
              system?: string | null;
              priority?: number | null;
            }>
          | null;
      }
    | Array<{
        source_id?: string | null;
        sources?:
          | {
              system?: string | null;
              priority?: number | null;
            }
          | Array<{
              system?: string | null;
              priority?: number | null;
            }>
          | null;
      }>
    | null;
};

export type RankedSourceLink = {
  linkId: string;
  initiativeId: string;
  sourceRecordId: string;
  sourceSystem: string | null;
  sourcePriority: number;
  confidence: number;
  isPrimary: boolean;
};

export type PrimarySourceRebalanceResult = {
  initiativeId: string;
  changed: boolean;
  selectedLinkId: string | null;
  selectedSourceSystem: string | null;
  linkCount: number;
};

export function pickPrimarySourceLink(links: RankedSourceLink[]): RankedSourceLink | null {
  if (links.length === 0) {
    return null;
  }

  return [...links].sort(compareRankedSourceLinks)[0] ?? null;
}

export async function rebalanceInitiativePrimarySourceLinks(
  initiativeId: string
): Promise<PrimarySourceRebalanceResult> {
  const links = await fetchRankedSourceLinksForInitiative(initiativeId);
  const selected = pickPrimarySourceLink(links);

  let changed = false;

  for (const link of links) {
    const shouldBePrimary = selected ? link.linkId === selected.linkId : false;
    if (link.isPrimary === shouldBePrimary) {
      continue;
    }

    const { error } = await supabaseAdmin
      .from("initiative_source_links")
      .update({ is_primary: shouldBePrimary })
      .eq("id", link.linkId);

    if (error) {
      throw new Error(`Failed to update primary flag for source link ${link.linkId}: ${error.message}`);
    }

    changed = true;
  }

  return {
    initiativeId,
    changed,
    selectedLinkId: selected?.linkId ?? null,
    selectedSourceSystem: selected?.sourceSystem ?? null,
    linkCount: links.length
  };
}

export async function fetchRankedSourceLinksForInitiative(initiativeId: string): Promise<RankedSourceLink[]> {
  const { data, error } = await supabaseAdmin
    .from("initiative_source_links")
    .select("id, initiative_id, source_record_id, confidence, is_primary, source_records(source_id, sources(system, priority))")
    .eq("initiative_id", initiativeId);

  if (error) {
    throw new Error(`Failed to fetch source links for initiative ${initiativeId}: ${error.message}`);
  }

  return ((data ?? []) as SourceLinkRow[]).map(normalizeRankedSourceLink);
}

export function normalizeRankedSourceLink(row: SourceLinkRow): RankedSourceLink {
  const sourceRecord = Array.isArray(row.source_records) ? row.source_records[0] : row.source_records;
  const sourceMeta = Array.isArray(sourceRecord?.sources) ? sourceRecord?.sources[0] : sourceRecord?.sources;

  return {
    linkId: row.id,
    initiativeId: row.initiative_id,
    sourceRecordId: row.source_record_id,
    sourceSystem: sourceMeta?.system ?? null,
    sourcePriority: sourceMeta?.priority ?? 999,
    confidence: row.confidence ?? 0,
    isPrimary: row.is_primary
  };
}

function compareRankedSourceLinks(left: RankedSourceLink, right: RankedSourceLink): number {
  if (left.sourcePriority !== right.sourcePriority) {
    return left.sourcePriority - right.sourcePriority;
  }

  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }

  if ((left.sourceSystem ?? "") !== (right.sourceSystem ?? "")) {
    return (left.sourceSystem ?? "").localeCompare(right.sourceSystem ?? "");
  }

  return left.linkId.localeCompare(right.linkId);
}
