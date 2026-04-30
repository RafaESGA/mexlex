import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { supabaseAdmin } from "../db/supabase.js";
import type { AuthorVariantSuggestion } from "../modules/reconciliation/author-variants.js";
import { buildSafeAuthorMergePlans } from "../modules/reconciliation/author-merge.js";

type VariantReport = {
  generatedAt: string;
  totals: {
    authors: number;
    variantClusters: number;
  };
  suggestions: AuthorVariantSuggestion[];
};

type InitiativeAuthorRelation = {
  initiative_id: string;
  author_id: string;
  role: string;
  sort_order: number | null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const minConfidence = getNumberArg("--min-confidence") ?? 0.9;
  const reportFile = getStringArg("--report-file") ?? "author-variant-report.json";

  const report = await loadReport(reportFile);
  const plans = buildSafeAuthorMergePlans(report.suggestions, { minConfidence });

  const counters = {
    apply,
    reportFile,
    minConfidence,
    candidateClusters: report.suggestions.length,
    safeClusters: plans.length,
    mergedClusters: 0,
    scannedRelations: 0,
    upsertedRelations: 0,
    deletedRelations: 0,
    removedOrphanAuthors: 0,
    skippedAliasesWithoutRelations: 0,
    sample: [] as Array<{
      canonicalFullName: string;
      confidence: number;
      aliasNames: string[];
      relationsMoved: number;
    }>
  };

  for (const plan of plans) {
    const moved = await applyMergePlan(plan, apply, counters);
    counters.mergedClusters += 1;
    if (counters.sample.length < 10) {
      counters.sample.push({
        canonicalFullName: plan.canonicalFullName,
        confidence: plan.confidence,
        aliasNames: plan.aliasNames,
        relationsMoved: moved
      });
    }
  }

  if (apply) {
    counters.removedOrphanAuthors = await deleteOrphanAuthorsFromPlans(plans);
  }

  console.log(JSON.stringify(counters, null, 2));
}

async function applyMergePlan(
  plan: ReturnType<typeof buildSafeAuthorMergePlans>[number],
  apply: boolean,
  counters: {
    scannedRelations: number;
    upsertedRelations: number;
    deletedRelations: number;
    skippedAliasesWithoutRelations: number;
  }
): Promise<number> {
  let moved = 0;

  for (const aliasAuthorId of plan.aliasAuthorIds) {
    const relations = await fetchRelationsForAuthor(aliasAuthorId);
    counters.scannedRelations += relations.length;

    if (relations.length === 0) {
      counters.skippedAliasesWithoutRelations += 1;
      continue;
    }

    for (const relation of relations) {
      moved += 1;
      counters.upsertedRelations += 1;
      counters.deletedRelations += 1;

      if (!apply) {
        continue;
      }

      await upsertInitiativeAuthorRelation({
        initiativeId: relation.initiative_id,
        authorId: plan.canonicalAuthorId,
        role: relation.role,
        sortOrder: relation.sort_order
      });
      await deleteInitiativeAuthorRelation(relation.initiative_id, relation.author_id, relation.role);
    }
  }

  return moved;
}

async function fetchRelationsForAuthor(authorId: string): Promise<InitiativeAuthorRelation[]> {
  const { data, error } = await supabaseAdmin
    .from("initiative_authors")
    .select("initiative_id, author_id, role, sort_order")
    .eq("author_id", authorId);

  if (error) {
    throw new Error(`Failed to fetch initiative_authors for ${authorId}: ${error.message}`);
  }

  return (data ?? []) as InitiativeAuthorRelation[];
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
      sort_order: input.sortOrder
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

async function deleteOrphanAuthorsFromPlans(plans: ReturnType<typeof buildSafeAuthorMergePlans>): Promise<number> {
  let removed = 0;

  for (const plan of plans) {
    for (const aliasAuthorId of plan.aliasAuthorIds) {
      const { count, error: countError } = await supabaseAdmin
        .from("initiative_authors")
        .select("*", { count: "exact", head: true })
        .eq("author_id", aliasAuthorId);

      if (countError) {
        throw new Error(`Failed to count remaining relations for ${aliasAuthorId}: ${countError.message}`);
      }

      if ((count ?? 0) > 0) {
        continue;
      }

      const { error } = await supabaseAdmin.from("authors").delete().eq("id", aliasAuthorId);
      if (error) {
        throw new Error(`Failed to delete orphan author ${aliasAuthorId}: ${error.message}`);
      }

      removed += 1;
    }
  }

  return removed;
}

async function loadReport(reportFile: string): Promise<VariantReport> {
  const raw = await readFile(resolve(reportFile), "utf8");
  return JSON.parse(raw) as VariantReport;
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
  console.error("Author variant merge failed", error);
  process.exitCode = 1;
});
