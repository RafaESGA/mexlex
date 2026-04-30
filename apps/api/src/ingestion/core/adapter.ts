import type {
  AdapterCheckpoint,
  CanonicalCandidate,
  DiscoveredRecord,
  ParsedSourceRecord,
  RawFetchedArtifact,
  SourceSystem
} from "@mexlex/shared/types/ingestion";

export type SourceAdapter = {
  source: SourceSystem;
  discover(checkpoint: AdapterCheckpoint): Promise<DiscoveredRecord[]>;
  fetch(record: DiscoveredRecord): Promise<RawFetchedArtifact[]>;
  parse(raw: RawFetchedArtifact): Promise<ParsedSourceRecord[]>;
  map(parsed: ParsedSourceRecord): Promise<CanonicalCandidate[]>;
};

