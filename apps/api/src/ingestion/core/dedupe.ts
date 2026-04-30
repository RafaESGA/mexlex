import type { ParsedSourceRecord } from "@mexlex/shared/types/ingestion";

export function dedupeParsedRecords(records: ParsedSourceRecord[]): ParsedSourceRecord[] {
  const seen = new Set<string>();

  return records.filter((record) => {
    const key = `${record.source}:${record.recordType}:${record.recordKey}:${record.contentHash}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

