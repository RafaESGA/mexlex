import type {
  AdapterCheckpoint,
  CanonicalCandidate,
  DiscoveredRecord,
  ParsedSourceRecord,
  RawFetchedArtifact
} from "@mexlex/shared/types/ingestion";
import type { SourceAdapter } from "../../core/adapter.js";
import { parseRawArtifact } from "../../core/parser.js";
import { discoverDiputadosGacetaPages } from "./fetchers/discover.js";
import { fetchDiputadosGacetaInitiativePage } from "./fetchers/fetch-initiative.js";
import { parseDiputadosGacetaInitiative } from "./parsers/parse-initiative.js";
import { mapDiputadosParsedInitiative } from "./mappers/map-to-canonical.js";

export { runDiputadosGacetaIngestion } from "./service.js";

export const diputadosGacetaAdapter: SourceAdapter = {
  source: "gaceta_diputados",
  async discover(_checkpoint: AdapterCheckpoint): Promise<DiscoveredRecord[]> {
    const pages = await discoverDiputadosGacetaPages();
    return pages.map((page) => ({
      source: "gaceta_diputados",
      recordKey: page.url,
      sourceUrl: page.url,
      discoveredAt: new Date().toISOString()
    }));
  },
  async fetch(record: DiscoveredRecord): Promise<RawFetchedArtifact[]> {
    const page = await fetchDiputadosGacetaInitiativePage({
      url: record.sourceUrl,
      depth: 0
    });

    return [
      {
        source: "gaceta_diputados",
        recordKey: record.recordKey,
        sourceUrl: record.sourceUrl,
        mimeType: page.contentType,
        body: page.html,
        fetchedAt: page.fetchedAt
      }
    ];
  },
  async parse(raw: RawFetchedArtifact): Promise<ParsedSourceRecord[]> {
    const parsed = parseDiputadosGacetaInitiative({
      url: raw.sourceUrl,
      html: raw.body,
      fetchedAt: raw.fetchedAt,
      contentType: raw.mimeType
    });

    if (!parsed) {
      return [parseRawArtifact(raw)];
    }

    return [
      {
        source: "gaceta_diputados",
        recordType: "initiative_html",
        recordKey: parsed.sourceRecordKey,
        contentHash: parsed.dedupeHash,
        sourceUrl: parsed.sourceUrl,
        rawPayload: {
          html: parsed.rawHtml
        },
        parsedPayload: mapDiputadosParsedInitiative(parsed)
      }
    ];
  },
  async map(parsed: ParsedSourceRecord): Promise<CanonicalCandidate[]> {
    if (parsed.recordType !== "initiative_html") {
      return [];
    }

    return [
      {
        source: "gaceta_diputados",
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

