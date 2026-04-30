import type { AdapterCheckpoint } from "@mexlex/shared/types/ingestion";

export function emptyCheckpoint(source: string): AdapterCheckpoint {
  return {
    source,
    cursor: null,
    lastSuccessfulRunAt: null
  };
}

