import type {
  InitiativeSearchResult,
  SearchByAuthorResult
} from "@mexlex/shared/domain/search";
import type { InitiativeStatus } from "@mexlex/shared/taxonomy/legislative";
import type { SearchByAuthorRpcRow, SearchInitiativesRpcRow } from "../../db/queries/rpc.types.js";

export function mapInitiativeSearchRow(row: SearchInitiativesRpcRow): InitiativeSearchResult {
  return {
    id: row.initiative_id,
    canonicalTitle: row.canonical_title,
    normalizedStatus: row.normalized_status as InitiativeStatus,
    score: Number(row.final_score ?? row.rank_score ?? 0),
    presentedAt: row.presented_at,
    summary: row.summary,
    matterTopic: row.matter_topic,
    matchedOn: inferMatchedOn(row),
    snippet: row.summary ?? row.matter_topic ?? undefined,
    aliases: []
  };
}

export function mapSearchByAuthorRow(row: SearchByAuthorRpcRow): SearchByAuthorResult {
  return {
    id: row.initiative_id,
    canonicalTitle: row.canonical_title,
    normalizedStatus: row.normalized_status as InitiativeStatus,
    score: Number(row.match_score ?? 0),
    presentedAt: row.presented_at,
    matchedOn: ["author"],
    aliases: [],
    authorName: row.author_name,
    authorParty: row.author_party,
    authorState: row.author_state
  };
}

function inferMatchedOn(row: SearchInitiativesRpcRow): string[] {
  const matchedOn: string[] = [];

  if ((row.rank_score ?? 0) > 0) {
    matchedOn.push("keyword");
  }

  if ((row.trigram_score ?? 0) > 0.2) {
    matchedOn.push("fuzzy");
  }

  if (matchedOn.length === 0) {
    matchedOn.push("ranked");
  }

  return matchedOn;
}

