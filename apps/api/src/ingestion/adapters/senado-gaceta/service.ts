import { senadoGacetaLogger } from "./logger.js";
import { discoverSenadoGacetaPages } from "./fetchers/discover.js";
import { fetchSenadoGacetaPage } from "./fetchers/fetch-initiative.js";
import { parseSenadoGacetaSessionPage } from "./parsers/parse-list.js";
import { parseSenadoGacetaDocumentInitiatives } from "./parsers/parse-initiative.js";
import { mapSenadoParsedInitiative } from "./mappers/map-to-canonical.js";
import { persistSenadoGacetaInitiative } from "./persist.js";
import type { SenadoDiscoveredPage, SenadoIngestionOptions, SenadoIngestionResult } from "./types.js";

export async function runSenadoGacetaIngestion(
  options: SenadoIngestionOptions = {}
): Promise<SenadoIngestionResult> {
  const pages = await discoverSenadoGacetaPages(options);
  senadoGacetaLogger.info("Discovered Senado Gaceta pages", {
    count: pages.length,
    urls: pages.map((page) => page.url)
  });

  let parsedInitiatives = 0;
  let insertedInitiatives = 0;
  const seen = new Set<string>();
  const queuedDocumentUrls = new Set<string>();
  const documentQueue: SenadoDiscoveredPage[] = [];

  for (const page of pages) {
    if (page.kind === "document") {
      documentQueue.push(page);
      queuedDocumentUrls.add(page.url);
      continue;
    }

    try {
      senadoGacetaLogger.info("Fetching Senado Gaceta session page", { url: page.url });
      const htmlPage = await fetchSenadoGacetaPage(page);
      const documents = parseSenadoGacetaSessionPage(htmlPage);
      senadoGacetaLogger.info("Parsed initiatives from Senado session page", {
        url: page.url,
        discoveredDocuments: documents.length
      });

      for (const document of documents) {
        if (queuedDocumentUrls.has(document.url)) {
          continue;
        }

        queuedDocumentUrls.add(document.url);
        documentQueue.push({
          url: document.url,
          depth: page.depth + 1,
          kind: "document",
          parentUrl: page.url,
          sessionDate: document.sessionDate
        });
      }
    } catch (error) {
      senadoGacetaLogger.error("Failed to process Senado session page", {
        url: page.url,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const page of documentQueue) {
    try {
      senadoGacetaLogger.info("Fetching Senado Gaceta document page", { url: page.url });
      const htmlPage = await fetchSenadoGacetaPage(page);
      const parsedBatch = parseSenadoGacetaDocumentInitiatives(htmlPage);

      if (parsedBatch.length === 0) {
        senadoGacetaLogger.info("Skipping Senado page without parseable initiative payload", { url: page.url });
        continue;
      }

      for (const parsed of parsedBatch) {
        if (seen.has(parsed.dedupeHash)) {
          senadoGacetaLogger.info("Skipping duplicate Senado initiative within current run", {
            url: page.url,
            dedupeHash: parsed.dedupeHash
          });
          continue;
        }

        seen.add(parsed.dedupeHash);
        parsedInitiatives += 1;

        const mapped = mapSenadoParsedInitiative(parsed);
        const persisted = await persistSenadoGacetaInitiative(mapped);

        if (persisted.inserted) {
          insertedInitiatives += 1;
        }

        senadoGacetaLogger.info("Processed Senado initiative", {
          url: page.url,
          initiativeId: persisted.initiativeId,
          inserted: persisted.inserted,
          canonicalTitle: mapped.canonicalTitle
        });
      }
    } catch (error) {
      senadoGacetaLogger.error("Failed to process Senado document page", {
        url: page.url,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    discoveredPages: pages.length,
    parsedInitiatives,
    insertedInitiatives
  };
}
