import type { InitiativeDetail } from "@mexlex/shared/domain/initiative";
import type { Chamber, InitiativeStatus } from "@mexlex/shared/taxonomy/legislative";
import type { InitiativeDetailRpcRow } from "../../db/queries/rpc.types.js";

type InitiativeAuthorJson = {
  author_id: string;
  full_name: string;
  role?: string;
};

type AffectedNormJson = {
  norm_name: string;
  article_reference?: string;
  action?: string;
};

type SourceLinkJson = {
  source_system: string;
  source_native_id?: string;
  source_url?: string;
  confidence?: number;
};

export function mapInitiativeDetailRow(row: InitiativeDetailRpcRow): InitiativeDetail {
  const authors = toArray<InitiativeAuthorJson>(row.authors);
  const affectedNorms = toArray<AffectedNormJson>(row.affected_norms);
  const sourceLinks = toArray<SourceLinkJson>(row.source_links);

  return {
    id: row.initiative_id,
    canonicalTitle: row.canonical_title,
    normalizedStatus: row.normalized_status as InitiativeStatus,
    rawStatus: row.raw_status,
    summary: row.summary ?? undefined,
    matterTopic: row.matter_topic,
    originatingChamber: row.originating_chamber as Chamber | null,
    currentChamber: row.current_chamber as Chamber | null,
    presentedAt: row.presented_at,
    lastMajorEventAt: row.last_major_event_at,
    authors: authors.map((author) => ({
      id: author.author_id,
      fullName: author.full_name,
      role: author.role
    })),
    aliases: [],
    affectedNorms: affectedNorms.map((norm) => ({
      normName: norm.norm_name,
      articleReference: norm.article_reference,
      action: norm.action
    })),
    sourceLinks: sourceLinks.map((source) => ({
      source: source.source_system,
      sourceNativeId: source.source_native_id,
      sourceUrl: source.source_url,
      confidence: source.confidence
    })),
    documentCount: row.document_count ?? 0,
    eventCount: row.event_count ?? 0
  };
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

