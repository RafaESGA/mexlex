import type {
  SearchByAuthorResponse,
  SearchInitiativesResponse
} from "@mexlex/shared/domain/search";
import { supabaseAdmin } from "../../db/supabase.js";
import { searchByAuthorRpc, searchInitiativesRpc } from "../../db/queries/search.queries.js";
import { normalizeText } from "../../ingestion/core/normalization.js";
import { mapInitiativeSearchRow, mapSearchByAuthorRow } from "./search.mapper.js";
import type { SearchInitiativesRpcRow } from "../../db/queries/rpc.types.js";

const HYBRID_FILTER_SCAN_LIMIT = 1000;

export const searchService = {
  async searchInitiatives(input: {
    query?: string;
    status?: string;
    chamber?: string;
    dateFrom?: string;
    dateTo?: string;
    author?: string;
    commission?: string;
    limit: number;
    offset: number;
  }): Promise<SearchInitiativesResponse> {
    if (input.query && !hasStructuredFilters(input)) {
      const embeddedAuthor = await findEmbeddedAuthorFilter(input.query);
      if (embeddedAuthor) {
        const rows = embeddedAuthor.query
          ? await searchInitiativesWithFilters({
              ...input,
              query: embeddedAuthor.query,
              author: embeddedAuthor.author
            })
          : await listInitiatives({
              ...input,
              query: undefined,
              author: embeddedAuthor.author
            });

        return {
          query: input.query,
          limit: input.limit,
          offset: input.offset,
          results: rows.map(mapInitiativeSearchRow)
        };
      }

      const rows = await searchInitiativesRpc({
        query: input.query,
        limit: input.limit,
        offset: input.offset
      });

      return {
        query: input.query,
        limit: input.limit,
        offset: input.offset,
        results: rows.map(mapInitiativeSearchRow)
      };
    }

    if (input.query && hasStructuredFilters(input)) {
      const rows = await searchInitiativesWithFilters(input);

      return {
        query: input.query,
        limit: input.limit,
        offset: input.offset,
        results: rows.map(mapInitiativeSearchRow)
      };
    }

    const rows = await listInitiatives(input);

    return {
      query: input.query ?? "",
      limit: input.limit,
      offset: input.offset,
      results: rows.map(mapInitiativeSearchRow)
    };
  },

  async searchByAuthor(input: {
    query: string;
    limit: number;
    offset: number;
  }): Promise<SearchByAuthorResponse> {
    const rows = await searchByAuthorRpc(input);

    return {
      query: input.query,
      limit: input.limit,
      offset: input.offset,
      results: rows.map(mapSearchByAuthorRow)
    };
  },

  async searchByTopic(input: {
    query: string;
    limit: number;
    offset: number;
  }): Promise<SearchInitiativesResponse> {
    const rows = await searchInitiativesRpc(input);

    return {
      query: input.query,
      limit: input.limit,
      offset: input.offset,
      results: rows.map(mapInitiativeSearchRow)
    };
  }
};

async function searchInitiativesWithFilters(input: {
  query: string;
  status?: string;
  chamber?: string;
  dateFrom?: string;
  dateTo?: string;
  author?: string;
  commission?: string;
  limit: number;
  offset: number;
}): Promise<SearchInitiativesRpcRow[]> {
  const rows = await searchInitiativesRpc({
    query: input.query,
    limit: HYBRID_FILTER_SCAN_LIMIT,
    offset: 0
  });

  if (rows.length === 0) {
    return [];
  }

  const constrainedIds = await getConstrainedInitiativeIds(input);
  if (constrainedIds && constrainedIds.length === 0) {
    return [];
  }

  const metadataByInitiativeId = await getInitiativeFilterMetadata(rows.map((row) => row.initiative_id));
  const constrainedIdSet = constrainedIds ? new Set(constrainedIds) : null;

  return rows
    .filter((row) => {
      const metadata = metadataByInitiativeId.get(row.initiative_id);
      if (!metadata) {
        return false;
      }

      if (constrainedIdSet && !constrainedIdSet.has(row.initiative_id)) {
        return false;
      }

      if (input.status && metadata.normalizedStatus !== input.status) {
        return false;
      }

      if (input.chamber && metadata.originatingChamber !== input.chamber) {
        return false;
      }

      if (input.dateFrom && (!metadata.presentedAt || metadata.presentedAt < input.dateFrom)) {
        return false;
      }

      if (input.dateTo && (!metadata.presentedAt || metadata.presentedAt > input.dateTo)) {
        return false;
      }

      return true;
    })
    .slice(input.offset, input.offset + input.limit);
}

