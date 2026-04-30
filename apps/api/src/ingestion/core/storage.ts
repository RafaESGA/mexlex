import type { RawFetchedArtifact } from "@mexlex/shared/types/ingestion";

export async function persistRawArtifact(_artifact: RawFetchedArtifact): Promise<{ storagePath: string | null }> {
  return { storagePath: null };
}

