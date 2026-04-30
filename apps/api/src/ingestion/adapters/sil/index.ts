import type {
  AdapterCheckpoint,
  CanonicalCandidate,
  DiscoveredRecord,
  ParsedSourceRecord,
  RawFetchedArtifact
} from "@mexlex/shared/types/ingestion";
import type { SourceAdapter } from "../../core/adapter.js";
import { parseRawArtifact } from "../../core/parser.js";
import { discoverSilPages } from "./fetchers/discover.js";
import { fetchSilInitiativePage } from "./fetchers/fetch-initiative.js";
import { parseSilInitiative } from "./parsers/parse-initiative.js";
import { mapSilParsedInitiative } from "./mappers/map-to-canonical.js";
export { runSilIngestion } from "./service.js";

export const silAdapter: SourceAdapter = {
  source: "sil",
  async discover(_checkpoint: AdapterCheckpoint): Promise<DiscoveredRecord[]> {
    const pages = await discoverSilPages();
    return pages.map((page) => ({
      source: "sil",
      recordKey: page.url,
      sourceUrl: page.url,
      discoveredAt: new Date().toISOString()
    }));
  },
  async fetch(record: DiscoveredRecord): Promise<RawFetchedArtifact[]> {
    const page = await fetchSilInitiativePage({
      url: record.sourceUrl,
      depth: 0
    });

    return [
      {
        source: "sil",
        recordKey: record.recordKey,
        sourceUrl: record.sourceUrl,
        mimeType: page.contentType,
        body: page.html,
        fetchedAt: page.fetchedAt
      }
    ];
  },
  async parse(raw: RawFetchedArtifact): Promise<ParsedSourceRecord[]> {
    const heuristicParsed = parseSilInitiative({
      url: raw.sourceUrl,
      html: raw.body,
      fetchedAt: raw.fetchedAt,
      contentType: raw.mimeType
    });

    if (!heuristicParsed) {
      return [parseRawArtifact(raw)];
    }

    return [
      {
        source: "sil",
        recordType: "initiative_html",
        recordKey: heuristicParsed.sourceRecordKey,
        contentHash: heuristicParsed.dedupeHash,
        sourceUrl: heuristicParsed.sourceUrl,
        rawPayload: {
          html: heuristicParsed.rawHtml
        },
        parsedPayload: mapSilParsedInitiative(heuristicParsed)
      }
    ];
  },
  async map(parsed: ParsedSourceRecord): Promise<CanonicalCandidate[]> {
    if (parsed.recordType !== "initiative_html") {
      return [];
    }

    return [
      {
        source: "sil",
        entityType: "initiative",
        sourceRecordKey: parsed.recordKey,
        payload: parsed.parsedPayload,
        signals: {
          titleSimilarity: 1,
          aliasSimilarity: 0,
          authorOverlap: 0,
          dateProximity: 1,
          chamberConsistency: 0.5,
          affectedNormOverlap: 0
        }
      }
    ];
  }
};