function hasStructuredFilters(input: {
  status?: string;
  chamber?: string;
  dateFrom?: string;
  dateTo?: string;
  author?: string;
  commission?: string;
}): boolean {
  return Boolean(input.status || input.chamber || input.dateFrom || input.dateTo || input.author || input.commission);
}

async function findEmbeddedAuthorFilter(query: string): Promise<{ author: string; query: string } | null> {
  const tokens = normalizeText(query)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length < 2) {
    return null;
  }

  for (let size = Math.min(4, tokens.length); size >= 2; size -= 1) {
    for (let start = 0; start <= tokens.length - size; start += 1) {
      const authorCandidate = tokens.slice(start, start + size).join(" ");
      const authorIds = await findIdsByName("authors", "full_name", "name_normalized", authorCandidate, 5);

      if (authorIds.length > 0) {
        return {
          author: authorCandidate,
          query: tokens
            .filter((_, index) => index < start || index >= start + size)
            .join(" ")
        };
      }
    }
  }

  return null;
}

async function listInitiatives(input: {
  query?: string;
  status?: string;
  chamber?: string;
  dateFrom?: string;
  dateTo?: string;
  author?: string;
  commission?: string;
  limit: number;
  offset: number;
}): Promise<SearchInitiativesRpcRow[]> {
  const constrainedIds = await getConstrainedInitiativeIds(input);
  if (constrainedIds && constrainedIds.length === 0) {
    return [];
  }

  if (constrainedIds) {
    return listConstrainedInitiatives(input, constrainedIds);
  }

  let query = supabaseAdmin
    .from("initiatives")
    .select("id, canonical_title, summary, normalized_status, raw_status, presented_at, matter_topic")
    .order("presented_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(input.offset, input.offset + input.limit - 1);

  if (input.query) {
    query = query.ilike("canonical_title", `%${input.query}%`);
  }

  if (input.status) {
    query = query.eq("normalized_status", input.status);
  }

  if (input.chamber) {
    query = query.eq("originating_chamber", input.chamber);
  }

  if (input.dateFrom) {
    query = query.gte("presented_at", input.dateFrom);
  }

  if (input.dateTo) {
    query = query.lte("presented_at", input.dateTo);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list initiatives: ${error.message}`);
  }

  return ((data ?? []) as Array<{
    id: string;
    canonical_title: string;
    summary: string | null;
    normalized_status: string;
    raw_status: string | null;
    presented_at: string | null;
    matter_topic: string | null;
  }>).map((row) => ({
    initiative_id: row.id,
    canonical_title: row.canonical_title,
    summary: row.summary,
    normalized_status: row.normalized_status,
    raw_status: row.raw_status,
    presented_at: row.presented_at,
    matter_topic: row.matter_topic,
    rank_score: null,
    trigram_score: null,
    final_score: null
  }));
}

async function listConstrainedInitiatives(
  input: {
    query?: string;
    status?: string;
    chamber?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
    offset: number;
  },
  initiativeIds: string[]
): Promise<SearchInitiativesRpcRow[]> {
  const rows: SearchInitiativesRpcRow[] = [];

  for (let index = 0; index < initiativeIds.length; index += 100) {
    let query = supabaseAdmin
      .from("initiatives")
      .select("id, canonical_title, summary, normalized_status, raw_status, presented_at, matter_topic")
      .in("id", initiativeIds.slice(index, index + 100));

    if (input.query) {
      query = query.ilike("canonical_title", `%${input.query}%`);
    }

    if (input.status) {
      query = query.eq("normalized_status", input.status);
    }

    if (input.chamber) {
      query = query.eq("originating_chamber", input.chamber);
    }

    if (input.dateFrom) {
      query = query.gte("presented_at", input.dateFrom);
    }

    if (input.dateTo) {
      query = query.lte("presented_at", input.dateTo);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list constrained initiatives: ${error.message}`);
    }

    rows.push(
      ...((data ?? []) as Array<{
        id: string;
        canonical_title: string;
        summary: string | null;
        normalized_status: string;
        raw_status: string | null;
        presented_at: string | null;
        matter_topic: string | null;
      }>).map((row) => ({
        initiative_id: row.id,
        canonical_title: row.canonical_title,
        summary: row.summary,
        normalized_status: row.normalized_status,
        raw_status: row.raw_status,
        presented_at: row.presented_at,
        matter_topic: row.matter_topic,
        rank_score: null,
        trigram_score: null,
        final_score: null
      }))
    );
  }

  return rows
    .sort((left, right) => {
      const dateComparison = (right.presented_at ?? "").localeCompare(left.presented_at ?? "");
      if (dateComparison !== 0) {
        return dateComparison;
      }

      return left.canonical_title.localeCompare(right.canonical_title, "es");
    })
    .slice(input.offset, input.offset + input.limit);
}

