import { supabaseAdmin } from "../db/supabase.js";
import { rebuildDiputadosInitiativeDerivedData } from "../ingestion/adapters/diputados-gaceta/persist.js";

type InitiativeRow = {
  id: string;
  canonical_title: string;
  summary: string | null;
  presented_at: string | null;
  raw_status: string | null;
  metadata: Record<string, unknown> | null;
  initiative_source_links: Array<{ source_record_id: string | null }> | null;
};

async function main() {
  const batchSize = getNumberArg("--batch-size") ?? 100;
  const maxItems = getNumberArg("--max-items");

  let offset = 0;
  let processed = 0;
  let updated = 0;
  let totalEvents = 0;
  let failed = 0;

  while (true) {
    const upperBound = offset + batchSize - 1;
    const { data, error } = await supabaseAdmin
      .from("initiatives")
      .select("id, canonical_title, summary, presented_at, raw_status, metadata, initiative_source_links(source_record_id)")
      .contains("metadata", { parser: "diputados-gaceta-list-v1" })
      .order("created_at", { ascending: true })
      .range(offset, upperBound);

    if (error) {
      throw new Error(`Failed to fetch diputados initiatives for backfill: ${error.message}`);
    }

    const rows = (data ?? []) as InitiativeRow[];
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      if (maxItems && processed >= maxItems) {
        console.log(
          JSON.stringify(
            {
              processed,
              updated,
              totalEvents
            },
            null,
            2
          )
        );
        return;
      }

      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const sourceRecordId = row.initiative_source_links?.[0]?.source_record_id ?? null;
      const chamber =
        typeof metadata.source_page_url === "string" && metadata.source_page_url.includes("diputados.gob.mx")
          ? "Cámara de Diputados"
          : null;

      try {
        const result = await rebuildDiputadosInitiativeDerivedData({
          initiativeId: row.id,
          canonicalTitle: row.canonical_title,
          summary: row.summary,
          presentedAt: row.presented_at,
          rawStatus: row.raw_status,
          chamber,
          metadata,
          sourceRecordId
        });

        updated += 1;
        totalEvents += result.eventCount;
      } catch (error) {
        failed += 1;
        console.error("[diputados-backfill] Failed initiative", {
          initiativeId: row.id,
          title: row.canonical_title,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      processed += 1;

      if (processed % 25 === 0) {
        console.log(
          `[diputados-backfill] Processed ${processed} initiatives, regenerated events: ${totalEvents}, failed: ${failed}`
        );
      }
    }

    offset += rows.length;
  }

  console.log(
    JSON.stringify(
      {
        processed,
        updated,
        failed,
        totalEvents
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error("Diputados derived-data backfill failed", error);
  process.exitCode = 1;
});

function getNumberArg(flag: string): number | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((value) => value === flag);

  if (index === -1) {
    return undefined;
  }

  const rawValue = args[index + 1];
  const value = rawValue ? Number(rawValue) : NaN;

  return Number.isFinite(value) ? value : undefined;
}
