import { supabaseAdmin } from "../db/supabase.js";
import {
  normalizeRankedSourceLink,
  pickPrimarySourceLink,
  rebalanceInitiativePrimarySourceLinks
} from "../modules/reconciliation/source-links.js";

async function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const initiativeIds = getStringArgs("--initiative-id");
  const groupedLinks = await fetchGroupedRankedSourceLinks();
  const targets = initiativeIds.length > 0 ? initiativeIds : [...groupedLinks.keys()];
  let changed = 0;
  let unchanged = 0;
  const sample: Array<{
    initiativeId: string;
    selectedSourceSystem: string | null;
    linkCount: number;
  }> = [];

  for (const initiativeId of targets) {
    const links = groupedLinks.get(initiativeId) ?? [];
    const selected = pickPrimarySourceLink(links);
    const shouldChange = links.some((link) => link.isPrimary !== (selected ? link.linkId === selected.linkId : false));

    if (sample.length < 10 && selected) {
      sample.push({
        initiativeId,
        selectedSourceSystem: selected.sourceSystem,
        linkCount: links.length
      });
    }

    if (!shouldChange) {
      unchanged += 1;
      continue;
    }

    if (!dryRun) {
      await rebalanceInitiativePrimarySourceLinks(initiativeId);
    }

    changed += 1;
  }

  console.log(
    JSON.stringify(
      {
        scanned: targets.length,
        changed,
        unchanged,
        dryRun,
        sample
      },
      null,
      2
    )
  );
}

async function fetchInitiativeIdsWithSourceLinks(): Promise<string[]> {
  return [...(await fetchGroupedRankedSourceLinks()).keys()];
}

async function fetchGroupedRankedSourceLinks() {
  const grouped = new Map<string, ReturnType<typeof normalizeRankedSourceLink>[]>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin
      .from("initiative_source_links")
      .select("id, initiative_id, source_record_id, confidence, is_primary, source_records(source_id, sources(system, priority))")
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch initiative_source_links: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const row of data) {
      if (!row.initiative_id) {
        continue;
      }

      const links = grouped.get(row.initiative_id) ?? [];
      links.push(normalizeRankedSourceLink(row));
      grouped.set(row.initiative_id, links);
    }

    if (data.length < pageSize) {
      break;
    }
  }

  return grouped;
}

function getStringArgs(flag: string): string[] {
  const args = process.argv.slice(2);
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];
      if (value) {
        values.push(value);
      }
    }
  }

  return values;
}

void main().catch((error) => {
  console.error("Primary source link fix failed", error);
  process.exitCode = 1;
});