async function getConstrainedInitiativeIds(input: {
  author?: string;
  commission?: string;
}): Promise<string[] | null> {
  const sets: Array<Set<string>> = [];

  if (input.author) {
    sets.push(new Set(await findInitiativeIdsByAuthor(input.author)));
  }

  if (input.commission) {
    sets.push(new Set(await findInitiativeIdsByCommission(input.commission)));
  }

  if (sets.length === 0) {
    return null;
  }

  const [first, ...rest] = sets;
  return [...(first ?? new Set<string>())].filter((id) => rest.every((set) => set.has(id)));
}

async function findInitiativeIdsByAuthor(author: string): Promise<string[]> {
  const authorIds = await findIdsByName("authors", "full_name", "name_normalized", normalizeAuthorQuery(author));
  if (authorIds.length === 0) {
    return [];
  }

  return findInitiativeIds("initiative_authors", "author_id", authorIds);
}

function normalizeAuthorQuery(author: string): string {
  const normalized = normalizeText(author);

  if (
    normalized === "poder ejecutivo" ||
    normalized === "poder ejecutivo federal" ||
    normalized === "titular del poder ejecutivo" ||
    normalized === "titular del poder ejecutivo federal"
  ) {
    return "Ejecutivo Federal";
  }

  return author;
}

async function findInitiativeIdsByCommission(commission: string): Promise<string[]> {
  const commissionIds = await findIdsByName("commissions", "name", "name_normalized", commission);
  if (commissionIds.length === 0) {
    return [];
  }

  return findInitiativeIds("initiative_commissions", "commission_id", commissionIds);
}

async function findIdsByName(
  table: "authors" | "commissions",
  displayColumn: string,
  normalizedColumn: string,
  value: string,
  limit = 200
): Promise<string[]> {
  const normalized = normalizeText(value);
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id")
    .or(`${displayColumn}.ilike.%${value}%,${normalizedColumn}.ilike.%${normalized}%`)
    .limit(limit);

  if (error) {
    throw new Error(`Failed to search ${table}: ${error.message}`);
  }

  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function findInitiativeIds(
  table: "initiative_authors" | "initiative_commissions",
  column: "author_id" | "commission_id",
  ids: string[]
): Promise<string[]> {
  const results = new Set<string>();

  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("initiative_id")
      .in(column, ids.slice(index, index + 100));

    if (error) {
      throw new Error(`Failed to fetch ${table}: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{ initiative_id: string }>) {
      results.add(row.initiative_id);
    }
  }

  return [...results];
}

async function getInitiativeFilterMetadata(initiativeIds: string[]): Promise<
  Map<
    string,
    {
      normalizedStatus: string;
      originatingChamber: string | null;
      presentedAt: string | null;
    }
  >
> {
  const metadata = new Map<
    string,
    {
      normalizedStatus: string;
      originatingChamber: string | null;
      presentedAt: string | null;
    }
  >();

  for (let index = 0; index < initiativeIds.length; index += 100) {
    const { data, error } = await supabaseAdmin
      .from("initiatives")
      .select("id, normalized_status, originating_chamber, presented_at")
      .in("id", initiativeIds.slice(index, index + 100));

    if (error) {
      throw new Error(`Failed to fetch initiative filter metadata: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{
      id: string;
      normalized_status: string;
      originating_chamber: string | null;
      presented_at: string | null;
    }>) {
      metadata.set(row.id, {
        normalizedStatus: row.normalized_status,
        originatingChamber: row.originating_chamber,
        presentedAt: row.presented_at
      });
    }
  }

  return metadata;
}
