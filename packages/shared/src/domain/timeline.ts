import type { Chamber, EventType } from "../taxonomy/legislative";

export type LegislativeEvent = {
  id: string;
  eventType: EventType;
  eventDate: string;
  sequenceInDay?: number | null;
  title?: string;
  description?: string;
  stage?: string | null;
  chamber?: Chamber;
  normalizedStatusAfter?: string | null;
  rawStatus?: string | null;
  sourceLinks?: Array<{
    sourceSystem: string;
    sourceName?: string;
    sourceUrl?: string;
    recordType?: string;
    sourceRecordKey?: string;
    fetchedAt?: string;
  }>;
};

export type LegislativeTimelineResponse = {
  initiativeId: string;
  events: LegislativeEvent[];
};
