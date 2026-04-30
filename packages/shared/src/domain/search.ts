import type { InitiativeStatus } from "../taxonomy/legislative";

export type InitiativeSearchResult = {
  id: string;
  canonicalTitle: string;
  normalizedStatus: InitiativeStatus;
  score: number;
  presentedAt?: string | null;
  summary?: string | null;
  matterTopic?: string | null;
  matchedOn: string[];
  snippet?: string;
  aliases: string[];
};

export type SearchInitiativesResponse = {
  query: string;
  limit: number;
  offset: number;
  results: InitiativeSearchResult[];
};

export type SearchByAuthorResult = InitiativeSearchResult & {
  authorName: string;
  authorParty?: string | null;
  authorState?: string | null;
};

export type SearchByAuthorResponse = {
  query: string;
  limit: number;
  offset: number;
  results: SearchByAuthorResult[];
};
