import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { supabaseAdmin } from "../db/supabase.js";
import { buildDuplicateMergePlans, type DuplicateCluster } from "../modules/reconciliation/duplicate-initiatives.js";

type InitiativeRow = {
  id: string;
  canonical_title: string;
  title_normalized: string;
  presented_at: string | null;
  normalized_status: string;
  originating_chamber: string | null;
  metadata: Record<string, unknown> | null;
};

async function main() {
  const outFile = getStringArg("--out-file") ?? "duplicate-initiative-report.json";

  const [initiatives, sourceLinks, authors, commissions, events] = await Promise.all([
    fetchAllInitiatives(),
    fetchCountMap("initiative_source_links"),
    fetchCountMap("initiative_authors"),
    fetchCountMap("initiative_commissions"),
    fetchCountMap("legislative_events")
  ]);

  const sourceMeta = await fetchSourceMetaByInitiative();

  const clusters = buildClusters(
    initiatives.map((initiative) => ({
      ...initiative,
      sourceLinkCount: sourceLinks.get(initiative.id) ?? 0,
      authorCount: authors.get(initiative.id) ?? 0,
      commissionCount: commissions.get(initiative.id) ?? 0,
      eventCount: events.get(initiative.id) ?? 0,
      sourcePriority: sourceMeta.get(initiative.id)?.sourcePriority ?? 999,
      sourceSystems: sourceMeta.get(initiative.id)?.sourceSystems ?? []
    }))
  );

  const plans = buildDuplicateMergePlans(clusters);
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      clusters: clusters.length,
      initiativesInClusters: clusters.reduce((sum, cluster) => sum + cluster.candidates.length, 0),
      mergePlans: plans.length
    },
    plans
  };

  await writeFile(resolve(outFile), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

function buildClusters(
  initiatives: Array<
    InitiativeRow & {
      sourcePriority: number;
      sourceSystems: string[];
      sourceLinkCount: number;
      eventCount: number;
      authorCount: number;
      commissionCount: number;
    }
  >
): DuplicateCluster[] {
  const grouped = new Map<string, typeof initiatives>();

  for (const initiative of initiatives) {
    const key = [
      initiative.title_normalized,
      initiative.presented_at ?? "no-date",
      initiative.originating_chamber ?? "no-chamber"
    ].join("|");
    const current = grouped.get(key);
    if (current) {
      current.push(initiative);
      continue;
    }
    grouped.set(key, [initiative]);
  }

  return [...grouped.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([matchKey, rows]) => ({
      matchKey,
      candidates: rows.map((row) => ({
        initiativeId: row.id,
        canonicalTitle: row.canonical_title,
        titleNormalized: row.title_normalized,
        presentedAt: row.presented_at,
        normalizedStatus: row.normalized_status,
        parser: readString(row.metadata, "parser"),
        sourcePriority: row.sourcePriority,
        sourceSystems: row.sourceSystems,
        sourceLinkCount: row.sourceLinkCount,
        eventCount: row.eventCount,
        authorCount: row.authorCount,
        commissionCount: row.commissionCount
      }))
    }));
}

async function fetchAllInitiatives(): Promise<InitiativeRow[]> {
  return fetchPaginated<InitiativeRow>(
    "initiatives",
    "id, canonical_title, title_normalized, presented_at, normalized_status, originating_chamber, metadata"
  );
}

async function fetchCountMap(table: string): Promise<Map<string, number>> {
  const rows = await fetchPaginated<{ initiative_id: string }>(table, "initiative_id");
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.initiative_id, (counts.get(row.initiative_id) ?? 0) + 1);
  }

  return counts;
}

async function fetchSourceMetaByInitiative(): Promise<
  Map<
    string,
    {
      sourcePriority: number;
      sourceSystems: string[];
    }
  >
> {
  const sourceRows = await fetchPaginated<{ id: string; system: string; priority: number }>("sources", "id, system, priority");
  const sourceMap = new Map(sourceRows.map((row) => [row.id, row]));
  const recordRows = await fetchPaginated<{ id: string; source_id: string }>("source_records", "id, source_id");
  const recordMap = new Map(recordRows.map((row) => [row.id, row.source_id]));
  const linkRows = await fetchPaginated<{ initiative_id: string; source_record_id: string }>(
    "initiative_source_links",
    "initiative_id, source_record_id"
  );

  const grouped = new Map<string, { sourcePriority: number; sourceSystems: Set<string> }>();

  for (const row of linkRows) {
    const sourceId = recordMap.get(row.source_record_id);
    const source = sourceId ? sourceMap.get(sourceId) : null;
    if (!source) {
      continue;
    }

    const current = grouped.get(row.initiative_id) ?? {
      sourcePriority: 999,
      sourceSystems: new Set<string>()
    };

    current.sourcePriority = Math.min(current.sourcePriority, source.priority);
    current.sourceSystems.add(source.system);
    grouped.set(row.initiative_id, current);
  }

  return new Map(
    [...grouped.entries()].map(([initiativeId, value]) => [
      initiativeId,
      {
        sourcePriority: value.sourcePriority,
        sourceSystems: [...value.sourceSystems].sort()
      }
    ])
  );
}

async function fetchPaginated<T>(table: string, select: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin.from(table).select(select).range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch ${table}: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...(data as T[]));

    if (data.length < pageSize) {
      break;
    }
  }

  return rows;
}

function readString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getStringArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((value) => value === flag);
  return index === -1 ? undefined : args[index + 1];
}

void main().catch((error) => {
  console.error("Duplicate initiative report failed", error);
  process.exitCode = 1;
});
