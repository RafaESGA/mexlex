import type { ParsedSourceRecord, RawFetchedArtifact } from "@mexlex/shared/types/ingestion";
import { sha256 } from "./hashing.js";

export function parseRawArtifact(raw: RawFetchedArtifact): ParsedSourceRecord {
  return {
    source: raw.source,
    recordType: "raw_artifact",
    recordKey: raw.recordKey,
    contentHash: sha256(raw.body),
    sourceUrl: raw.sourceUrl,
    rawPayload: { body: raw.body, mimeType: raw.mimeType },
    parsedPayload: {}
  };
}

