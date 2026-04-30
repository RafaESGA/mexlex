import { resolve } from "node:path";
import { persistSenadoTransparenciaInitiative } from "../ingestion/adapters/senado-transparencia/persist.js";
import {
  extractRowsFromSenadoDatosAbiertosDocx,
  extractRowsFromSenadoDatosAbiertosJson,
  mapSenadoDatosAbiertosRow
} from "../ingestion/adapters/senado-datos-abiertos-local/index.js";

async function main() {
  const docxFiles = getStringArgs("--docx-file");
  const jsonFiles = getStringArgs("--json-file");
  const maxItems = getNumberArg("--max-items");
  const dryRun = hasFlag("--dry-run");

  if (docxFiles.length === 0 && jsonFiles.length === 0) {
    throw new Error("At least one --docx-file or --json-file argument is required");
  }

  const sourceFiles = [
    ...docxFiles.map((filePath) => ({ path: resolve(filePath), kind: "docx" as const })),
    ...jsonFiles.map((filePath) => ({ path: resolve(filePath), kind: "json" as const }))
  ];

  let processedFiles = 0;
  let parsedInitiatives = 0;
  let insertedInitiatives = 0;
  let updatedInitiatives = 0;
  const sampleTitles: string[] = [];

  for (const sourceFile of sourceFiles) {
    const rows =
      sourceFile.kind === "docx"
        ? await extractRowsFromSenadoDatosAbiertosDocx(sourceFile.path)
        : await extractRowsFromSenadoDatosAbiertosJson(sourceFile.path);

    processedFiles += 1;

    for (const [index, row] of rows.entries()) {
      if (maxItems && parsedInitiatives >= maxItems) {
        console.log(
          JSON.stringify(
            {
              processedFiles,
              parsedInitiatives,
              insertedInitiatives,
              updatedInitiatives,
              dryRun,
              sampleTitles
            },
            null,
            2
          )
        );
        return;
      }

      const mapped = mapSenadoDatosAbiertosRow(row, {
        sourceFilePath: sourceFile.path,
        rowIndex: index
      });

      parsedInitiatives += 1;
      if (sampleTitles.length < 10) {
        sampleTitles.push(mapped.canonicalTitle);
      }

      if (!dryRun) {
        const persisted = await persistSenadoTransparenciaInitiative(mapped);

        if (persisted.inserted) {
          insertedInitiatives += 1;
        } else {
          updatedInitiatives += 1;
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        processedFiles,
        parsedInitiatives,
        insertedInitiatives,
        updatedInitiatives,
        dryRun,
        sampleTitles
      },
      null,
      2
    )
  );
}

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

function getNumberArg(flag: string): number | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((value) => value === flag);

  if (index === -1) {
    return undefined;
  }

  const rawValue = args[index + 1];
  const value = rawValue ? Number(rawValue) : NaN;

  return Number.isFinite(value) ? value : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

void main().catch((error) => {
  console.error("Senado datos abiertos local ingestion failed", error);
  process.exitCode = 1;
});
