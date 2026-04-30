import { dedupeParsedRecords } from "../../core/dedupe.js";
import { discoverSenadoTransparenciaRecords, senadoTransparenciaAdapter } from "./index.js";
import { persistSenadoTransparenciaInitiative } from "./persist.js";
import type { SenadoMappedInitiative } from "../senado-gaceta/types.js";

export type SenadoTransparenciaIngestionOptions = {
  years?: string[];
  maxYears?: number;
  maxItems?: number;
};

export type SenadoTransparenciaIngestionResult = {
  discoveredFiles: number;
  parsedInitiatives: number;
  candidateInitiatives: number;
  insertedInitiatives: number;
  updatedInitiatives: number;
  sampleTitles: string[];
};

export async function runSenadoTransparenciaIngestion(
  options: SenadoTransparenciaIngestionOptions = {}
): Promise<SenadoTransparenciaIngestionResult> {
  const discovered = await discoverSenadoTransparenciaRecords(options);
  const fetched = await Promise.all(discovered.map((record) => senadoTransparenciaAdapter.fetch(record)));
  const parsed = await Promise.all(fetched.flat().map((artifact) => senadoTransparenciaAdapter.parse(artifact)));
  const deduped = dedupeParsedRecords(parsed.flat());
  const candidates = await Promise.all(deduped.map((record) => senadoTransparenciaAdapter.map(record)));
  const flatCandidates = candidates.flat().slice(0, options.maxItems);

  let insertedInitiatives = 0;
  let updatedInitiatives = 0;

  for (const candidate of flatCandidates) {
    const mapped = candidate.payload as SenadoMappedInitiative;
    const persisted = await persistSenadoTransparenciaInitiative(mapped);

    if (persisted.inserted) {
      insertedInitiatives += 1;
    } else {
      updatedInitiatives += 1;
    }
  }

  return {
    discoveredFiles: discovered.length,
    parsedInitiatives: deduped.length,
    candidateInitiatives: flatCandidates.length,
    insertedInitiatives,
    updatedInitiatives,
    sampleTitles: flatCandidates
      .slice(0, 10)
      .map((candidate) => String(candidate.payload.canonicalTitle ?? ""))
      .filter(Boolean)
  };
}
