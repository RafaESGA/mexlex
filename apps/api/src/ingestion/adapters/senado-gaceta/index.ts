import type {
  AdapterCheckpoint,
  CanonicalCandidate,
  DiscoveredRecord,
  ParsedSourceRecord,
  RawFetchedArtifact
} from "@mexlex/shared/types/ingestion";
import type { SourceAdapter } from "../../core/adapter.js";
import { parseRawArtifact } from "../../core/parser.js";
import { discoverSenadoGacetaPages } from "./fetchers/discover.js";
import { fetchSenadoGacetaPage } from "./fetchers/fetch-initiative.js";
import { parseSenadoGacetaDocumentPage } from "./parsers/parse-initiative.js";
import { mapSenadoParsedInitiative } from "./mappers/map-to-canonical.js";

export { runSenadoGacetaIngestion } from "./service.js";

export const senadoGacetaAdapter: SourceAdapter = {
  source: "gaceta_senado",
  async discover(_checkpoint: AdapterCheckpoint): Promise<DiscoveredRecord[]> {
    const pages = await discoverSenadoGacetaPages();
    return pages.map((page) => ({
      source: "gaceta_senado",
      recordKey: page.url,
      sourceUrl: page.url,
      discoveredAt: new Date().toISOString()
    }));
  },
  async fetch(record: DiscoveredRecord): Promise<RawFetchedArtifact[]> {
    const page = await fetchSenadoGacetaPage({
      url: record.sourceUrl,
      depth: 0,
      kind: "document"
    });

    return [
      {
        source: "gaceta_senado",
        recordKey: record.recordKey,
        sourceUrl: record.sourceUrl,
        mimeType: page.contentType,
        body: page.html,
        fetchedAt: page.fetchedAt
      }
    ];
  },
  async parse(raw: RawFetchedArtifact): Promise<ParsedSourceRecord[]> {
    const parsed = parseSenadoGacetaDocumentPage({
      url: raw.sourceUrl,
      html: raw.body,
      fetchedAt: raw.fetchedAt,
      contentType: raw.mimeType,
      kind: "document"
    });

    if (!parsed) {
      return [parseRawArtifact(raw)];
    }

    return [
      {
        source: "gaceta_senado",
        recordType: "initiative_html",
        recordKey: parsed.sourceRecordKey,
        contentHash: parsed.dedupeHash,
        sourceUrl: parsed.sourceUrl,
        rawPayload: {
          html: parsed.rawHtml
        },
        parsedPayload: mapSenadoParsedInitiative(parsed)
      }
    ];
  },
  async map(parsed: ParsedSourceRecord): Promise<CanonicalCandidate[]> {
    if (parsed.recordType !== "initiative_html") {
      return [];
    }

    return [
      {
        source: "gaceta_senado",
        entityType: "initiative",
        sourceRecordKey: parsed.recordKey,
        payload: parsed.parsedPayload,
        signals: {
          titleSimilarity: 1,
          aliasSimilarity: 0,
          authorOverlap: 0,
          dateProximity: 1,
          chamberConsistency: 1,
          affectedNormOverlap: 0
        }
      }
    ];
  }
};
