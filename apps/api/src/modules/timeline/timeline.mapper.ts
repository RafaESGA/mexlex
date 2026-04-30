import type { LegislativeEvent } from "@mexlex/shared/domain/timeline";
import type { Chamber, EventType } from "@mexlex/shared/taxonomy/legislative";
import type { TimelineRpcRow } from "../../db/queries/rpc.types.js";

type SourceLinkJson = {
  source_system: string;
  source_name?: string;
  source_url?: string;
  record_type?: string;
  source_record_key?: string;
  fetched_at?: string;
};

export function mapTimelineRow(row: TimelineRpcRow): LegislativeEvent {
  const sourceLinks = Array.isArray(row.source_links) ? (row.source_links as SourceLinkJson[]) : [];

  return {
    id: row.event_id,
    eventType: row.event_type as EventType,
    eventDate: row.event_date,
    sequenceInDay: row.sequence_in_day,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    stage: row.stage,
    chamber: row.chamber as Chamber | undefined,
    normalizedStatusAfter: row.normalized_status_after,
    rawStatus: row.raw_status,
    sourceLinks: sourceLinks.map((source) => ({
      sourceSystem: source.source_system,
      sourceName: source.source_name,
      sourceUrl: source.source_url,
      recordType: source.record_type,
      sourceRecordKey: source.source_record_key,
      fetchedAt: source.fetched_at
    }))
  };
}

