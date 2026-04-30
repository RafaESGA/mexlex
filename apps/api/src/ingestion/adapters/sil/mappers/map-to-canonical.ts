import type { SilMappedInitiative, SilParsedInitiative } from "../types.js";

export function mapSilParsedInitiative(parsed: SilParsedInitiative): SilMappedInitiative {
  return {
    canonicalTitle: parsed.title,
    titleNormalized: parsed.titleNormalized,
    summary: parsed.description,
    presentedAt: parsed.presentationDate,
    rawStatus: parsed.statusRaw,
    chamber: parsed.chamber,
    initiativeType: parsed.initiativeType,
    sourceUrl: parsed.sourceUrl,
    dedupeHash: parsed.dedupeHash,
    authors: parsed.authors,
    rawHtml: parsed.rawHtml,
    metadata: parsed.metadata,
    sourceRecordKey: parsed.sourceRecordKey
  };
}

