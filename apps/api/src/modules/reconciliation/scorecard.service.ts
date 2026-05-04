import { supabaseAdmin } from "../../db/supabase.js";
import {
  buildQualityAuditReport,
  type AuthorAuditRow,
  type InitiativeAuditRow,
  type InitiativeCommissionAuditRow,
  type InitiativeSourceAuditRow,
  type LegislativeEventAuditRow
} from "./quality-audit.js";
import { buildReconciliationScorecard, type ReconciliationScorecard } from "./scorecard.js";

export const reconciliationScorecardService = {
  async getScorecard(): Promise<ReconciliationScorecard> {
    const [initiatives, authors, sourceLinks, events, commissions] = await Promise.all([
      fetchAllInitiatives(),
      fetchAllAuthors(),
      fetchAllSourceLinks(),
      fetchAllEvents(),
      fetchAllCommissionCounts()
    ]);

    const report = buildQualityAuditReport({
      initiatives,
      authors,
      sources: sourceLinks,
      events,
      commissions
    });

    return buildReconciliationScorecard(report);
  }
};

async function fetchAllInitiatives(): Promise<InitiativeAuditRow[]> {
  const rows = await fetchPaginated<{
    id: string;
    canonical_title: string;
    title_normalized: string;
    presented_at: string | null;
    normalized_status: string;
    originating_chamber: string | null;
    metadata: Record<string, unknown> | null;
  }>("initiatives", "id, canonical_title, title_normalized, presented_at, normalized_status, originating_chamber, metadata");

  return rows.map((row) => ({
    id: row.id,
    canonicalTitle: row.canonical_title,
    titleNormalized: row.title_normalized,
    presentedAt: row.presented_at,
    normalizedStatus: row.normalized_status,
    originatingChamber: row.originating_chamber,
    metadata: row.metadata ?? {}
  }));
}

async function fetchAllAuthors(): Promise<AuthorAuditRow[]> {
  const rows = await fetchPaginated<{
    id: string;
    full_name: string;
    name_normalized: string;
    chamber: string | null;
  }>("authors", "id, full_name, name_normalized, chamber");

  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    nameNormalized: row.name_normalized,
    chamber: row.chamber
  }));
}

async function fetchAllSourceLinks(): Promise<InitiativeSourceAuditRow[]> {
  const sourceRows = await fetchPaginated<{
    id: string;
    system: string;
    priority: number;
  }>("sources", "id, system, priority");
  const sourceMap = new Map(sourceRows.map((row) => [row.id, row]));

  const recordRows = await fetchPaginated<{
    id: string;
    source_id: string;
    source_url: string | null;
  }>("source_records", "id, source_id, source_url");
  const recordMap = new Map(recordRows.map((row) => [row.id, row]));

  const linkRows = await fetchPaginated<{
    initiative_id: string;
    source_record_id: string;
    source_title: string | null;
    source_status: string | null;
    confidence: number;
    is_primary: boolean;
  }>(
    "initiative_source_links",
    "initiative_id, source_record_id, source_title, source_status, confidence, is_primary"
  );

  return linkRows.flatMap((row) => {
    const record = recordMap.get(row.source_record_id);
    const source = record ? sourceMap.get(record.source_id) : null;

    if (!record || !source) {
      return [];
    }

    return [
      {
        initiativeId: row.initiative_id,
        sourceRecordId: row.source_record_id,
        sourceSystem: source.system,
        sourcePriority: source.priority,
        sourceUrl: record.source_url,
        sourceTitle: row.source_title,
        sourceStatus: row.source_status,
        confidence: row.confidence,
        isPrimary: row.is_primary
      }
    ];
  });
}

async function fetchAllEvents(): Promise<LegislativeEventAuditRow[]> {
  const rows = await fetchPaginated<{
    initiative_id: string;
    event_type: string;
    event_date: string;
    normalized_status_after: string | null;
  }>("legislative_events", "initiative_id, event_type, event_date, normalized_status_after");

  return rows.map((row) => ({
    initiativeId: row.initiative_id,
    eventType: row.event_type,
    eventDate: row.event_date,
    normalizedStatusAfter: row.normalized_status_after
  }));
}

async function fetchAllCommissionCounts(): Promise<InitiativeCommissionAuditRow[]> {
  const rows = await fetchPaginated<{
    initiative_id: string;
    commission_id: string;
  }>("initiative_commissions", "initiative_id, commission_id");
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.initiative_id, (counts.get(row.initiative_id) ?? 0) + 1);
  }

  return [...counts.entries()].map(([initiativeId, commissionCount]) => ({
    initiativeId,
    commissionCount
  }));
}

async function fetchPaginated<T>(table: string, select: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin.from(table).select(select).range(from, to);

    if (error) {
      throw new Error(`Failed to fetch ${table}: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...(data as T[]));

    if (data.length < pageSize) {
      break;
    }
  }

  return rows;
}
