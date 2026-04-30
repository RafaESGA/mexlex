import { silLogger } from "./logger.js";
import { discoverSilPages } from "./fetchers/discover.js";
import { fetchSilInitiativePage } from "./fetchers/fetch-initiative.js";
import { parseSilInitiative } from "./parsers/parse-initiative.js";
import { parseSilDetailPage } from "./parsers/parse-detail.js";
import { parseSilResultsPage } from "./parsers/parse-results.js";
import { mergeSilInitiativeWithDetail } from "./merge.js";
import { mapSilParsedInitiative } from "./mappers/map-to-canonical.js";
import { persistSilInitiative } from "./persist.js";
import type { SilIngestionOptions, SilIngestionResult } from "./types.js";

export async function runSilIngestion(options: SilIngestionOptions = {}): Promise<SilIngestionResult> {
  const pages = await discoverSilPages(options);
  silLogger.info("Discovered SIL results pages", { count: pages.length, urls: pages.map((page) => page.url) });

  let parsedInitiatives = 0;
  let insertedInitiatives = 0;
  const seenInitiatives = new Set<string>();

  for (const page of pages) {
    try {
      silLogger.info("Fetching SIL initiative page", { url: page.url });
      const htmlPage = await fetchSilInitiativePage(page);
      const parsedBatch = isResultsPage(htmlPage.url)
        ? parseSilResultsPage(htmlPage)
        : [parseSilInitiative(htmlPage)].filter(Boolean);

      silLogger.info("Parsed initiatives from SIL page", {
        url: page.url,
        parsedCount: parsedBatch.length
      });

      if (parsedBatch.length === 0) {
        silLogger.info("Skipping page without initiative payload", { url: page.url });
        continue;
      }

      for (const parsed of parsedBatch) {
        const initiativeKey = buildInitiativeRunKey(parsed);
        if (seenInitiatives.has(initiativeKey)) {
          silLogger.info("Skipping duplicate initiative within current SIL run", {
            url: page.url,
            initiativeKey
          });
          continue;
        }

        seenInitiatives.add(initiativeKey);
        parsedInitiatives += 1;

        const detailUrl = getMetadataString(parsed.metadata, "detail_url");
        let enriched = parsed;

        if (detailUrl) {
          try {
            silLogger.info("Fetching SIL initiative detail page", { url: detailUrl });
            const detailPage = await fetchSilInitiativePage({
              url: detailUrl,
              depth: page.depth + 1,
              parentUrl: page.url
            });
            const detailParsed = parseSilDetailPage(detailPage);
            if (!detailParsed) {
              silLogger.info("SIL detail page fetched but no structured detail was extracted", {
                url: detailUrl
              });
            }
            enriched = mergeSilInitiativeWithDetail(parsed, detailParsed);
          } catch (error) {
            silLogger.error("Failed to fetch or parse SIL detail page", {
              url: detailUrl,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        const mapped = mapSilParsedInitiative(enriched);
        const persisted = await persistSilInitiative(mapped);

        if (persisted.inserted) {
          insertedInitiatives += 1;
        }

        silLogger.info("Processed SIL initiative", {
          url: page.url,
          initiativeId: persisted.initiativeId,
          inserted: persisted.inserted
        });
      }
    } catch (error) {
      silLogger.error("Failed to process SIL initiative page", {
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

function isResultsPage(url: string): boolean {
  return /resultadosNumeraliaIniciativas\.php/i.test(url);
}

function getMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function buildInitiativeRunKey(parsed: { dedupeHash: string; metadata: Record<string, unknown> }): string {
  const detailUrl = getMetadataString(parsed.metadata, "detail_url");
  return detailUrl ?? parsed.dedupeHash;
}
