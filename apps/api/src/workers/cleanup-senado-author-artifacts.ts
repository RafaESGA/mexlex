import { supabaseAdmin } from "../db/supabase.js";
import { normalizeText } from "../ingestion/core/normalization.js";

type InitiativeRow = {
  id: string;
  canonical_title: string;
  metadata: Record<string, unknown> | null;
};

type InitiativeAuthorRow = {
  initiative_id: string;
  author_id: string;
  role: string;
  sort_order: number | null;
  authors:
    | {
        id: string;
        full_name: string;
        name_normalized: string;
        chamber: "diputados" | "senado" | "congreso_union" | "ejecutivo" | "otro" | null;
      }
    | null;
};

type AuthorRow = {
  id: string;
  full_name: string;
  name_normalized: string;
  chamber: "diputados" | "senado" | "congreso_union" | "ejecutivo" | "otro" | null;
};

type Counters = {
  initiativesScanned: number;
  initiativeRelationsScanned: number;
  rewrittenRelations: number;
  deletedRelations: number;
  createdAuthors: number;
  removedOrphanAuthors: number;
};

async function main() {
  const parser = getStringArg("--parser") ?? "senado-gaceta-document-local-v2";
  const apply = process.argv.includes("--apply");
  const batchSize = getNumberArg("--batch-size") ?? 100;

  const counters: Counters = {
    initiativesScanned: 0,
    initiativeRelationsScanned: 0,
    rewrittenRelations: 0,
    deletedRelations: 0,
    createdAuthors: 0,
    removedOrphanAuthors: 0
  };

  const authorCache = new Map<string, AuthorRow>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("initiatives")
      .select("id, canonical_title, metadata")
      .contains("metadata", { parser })
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw new Error(`Failed to fetch Senado initiatives for cleanup: ${error.message}`);
    }

    const initiatives = (data ?? []) as InitiativeRow[];
    if (initiatives.length === 0) {
      break;
    }

    for (const initiative of initiatives) {
      counters.initiativesScanned += 1;
      await cleanupInitiativeAuthors(initiative, apply, authorCache, counters);
    }

    offset += initiatives.length;
  }

  if (apply) {
    counters.removedOrphanAuthors = await deleteOrphanArtifactAuthors();
  }

  console.log(
    JSON.stringify(
      {
        parser,
        apply,
        ...counters
      },
      null,
      2
    )
  );
}

