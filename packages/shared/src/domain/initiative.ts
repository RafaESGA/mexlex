import type { Chamber } from "../taxonomy/legislative";
import type { InitiativeStatus } from "../taxonomy/legislative";

export type InitiativeDetail = {
  id: string;
  canonicalTitle: string;
  normalizedStatus: InitiativeStatus;
  rawStatus: string | null;
  summary?: string;
  matterTopic?: string | null;
  originatingChamber?: Chamber | null;
  currentChamber?: Chamber | null;
  presentedAt?: string | null;
  lastMajorEventAt?: string | null;
  authors: Array<{ id: string; fullName: string; role?: string }>;
  aliases: string[];
  affectedNorms: Array<{ normName: string; articleReference?: string; action?: string }>;
  sourceLinks: Array<{ source: string; sourceNativeId?: string; sourceUrl?: string; confidence?: number }>;
  documentCount?: number;
  eventCount?: number;
};
