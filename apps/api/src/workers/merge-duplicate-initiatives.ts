import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { supabaseAdmin } from "../db/supabase.js";
import { rebalanceInitiativePrimarySourceLinks } from "../modules/reconciliation/source-links.js";

type DuplicateReport = {
  plans: Array<{
    matchKey: string;
    canonicalInitiativeId: string;
    canonicalTitle: string;
    confidence: number;
    duplicateInitiativeIds: string[];
  }>;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const minConfidence = getNumberArg("--min-confidence") ?? 0.9;
  const reportFile = getStringArg("--report-file") ?? "duplicate-initiative-report.json";
  const report = await loadReport(reportFile);
  const plans = report.plans.filter((plan) => plan.confidence >= minConfidence);

  const counters = {
    apply,
    reportFile,
    minConfidence,
    candidatePlans: report.plans.length,
    safePlans: plans.length,
    mergedPlans: 0,
    movedSourceLinks: 0,
    movedAuthors: 0,
    movedCommissions: 0,
    movedEvents: 0,
    deletedInitiatives: 0,
    sample: [] as Array<{
      canonicalInitiativeId: string;
      duplicates: string[];
    }>
  };

  for (const plan of plans) {
    for (const duplicateId of plan.duplicateInitiativeIds) {
      counters.movedSourceLinks += await moveSourceLinks(duplicateId, plan.canonicalInitiativeId, apply);
      counters.movedAuthors += await moveAuthors(duplicateId, plan.canonicalInitiativeId, apply);
      counters.movedCommissions += await moveCommissions(duplicateId, plan.canonicalInitiativeId, apply);
      counters.movedEvents += await moveEvents(duplicateId, plan.canonicalInitiativeId, apply);

      if (apply) {
        await rebalanceInitiativePrimarySourceLinks(plan.canonicalInitiativeId);
        await deleteInitiative(duplicateId);
      }

      counters.deletedInitiatives += 1;
    }

    counters.mergedPlans += 1;
    if (counters.sample.length < 10) {
      counters.sample.push({
        canonicalInitiativeId: plan.canonicalInitiativeId,
        duplicates: plan.duplicateInitiativeIds
      });
    }
  }

  console.log(JSON.stringify(counters, null, 2));
}

async function moveSourceLinks(fromInitiativeId: string, toInitiativeId: string, apply: boolean): Promise<number> {
  const rows = await fetchRows<{ source_record_id: string; source_title: string | null; source_status: string | null; confidence: number; is_primary: boolean }>(
    "initiative_source_links",
    "source_record_id, source_title, source_status, confidence, is_primary",
    fromInitiativeId
  );

  if (apply) {
    for (const row of rows) {
      const { error } = await supabaseAdmin.from("initiative_source_links").upsert(
        {
          initiative_id: toInitiativeId,
          source_record_id: row.source_record_id,
          source_title: row.source_title,
          source_status: row.source_status,
          confidence: row.confidence,
          is_primary: false
        },
        { onConflict: "initiative_id,source_record_id" }
      );

      if (error) {
        throw new Error(`Failed to move source link ${row.source_record_id}: ${error.message}`);
      }
    }

    await deleteRows("initiative_source_links", fromInitiativeId);
  }

  return rows.length;
}

async function moveAuthors(fromInitiativeId: string, toInitiativeId: string, apply: boolean): Promise<number> {
  const rows = await fetchRows<{ author_id: string; role: string; sort_order: number | null }>(
    "initiative_authors",
    "author_id, role, sort_order",
    fromInitiativeId
  );

  if (apply) {
    for (const row of rows) {
      const { error } = await supabaseAdmin.from("initiative_authors").upsert(
        {
          initiative_id: toInitiativeId,
          author_id: row.author_id,
          role: row.role,
          sort_order: row.sort_order
        },
        { onConflict: "initiative_id,author_id,role" }
      );

      if (error) {
        throw new Error(`Failed to move author ${row.author_id}: ${error.message}`);
      }
    }

    await deleteRows("initiative_authors", fromInitiativeId);
  }

  return rows.length;
}

async function moveCommissions(fromInitiativeId: string, toInitiativeId: string, apply: boolean): Promise<number> {
  const rows = await fetchRows<{ commission_id: string; relation_type: string; assigned_at: string | null }>(
    "initiative_commissions",
    "commission_id, relation_type, assigned_at",
    fromInitiativeId
  );

  if (apply) {
    for (const row of rows) {
      const { error } = await supabaseAdmin.from("initiative_commissions").upsert(
        {
          initiative_id: toInitiativeId,
          commission_id: row.commission_id,
          relation_type: row.relation_type,
          assigned_at: row.assigned_at
        },
        { onConflict: "initiative_id,commission_id,relation_type,assigned_at" }
      );

      if (error) {
        throw new Error(`Failed to move commission ${row.commission_id}: ${error.message}`);
      }
    }

    await deleteRows("initiative_commissions", fromInitiativeId);
  }

  return rows.length;
}

async function moveEvents(fromInitiativeId: string, toInitiativeId: string, apply: boolean): Promise<number> {
  const rows = await fetchRows<{ id: string }>("legislative_events", "id", fromInitiativeId);

  if (apply) {
    for (const row of rows) {
      const { error } = await supabaseAdmin
        .from("legislative_events")
        .update({ initiative_id: toInitiativeId })
        .eq("id", row.id);

      if (error) {
        throw new Error(`Failed to move event ${row.id}: ${error.message}`);
      }
    }
  }

  return rows.length;
}

async function fetchRows<T>(table: string, select: string, initiativeId: string): Promise<T[]> {
  const { data, error } = await supabaseAdmin.from(table).select(select).eq("initiative_id", initiativeId);

  if (error) {
    throw new Error(`Failed to fetch ${table} for ${initiativeId}: ${error.message}`);
  }

  return (data ?? []) as T[];
}

async function deleteRows(table: string, initiativeId: string): Promise<void> {
  const { error } = await supabaseAdmin.from(table).delete().eq("initiative_id", initiativeId);

  if (error) {
    throw new Error(`Failed to delete ${table} rows for ${initiativeId}: ${error.message}`);
  }
}

async function deleteInitiative(initiativeId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("initiatives").delete().eq("id", initiativeId);

  if (error) {
    throw new Error(`Failed to delete initiative ${initiativeId}: ${error.message}`);
  }
}

async function loadReport(reportFile: string): Promise<DuplicateReport> {
  const raw = await readFile(resolve(reportFile), "utf8");
  return JSON.parse(raw) as DuplicateReport;
}

function getStringArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((value) => value === flag);
  return index === -1 ? undefined : args[index + 1];
}

function getNumberArg(flag: string): number | undefined {
  const raw = getStringArg(flag);
  if (!raw) {
    return undefined;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

void main().catch((error) => {
  console.error("Duplicate initiative merge failed", error);
  process.exitCode = 1;
});
