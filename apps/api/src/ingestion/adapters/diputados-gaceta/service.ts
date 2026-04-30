import { diputadosGacetaLogger } from "./logger.js";
import { discoverDiputadosGacetaPages } from "./fetchers/discover.js";
import { fetchDiputadosGacetaInitiativePage } from "./fetchers/fetch-initiative.js";
import { parseDiputadosGacetaInitiative } from "./parsers/parse-initiative.js";
import { parseDiputadosGacetaListPage } from "./parsers/parse-list.js";
import { mapDiputadosParsedInitiative } from "./mappers/map-to-canonical.js";
import { persistDiputadosGacetaInitiative } from "./persist.js";
import type { DiputadosIngestionOptions, DiputadosIngestionResult } from "./types.js";

export async function runDiputadosGacetaIngestion(
  options: DiputadosIngestionOptions = {}
): Promise<DiputadosIngestionResult> {
  const pages = await discoverDiputadosGacetaPages(options);
  diputadosGacetaLogger.info("Discovered Diputados Gaceta initiative pages", {
    count: pages.length,
    urls: pages.map((page) => page.url)
  });

  let parsedInitiatives = 0;
  let insertedInitiatives = 0;
  const seen = new Set<string>();

  for (const page of pages) {
    try {
      diputadosGacetaLogger.info("Fetching Diputados Gaceta initiative page", { url: page.url });
      const htmlPage = await fetchDiputadosGacetaInitiativePage(page);
      const parsedBatch = isListPage(htmlPage.url)
        ? parseDiputadosGacetaListPage(htmlPage)
        : [parseDiputadosGacetaInitiative(htmlPage)].filter(Boolean);

      diputadosGacetaLogger.info("Parsed initiatives from Diputados Gaceta page", {
        url: page.url,
        parsedCount: parsedBatch.length
      });

      if (parsedBatch.length === 0) {
        diputadosGacetaLogger.info("Skipping page without parseable initiative payload", { url: page.url });
        continue;
      }

      for (const parsed of parsedBatch) {
        if (seen.has(parsed.dedupeHash)) {
          diputadosGacetaLogger.info("Skipping duplicate Diputados initiative within current run", {
            url: page.url,
            dedupeHash: parsed.dedupeHash
          });
          continue;
        }

        seen.add(parsed.dedupeHash);
        parsedInitiatives += 1;

        const mapped = mapDiputadosParsedInitiative(parsed);
        const persisted = await persistDiputadosGacetaInitiative(mapped);

        if (persisted.inserted) {
          insertedInitiatives += 1;
        }

        diputadosGacetaLogger.info("Processed Diputados initiative", {
          url: page.url,
          initiativeId: persisted.initiativeId,
          inserted: persisted.inserted
        });
      }
    } catch (error) {
      diputadosGacetaLogger.error("Failed to process Diputados initiative page", {
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

function isListPage(url: string): boolean {
  return /Gaceta\/Iniciativas\/\d+\/gp\d+_/i.test(url);
}
