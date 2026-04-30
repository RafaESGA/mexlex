import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { supabaseAdmin } from "../db/supabase.js";
import {
  buildAuthorVariantSuggestions,
  type AuthorVariantInput
} from "../modules/reconciliation/author-variants.js";

async function main() {
  const outFile = getStringArg("--out-file") ?? "author-variant-report.json";

  const [authors, counts] = await Promise.all([fetchAuthors(), fetchInitiativeAuthorCounts()]);
  const suggestionInputs: AuthorVariantInput[] = authors.map((author) => ({
    ...author,
    initiativeCount: counts.get(author.id) ?? 0
  }));

  const suggestions = buildAuthorVariantSuggestions(suggestionInputs);
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      authors: authors.length,
      variantClusters: suggestions.length
    },
    suggestions
  };

  await writeFile(resolve(outFile), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

async function fetchAuthors(): Promise<
  Array<{
    id: string;
    fullName: string;
    nameNormalized: string;
    chamber: string | null;
  }>
> {
  const rows = await fetchPaginated<{
    id: string;
    full_name: string;
    name_normalized: string;
    chamber: string | null;
  }>("authors", "id, full_name, name_normalized, chamber");

  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    nameNormalized: row.name_normalized,
    chamber: row.chamber
  }));
}

async function fetchInitiativeAuthorCounts(): Promise<Map<string, number>> {
  const rows = await fetchPaginated<{
    author_id: string;
  }>("initiative_authors", "author_id");

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.author_id, (counts.get(row.author_id) ?? 0) + 1);
  }

  return counts;
}

async function fetchPaginated<T>(table: string, select: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin.from(table).select(select).range(from, to);

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

function getStringArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((value) => value === flag);
  return index === -1 ? undefined : args[index + 1];
}

void main().catch((error) => {
  console.error("Author variant report failed", error);
  process.exitCode = 1;
});
