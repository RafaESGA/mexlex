import type { CanonicalCandidate } from "@mexlex/shared/types/ingestion";
import type { SourceAdapter } from "./adapter.js";
import { emptyCheckpoint } from "./checkpoint.js";
import { dedupeParsedRecords } from "./dedupe.js";

export async function runIngestionPipeline(adapter: SourceAdapter): Promise<CanonicalCandidate[]> {
  const checkpoint = emptyCheckpoint(adapter.source);
  const discovered = await adapter.discover(checkpoint);
  const fetched = await Promise.all(discovered.map((record) => adapter.fetch(record)));
  const parsed = await Promise.all(fetched.flat().map((artifact) => adapter.parse(artifact)));
  const deduped = dedupeParsedRecords(parsed.flat());
  const candidates = await Promise.all(deduped.map((record) => adapter.map(record)));

  return candidates.flat();
}

