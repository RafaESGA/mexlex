import { supabaseAdmin } from "../db/supabase.js";
import { normalizeText } from "../ingestion/core/normalization.js";
import { extractAuthorsFromSenadoTransparenciaProponentes } from "../ingestion/adapters/senado-transparencia/index.js";

type InitiativeRow = {
  id: string;
  canonical_title: string;
  current_chamber: "diputados" | "senado" | "congreso_union" | "ejecutivo" | "otro" | null;
  metadata: Record<string, unknown> | null;
};

type Counters = {
  scanned: number;
  updated: number;
  unchanged: number;
  createdAuthors: number;
};

async function main() {
  const parser = getStringArg("--parser") ?? "senado-transparencia-json-v1";
  const apply = process.argv.includes("--apply");
  const batchSize = getNumberArg("--batch-size") ?? 100;
  const maxItems = getNumberArg("--max-items");

  const counters: Counters = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    createdAuthors: 0
  };

  const authorCache = new Map<string, string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("initiatives")
      .select("id, canonical_title, current_chamber, metadata")
      .contains("metadata", { parser })
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw new Error(`Failed to fetch Senado Transparencia initiatives: ${error.message}`);
    }

    const rows = (data ?? []) as InitiativeRow[];
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      if (maxItems && counters.scanned >= maxItems) {
        console.log(JSON.stringify(counters, null, 2));
        return;
      }

      counters.scanned += 1;
      const changed = await repairInitiativeAuthors(row, apply, authorCache, counters);

      if (changed) {
        counters.updated += 1;
      } else {
        counters.unchanged += 1;
      }
    }

    offset += rows.length;
  }

  console.log(JSON.stringify(counters, null, 2));
}

async function repairInitiativeAuthors(
  initiative: InitiativeRow,
  apply: boolean,
  authorCache: Map<string, string>,
  counters: Counters
): Promise<boolean> {
  const cargoProponente = getMetadataString(initiative.metadata, "cargo_proponente");
  if (!cargoProponente) {
    return false;
  }

  const desiredAuthors = extractAuthorsFromSenadoTransparenciaProponentes(cargoProponente);
  if (desiredAuthors.length === 0) {
    return false;
  }

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("initiative_authors")
    .select("role, sort_order, authors(full_name)")
    .eq("initiative_id", initiative.id)
    .order("sort_order", { ascending: true });

  if (existingError) {
    throw new Error(`Failed to fetch existing authors for ${initiative.id}: ${existingError.message}`);
  }

  const existingAuthorNames = (existingRows ?? [])
    .map((row) => row.authors?.full_name)
    .filter((value): value is string => Boolean(value));

  const existingKey = existingAuthorNames.map((name) => normalizeText(name)).join("|");
  const desiredKey = desiredAuthors.map((author) => normalizeText(author.fullName)).join("|");

  if (existingKey === desiredKey) {
    return false;
  }

  if (!apply) {
    return true;
  }

  const authorIds: Array<{ authorId: string; role: string; sortOrder: number }> = [];
  for (const [index, author] of desiredAuthors.entries()) {
    const authorId = await findOrCreateAuthor(author.fullName, initiative.current_chamber, authorCache);
    authorIds.push({
      authorId,
      role: author.role,
      sortOrder: index + 1
    });
  }

  const { error: deleteError } = await supabaseAdmin.from("initiative_authors").delete().eq("initiative_id", initiative.id);
  if (deleteError) {
    throw new Error(`Failed to delete existing initiative authors for ${initiative.id}: ${deleteError.message}`);
  }

  const { error: insertError } = await supabaseAdmin.from("initiative_authors").insert(
    authorIds.map((author) => ({
      initiative_id: initiative.id,
      author_id: author.authorId,
      role: author.role,
      sort_order: author.sortOrder
    }))
  );

  if (insertError) {
    throw new Error(`Failed to insert repaired initiative authors for ${initiative.id}: ${insertError.message}`);
  }

  return true;
}

async function findOrCreateAuthor(
  fullName: string,
  chamber: InitiativeRow["current_chamber"],
  authorCache: Map<string, string>
): Promise<string> {
  const key = `${normalizeText(fullName)}|${chamber ?? "null"}`;
  const cached = authorCache.get(key);
  if (cached) {
    return cached;
  }

  const nameNormalized = normalizeText(fullName);
  let query = supabaseAdmin.from("authors").select("id").eq("name_normalized", nameNormalized).limit(1);
  query = chamber ? query.eq("chamber", chamber) : query.is("chamber", null);
  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Failed to query author ${fullName}: ${error.message}`);
  }

  if (data?.id) {
    authorCache.set(key, data.id);
    return data.id;
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("authors")
    .insert({
      full_name: fullName,
      name_normalized: nameNormalized,
      chamber,
      person_type: "legislator",
      profile_data: {}
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(`Failed to insert author ${fullName}: ${insertError?.message ?? "unknown error"}`);
  }

  authorCache.set(key, inserted.id);
  return inserted.id;
}

function getMetadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function getStringArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((value) => value === flag);
  return index === -1 ? undefined : args[index + 1];
}

function getNumberArg(flag: string): number | undefined {
  const rawValue = getStringArg(flag);
  const value = rawValue ? Number(rawValue) : NaN;
  return Number.isFinite(value) ? value : undefined;
}

void main().catch((error) => {
  console.error("Senado Transparencia author repair failed", error);
  process.exitCode = 1;
});
