import type { SourceAdapter } from "../core/adapter.js";
import { runIngestionPipeline } from "../core/pipeline.js";

export async function ingestSourceJob(adapter: SourceAdapter) {
  return runIngestionPipeline(adapter);
}

