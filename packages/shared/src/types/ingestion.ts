import type { SourceSystem } from "../taxonomy/legislative";

export type AdapterCheckpoint = {
  source: string;
  cursor: string | null;
  lastSuccessfulRunAt: string | null;
};

export type DiscoveredRecord = {
  source: SourceSystem;
  recordKey: string;
  sourceUrl: string;
  discoveredAt?: string;
};

export type RawFetchedArtifact = {
  source: SourceSystem;
  recordKey: string;
  sourceUrl: string;
  mimeType: string;
  body: string;
  fetchedAt: string;
};

export type ParsedSourceRecord = {
  source: SourceSystem;
  recordType: string;
  recordKey: string;
  contentHash: string;
  sourceUrl: string;
  rawPayload: Record<string, unknown>;
  parsedPayload: Record<string, unknown>;
};

export type CanonicalCandidate = {
  source: SourceSystem;
  entityType: "initiative" | "event" | "document" | "author" | "alias" | "affected_norm";
  sourceRecordKey: string;
  payload: Record<string, unknown>;
  signals: {
    titleSimilarity: number;
    aliasSimilarity: number;
    authorOverlap: number;
    dateProximity: number;
    chamberConsistency: number;
    affectedNormOverlap: number;
  };
};

export type InitiativeMatchDecision = {
  decision: "attach" | "review" | "create";
  confidence: number;
};

export type SourceAdapterContract = {
  source: Exclude<SourceSystem, "manual">;
};