async function cleanupInitiativeAuthors(
  initiative: InitiativeRow,
  apply: boolean,
  authorCache: Map<string, AuthorRow>,
  counters: Counters
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("initiative_authors")
    .select("initiative_id, author_id, role, sort_order, authors(id, full_name, name_normalized, chamber)")
    .eq("initiative_id", initiative.id)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch initiative authors for ${initiative.id}: ${error.message}`);
  }

  const rows = (data ?? []) as InitiativeAuthorRow[];
  counters.initiativeRelationsScanned += rows.length;

  for (const row of rows) {
    const author = row.authors;
    if (!author || !isArtifactAuthor(author.full_name)) {
      continue;
    }

    const canonicalFullName = normalizeArtifactAuthorName(author.full_name);
    if (!canonicalFullName || isArtifactAuthor(canonicalFullName)) {
      counters.deletedRelations += 1;

      if (apply) {
        await deleteInitiativeAuthorRelation(row.initiative_id, row.author_id, row.role);
      }

      continue;
    }

    const canonicalAuthor = await findOrCreateCanonicalAuthor(canonicalFullName, author.chamber, apply, authorCache);
    if (canonicalAuthor && canonicalAuthor.id !== row.author_id) {
      counters.rewrittenRelations += 1;

      if (apply) {
        await upsertInitiativeAuthorRelation({
          initiativeId: row.initiative_id,
          authorId: canonicalAuthor.id,
          role: row.role,
          sortOrder: row.sort_order
        });
        await deleteInitiativeAuthorRelation(row.initiative_id, row.author_id, row.role);
      }

      if (apply && canonicalAuthor.id && !authorCache.has(authorCacheKey(canonicalFullName, author.chamber))) {
        authorCache.set(authorCacheKey(canonicalFullName, author.chamber), canonicalAuthor);
      }

      if (!apply) {
        counters.createdAuthors += canonicalAuthor.id.startsWith("dry-run:new-author:") ? 1 : 0;
      }

      continue;
    }

    if (canonicalAuthor && canonicalAuthor.id === row.author_id && canonicalFullName !== author.full_name) {
      counters.rewrittenRelations += 1;
    }
  }
}

async function findOrCreateCanonicalAuthor(
  fullName: string,
  chamber: AuthorRow["chamber"],
  apply: boolean,
  authorCache: Map<string, AuthorRow>
): Promise<AuthorRow | null> {
  const key = authorCacheKey(fullName, chamber);
  const cached = authorCache.get(key);
  if (cached) {
    return cached;
  }

  const nameNormalized = normalizeText(fullName);
  const query = supabaseAdmin
    .from("authors")
    .select("id, full_name, name_normalized, chamber")
    .eq("name_normalized", nameNormalized)
    .limit(20);

  const { data, error } = chamber
    ? await query.eq("chamber", chamber)
    : await query.is("chamber", null);

  if (error) {
    throw new Error(`Failed to find canonical author "${fullName}": ${error.message}`);
  }

  const exact = ((data ?? []) as AuthorRow[]).find(
    (author) => normalizeText(author.full_name) === nameNormalized && author.chamber === chamber
  );

  if (exact) {
    authorCache.set(key, exact);
    return exact;
  }

  if (!apply) {
    const dryRunAuthor: AuthorRow = {
      id: `dry-run:new-author:${key}`,
      full_name: fullName,
      name_normalized: nameNormalized,
      chamber
    };
    authorCache.set(key, dryRunAuthor);
    return dryRunAuthor;
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("authors")
    .insert({
      full_name: fullName,
      name_normalized: nameNormalized,
      person_type: "legislator",
      chamber,
      profile_data: {}
    })
    .select("id, full_name, name_normalized, chamber")
    .single();

  if (insertError || !inserted) {
    throw new Error(`Failed to create canonical author "${fullName}": ${insertError?.message ?? "unknown error"}`);
  }

  const author = inserted as AuthorRow;
  authorCache.set(key, author);
  return author;
}

async function upsertInitiativeAuthorRelation(input: {
  initiativeId: string;
  authorId: string;
  role: string;
  sortOrder: number | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("initiative_authors").upsert(
    {
      initiative_id: input.initiativeId,
      author_id: input.authorId,
      role: input.role,
      sort_order: input.sortOrder,
      source_record_id: null
    },
    {
      onConflict: "initiative_id,author_id,role"
    }
  );

  if (error) {
    throw new Error(`Failed to upsert initiative author relation: ${error.message}`);
  }
}

async function deleteInitiativeAuthorRelation(
  initiativeId: string,
  authorId: string,
  role: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("initiative_authors")
    .delete()
    .eq("initiative_id", initiativeId)
    .eq("author_id", authorId)
    .eq("role", role);

  if (error) {
    throw new Error(`Failed to delete initiative author relation: ${error.message}`);
  }
}

async function deleteOrphanArtifactAuthors(): Promise<number> {
  let offset = 0;
  let removed = 0;
  const batchSize = 500;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("authors")
      .select("id, full_name")
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw new Error(`Failed to fetch authors for orphan cleanup: ${error.message}`);
    }

    const authors = (data ?? []) as Array<{ id: string; full_name: string }>;
    if (authors.length === 0) {
      break;
    }

    for (const author of authors) {
      if (!isArtifactAuthor(author.full_name)) {
        continue;
      }

      const { count, error: countError } = await supabaseAdmin
        .from("initiative_authors")
        .select("*", { count: "exact", head: true })
        .eq("author_id", author.id);

      if (countError) {
        throw new Error(`Failed to count relations for author ${author.id}: ${countError.message}`);
      }

      if ((count ?? 0) > 0) {
        continue;
      }

      const { error: deleteError } = await supabaseAdmin.from("authors").delete().eq("id", author.id);
      if (deleteError) {
        throw new Error(`Failed to delete orphan author ${author.id}: ${deleteError.message}`);
      }

      removed += 1;
    }

    offset += authors.length;
  }

  return removed;
}

function authorCacheKey(fullName: string, chamber: AuthorRow["chamber"]): string {
  return `${normalizeText(fullName)}|${chamber ?? "null"}`;
}

function normalizeArtifactAuthorName(value: string): string {
  return value
    .replace(/^\s*sen\.\s*/i, "")
    .replace(/^\s*senador(?:a)?\s+/i, "")
    .replace(/^\s*(las\s+)?senadoras\s+y\s+de\s+los\s+senadores\s+/i, "")
    .replace(/^\s*(las\s+)?senadoras\s+y\s+los\s+senadores\s+/i, "")
    .replace(/^\s*(las\s+)?senadoras\s+y\s+senadores\s+/i, "")
    .replace(/^\s*senadoras\s+/, "")
    .replace(/^\s*senadores\s+/, "")
    .replace(/\s*,?\s*(del|el)\s+Grupo Parlamentario.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isArtifactAuthor(value: string): boolean {
  return (
    /^\s*grupo parlamentario\b/i.test(value) ||
    /\bgrupo parlamentario\b/i.test(value) ||
    /^\s*senadoras?\s*$/i.test(value) ||
    /^\s*senadores?\s+/i.test(value) ||
    /^\s*(las\s+)?senadoras\s+y\s+(de\s+los\s+)?senadores\b/i.test(value)
  );
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
  console.error("Senado author cleanup failed", error);
  process.exitCode = 1;
});
