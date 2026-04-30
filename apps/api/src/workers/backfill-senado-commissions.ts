import { supabaseAdmin } from "../db/supabase.js";
import { normalizeText } from "../ingestion/core/normalization.js";
import { extractSenateCommissionNames } from "../modules/reconciliation/senate-commissions.js";

type InitiativeRow = {
  id: string;
  canonical_title: string;
  presented_at: string | null;
  metadata: Record<string, unknown> | null;
};

async function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const parserFilters = getStringArgs("--parser");
  const pageSize = 500;

  const initiatives = await fetchTargetInitiatives(pageSize, parserFilters);
  const existingRelations = await fetchExistingCommissionRelationKeys();
  const commissionCache = await loadExistingSenateCommissionCache();
  let changed = 0;
  let unchanged = 0;
  let insertedRelations = 0;
  let createdCommissions = 0;
  const sample: Array<{ title: string; commissions: string[] }> = [];

  for (const initiative of initiatives) {
    const rawCommissionText = readRawCommissionText(initiative.metadata ?? {});
    const commissionNames = extractSenateCommissionNames(rawCommissionText);

    if (commissionNames.length === 0) {
      unchanged += 1;
      continue;
    }

    const assignedAt = initiative.presented_at ?? new Date().toISOString().slice(0, 10);
    let insertedForInitiative = 0;

    for (const commissionName of commissionNames) {
      const commissionId = await getOrCreateCommission(commissionName, commissionCache, dryRun);
      if (commissionId.startsWith("dry-run:new-commission:")) {
        createdCommissions += 1;
      }

      const inserted = await upsertInitiativeCommissionRelation(
        initiative.id,
        commissionId,
        assignedAt,
        dryRun,
        existingRelations
      );
      if (inserted) {
        insertedForInitiative += 1;
      }
    }

    if (insertedForInitiative > 0) {
      changed += 1;
    } else {
      unchanged += 1;
    }

    insertedRelations += insertedForInitiative;

    if (sample.length < 10) {
      sample.push({
        title: initiative.canonical_title,
        commissions: commissionNames
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        scanned: initiatives.length,
        changed,
        unchanged,
        insertedRelations,
        createdCommissions,
        dryRun,
        sample
      },
      null,
      2
    )
  );
}

async function fetchTargetInitiatives(pageSize: number, parserFilters: string[]): Promise<InitiativeRow[]> {
  const initiatives: InitiativeRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let query = supabaseAdmin
      .from("initiatives")
      .select("id, canonical_title, presented_at, metadata")
      .eq("originating_chamber", "senado")
      .range(from, to);

    if (parserFilters.length > 0) {
      query = query.in("metadata->>parser", parserFilters);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch Senado initiatives for commission backfill: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    initiatives.push(
      ...(data as InitiativeRow[]).filter((row) => {
        const raw = readRawCommissionText(row.metadata ?? {});
        return raw.length > 0;
      })
    );

    if (data.length < pageSize) {
      break;
    }
  }

  return initiatives;
}

function readRawCommissionText(metadata: Record<string, unknown>): string {
  const values = [metadata.comisiones_raw, metadata.comision_turno]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  return values.join(" | ");
}

async function countExistingRelations(initiativeId: string): Promise<number> {
  return 0;
}

async function getOrCreateCommission(
  name: string,
  cache: Map<string, string>,
  dryRun: boolean
): Promise<string> {
  const cacheKey = `senado:${normalizeText(name)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const nameNormalized = normalizeText(name);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("commissions")
    .select("id")
    .eq("name_normalized", nameNormalized)
    .eq("chamber", "senado")
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to query Senado commissions: ${existingError.message}`);
  }

  if (existing?.id) {
    cache.set(cacheKey, existing.id);
    return existing.id;
  }

  if (dryRun) {
    const dryId = `dry-run:new-commission:${cacheKey}`;
    cache.set(cacheKey, dryId);
    return dryId;
  }

  const { data, error } = await supabaseAdmin
    .from("commissions")
    .insert({
      name,
      name_normalized: nameNormalized,
      chamber: "senado",
      metadata: {
        source: "senado_commission_backfill"
      }
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert Senado commission: ${error?.message ?? "unknown error"}`);
  }

  cache.set(cacheKey, data.id);
  return data.id;
}

async function upsertInitiativeCommissionRelation(
  initiativeId: string,
  commissionId: string,
  assignedAt: string,
  dryRun: boolean,
  existingRelations: Set<string>
): Promise<boolean> {
  const relationKey = `${initiativeId}|${commissionId}|referred|${assignedAt}`;

  if (dryRun) {
    if (commissionId.startsWith("dry-run:new-commission:")) {
      return true;
    }

    return !existingRelations.has(relationKey);
  }

  const { error } = await supabaseAdmin.from("initiative_commissions").upsert(
    {
      initiative_id: initiativeId,
      commission_id: commissionId,
      relation_type: "referred",
      assigned_at: assignedAt
    },
    {
      onConflict: "initiative_id,commission_id,relation_type,assigned_at"
    }
  );

  if (error) {
    throw new Error(`Failed to upsert Senado initiative commission relation: ${error.message}`);
  }

  existingRelations.add(relationKey);
  return true;
}

async function fetchExistingCommissionRelationKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin
      .from("initiative_commissions")
      .select("initiative_id, commission_id, relation_type, assigned_at")
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch initiative commissions: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const row of data) {
      keys.add(`${row.initiative_id}|${row.commission_id}|${row.relation_type}|${row.assigned_at}`);
    }

    if (data.length < pageSize) {
      break;
    }
  }

  return keys;
}

async function loadExistingSenateCommissionCache(): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin
      .from("commissions")
      .select("id, name_normalized, chamber")
      .eq("chamber", "senado")
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch Senado commissions: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const row of data) {
      cache.set(`senado:${row.name_normalized}`, row.id);
    }

    if (data.length < pageSize) {
      break;
    }
  }

  return cache;
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
  console.error("Senado commissions backfill failed", error);
  process.exitCode = 1;
});
