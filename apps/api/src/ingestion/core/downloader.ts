import type { DiscoveredRecord, RawFetchedArtifact } from "@mexlex/shared/types/ingestion";

export async function downloadRecord(record: DiscoveredRecord): Promise<RawFetchedArtifact[]> {
  return [
    {
      source: record.source,
      recordKey: record.recordKey,
      sourceUrl: record.sourceUrl,
      mimeType: "text/html",
      body: "",
      fetchedAt: new Date().toISOString()
    }
  ];
}

