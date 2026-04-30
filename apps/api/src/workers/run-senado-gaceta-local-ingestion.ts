import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseSenadoGacetaDocumentInitiatives } from "../ingestion/adapters/senado-gaceta/parsers/parse-initiative.js";
import { mapSenadoParsedInitiative } from "../ingestion/adapters/senado-gaceta/mappers/map-to-canonical.js";
import { persistSenadoGacetaInitiative } from "../ingestion/adapters/senado-gaceta/persist.js";
import { senadoGacetaLogger } from "../ingestion/adapters/senado-gaceta/logger.js";
import type { SenadoHtmlPage } from "../ingestion/adapters/senado-gaceta/types.js";

async function main() {
  const htmlFiles = getStringArgs("--html-file");
  const sourceUrls = getStringArgs("--source-url");

  if (htmlFiles.length === 0) {
    throw new Error("At least one --html-file argument is required");
  }

  let parsedInitiatives = 0;
  let insertedInitiatives = 0;
  const processedFiles: string[] = [];

  for (const [index, htmlFile] of htmlFiles.entries()) {
    const absolutePath = resolve(htmlFile);
    const sourceUrl = sourceUrls[index] ?? inferSourceUrlFromPath(absolutePath);

    try {
      senadoGacetaLogger.info("Reading local Senado HTML file", {
        path: absolutePath,
        sourceUrl
      });

      const rawHtml = await readFile(absolutePath, "utf8");
      const page: SenadoHtmlPage = {
        url: sourceUrl,
        html: rawHtml,
        fetchedAt: new Date().toISOString(),
        contentType: "text/html",
        kind: "document",
        sessionDate: null
      };

      const parsedBatch = parseSenadoGacetaDocumentInitiatives(page);
      if (parsedBatch.length === 0) {
        senadoGacetaLogger.info("Skipping local Senado HTML without parseable initiative payload", {
          path: absolutePath,
          sourceUrl
        });
        continue;
      }

      for (const parsed of parsedBatch) {
        parsed.metadata = {
          ...parsed.metadata,
          parser: "senado-gaceta-document-local-v2",
          local_file_path: absolutePath
        };

        parsedInitiatives += 1;
        const mapped = mapSenadoParsedInitiative(parsed);
        const persisted = await persistSenadoGacetaInitiative(mapped);

        if (persisted.inserted) {
          insertedInitiatives += 1;
        }

        senadoGacetaLogger.info("Processed local Senado initiative", {
          path: absolutePath,
          sourceUrl,
          initiativeId: persisted.initiativeId,
          inserted: persisted.inserted,
          canonicalTitle: mapped.canonicalTitle
        });
      }

      processedFiles.push(absolutePath);
    } catch (error) {
      senadoGacetaLogger.error("Failed to process local Senado HTML file", {
        path: absolutePath,
        sourceUrl,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        processedFiles: processedFiles.length,
        parsedInitiatives,
        insertedInitiatives
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error("Senado Gaceta local ingestion failed", error);
  process.exitCode = 1;
});

function getStringArgs(flag: string): string[] {
  const args = process.argv.slice(2);
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];
      if (value) {
        values.push(value);
      }
    }
  }

  return values;
}

function inferSourceUrlFromPath(filePath: string): string {
  const name = basename(filePath);
  const documentIdMatch = name.match(/(\d{5,})/);

  if (documentIdMatch) {
    return `https://www.senado.gob.mx/66/gaceta_del_senado/documento/${documentIdMatch[1]}`;
  }

  return `local://senado-gaceta/${encodeURIComponent(name)}`;
}
