import { supabaseAdmin } from "../../../db/supabase.js";
import { inferStatusFromEvent } from "../../../modules/normalization/status-taxonomy.js";
import { loadEnv } from "../../../config/env.js";
import { rebalanceInitiativePrimarySourceLinks } from "../../../modules/reconciliation/source-links.js";
import { normalizeText } from "../../core/normalization.js";
import { sha256 } from "../../core/hashing.js";
import type { SilMappedInitiative } from "./types.js";
import type { EventType, InitiativeStatus } from "@mexlex/shared/taxonomy/legislative";

const env = loadEnv();

export async function persistSilInitiative(mapped: SilMappedInitiative): Promise<{ inserted: boolean; initiativeId: string }> {
  const source = await getSilSource();
  const existing = await findExistingInitiative(mapped);
  const initiativeId = existing?.id ?? (await insertInitiative(mapped));

  if (existing?.id) {
    await updateInitiative(existing.id, mapped);
  }

  const storagePath = await uploadRawHtml(mapped.rawHtml, mapped.dedupeHash);
  const sourceRecordId = await upsertSourceRecord(source.id, mapped, storagePath);
  const documentId = await upsertHtmlDocument(source.id, initiativeId, mapped, storagePath);

  await linkInitiativeToSource(initiativeId, sourceRecordId, mapped);

  if (documentId) {
    await linkDocumentToSource(documentId, sourceRecordId);
  }

  await upsertAuthors(initiativeId, mapped);
  await upsertLegislativeEvents(initiativeId, sourceRecordId, mapped);

  return {
    inserted: !existing,
    initiativeId
  };
}

async function getSilSource(): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin.from("sources").select("id").eq("system", "sil").maybeSingle();

  if (error || !data) {
    throw new Error(`Unable to resolve SIL source: ${error?.message ?? "not found"}`);
  }

  return data;
}

async function findExistingInitiative(mapped: SilMappedInitiative): Promise<{ id: string } | null> {
  const detailSourceUrl = getMetadataString(mapped.metadata, "detail_source_url") ?? getMetadataString(mapped.metadata, "detail_url");
  if (detailSourceUrl) {
    const { data: detailMatches, error: detailError } = await supabaseAdmin
      .from("initiatives")
      .select("id, canonical_title, metadata")
      .eq("presented_at", mapped.presentedAt)
      .limit(10);

    if (detailError) {
      throw new Error(`Failed to query initiatives by detail_source_url: ${detailError.message}`);
    }

    const preferredDetailMatch = chooseBestInitiativeMatch(
      (detailMatches ?? []).filter((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        return (
          metadata.detail_source_url === detailSourceUrl ||
          metadata.detail_url === detailSourceUrl ||
          metadata.result_source_url === getMetadataString(mapped.metadata, "result_source_url")
        );
      })
    );

    if (preferredDetailMatch) {
      return { id: preferredDetailMatch.id as string };
    }
  }

  let query = supabaseAdmin
    .from("initiatives")
    .select("id, canonical_title, metadata, title_normalized, presented_at")
    .eq("title_normalized", mapped.titleNormalized)
    .limit(5);

  query = mapped.presentedAt ? query.eq("presented_at", mapped.presentedAt) : query.is("presented_at", null);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to query initiatives for dedupe: ${error.message}`);
  }

  const exactHashMatch = (data ?? []).find((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return metadata.sil_dedupe_hash === mapped.dedupeHash;
  });

  if (exactHashMatch) {
    return { id: exactHashMatch.id as string };
  }

  const preferredMatch = chooseBestInitiativeMatch(data ?? []);
  return preferredMatch ? { id: preferredMatch.id as string } : null;
}

async function insertInitiative(mapped: SilMappedInitiative): Promise<string> {
  const chamber = toChamberEnum(mapped.chamber);
  const derivedStatus = deriveInitiativeStatus(mapped);
  const { data, error } = await supabaseAdmin
    .from("initiatives")
    .insert({
      canonical_title: mapped.canonicalTitle,
      title_normalized: mapped.titleNormalized,
      summary: mapped.summary,
      matter_topic: getMetadataString(mapped.metadata, "topic"),
      originating_chamber: chamber,
      current_chamber: chamber,
      normalized_status: derivedStatus,
      raw_status: mapped.rawStatus,
      presented_at: mapped.presentedAt,
      metadata: {
        ...mapped.metadata,
        initiative_type: mapped.initiativeType,
        sil_dedupe_hash: mapped.dedupeHash,
        source_url: mapped.sourceUrl
      }
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert initiative: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

async function updateInitiative(initiativeId: string, mapped: SilMappedInitiative): Promise<void> {
  const chamber = toChamberEnum(mapped.chamber);
  const derivedStatus = deriveInitiativeStatus(mapped);
  const { error } = await supabaseAdmin
    .from("initiatives")
    .update({
      canonical_title: mapped.canonicalTitle,
      title_normalized: mapped.titleNormalized,
      summary: mapped.summary,
      matter_topic: getMetadataString(mapped.metadata, "topic"),
      originating_chamber: chamber,
      current_chamber: chamber,
      normalized_status: derivedStatus,
      raw_status: mapped.rawStatus,
      presented_at: mapped.presentedAt,
      metadata: {
        ...mapped.metadata,
        initiative_type: mapped.initiativeType,
        sil_dedupe_hash: mapped.dedupeHash,
        source_url: mapped.sourceUrl
      }
    })
    .eq("id", initiativeId);

  if (error) {
    throw new Error(`Failed to update initiative: ${error.message}`);
  }
}

async function upsertAuthors(initiativeId: string, mapped: SilMappedInitiative): Promise<void> {
  for (const [index, author] of mapped.authors.entries()) {
    const nameNormalized = normalizeText(author.fullName);
    const existingAuthor = await findAuthorByNormalizedName(nameNormalized);
    const authorId = existingAuthor?.id ?? (await insertAuthor(author.fullName, nameNormalized, mapped.chamber));

    const { error } = await supabaseAdmin.from("initiative_authors").upsert(
      {
        initiative_id: initiativeId,
        author_id: authorId,
        role: author.role,
        sort_order: index + 1,
        metadata: {}
      },
      {
        onConflict: "initiative_id,author_id,role"
      }
    );

    if (error) {
      throw new Error(`Failed to upsert initiative author relation: ${error.message}`);
    }
  }
}

async function findAuthorByNormalizedName(nameNormalized: string): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("authors")
    .select("id")
    .eq("name_normalized", nameNormalized)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query authors: ${error.message}`);
  }

  return data;
}

async function insertAuthor(fullName: string, nameNormalized: string, chamber: string | null): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("authors")
    .insert({
      full_name: fullName,
      name_normalized: nameNormalized,
      chamber: toChamberEnum(chamber),
      profile_data: {}
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert author: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

async function uploadRawHtml(rawHtml: string, dedupeHash: string): Promise<string> {
  const storagePath = `raw/${new Date().toISOString().slice(0, 10)}/${dedupeHash}.html`;
  const bytes = new TextEncoder().encode(rawHtml);

  const { error } = await supabaseAdmin.storage.from(env.silRawStorageBucket).upload(storagePath, bytes, {
    contentType: "text/html",
    upsert: true
  });

  if (error) {
    throw new Error(`Failed to upload raw HTML to storage: ${error.message}`);
  }

  return storagePath;
}

async function upsertSourceRecord(
  sourceId: string,
  mapped: SilMappedInitiative,
  storagePath: string
): Promise<string> {
  const contentHash = sha256(mapped.rawHtml);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("source_records")
    .select("id")
    .eq("source_id", sourceId)
    .eq("record_type", "initiative_html")
    .eq("source_record_key", mapped.sourceRecordKey)
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to query source_records: ${existingError.message}`);
  }

  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabaseAdmin
    .from("source_records")
    .insert({
      source_id: sourceId,
      record_type: "initiative_html",
      source_record_key: mapped.sourceRecordKey,
      source_url: mapped.sourceUrl,
      content_hash: contentHash,
      raw_payload: {
        storage_path: storagePath,
        content_type: "text/html"
      },
      parsed_payload: {
        title: mapped.canonicalTitle,
        presented_at: mapped.presentedAt,
        authors: mapped.authors,
        raw_status: mapped.rawStatus,
        chamber: mapped.chamber,
        initiative_type: mapped.initiativeType
      },
      status: "parsed"
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert source_record: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

async function upsertHtmlDocument(
  _sourceId: string,
  initiativeId: string | null,
  mapped: SilMappedInitiative,
  storagePath: string
): Promise<string | null> {
  const htmlHash = sha256(mapped.rawHtml);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("documents")
    .select("id")
    .eq("sha256", htmlHash)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to query documents: ${existingError.message}`);
  }

  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabaseAdmin
    .from("documents")
    .insert({
      initiative_id: initiativeId,
      document_kind: "html_snapshot",
      title: mapped.canonicalTitle,
      mime_type: "text/html",
      source_url: mapped.sourceUrl,
      storage_path: storagePath,
      sha256: htmlHash,
      raw_text: mapped.rawHtml,
      extracted_text: stripHtml(mapped.rawHtml),
      extraction_status: "complete",
      metadata: {
        source_record_key: mapped.sourceRecordKey
      }
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert document: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

async function linkInitiativeToSource(
  initiativeId: string,
  sourceRecordId: string,
  mapped: SilMappedInitiative
): Promise<void> {
  const { error } = await supabaseAdmin.from("initiative_source_links").upsert(
    {
      initiative_id: initiativeId,
      source_record_id: sourceRecordId,
      source_native_id: mapped.sourceRecordKey,
      source_title: mapped.canonicalTitle,
      source_status: mapped.rawStatus,
      confidence: 1,
      is_primary: false
    },
    {
      onConflict: "initiative_id,source_record_id"
    }
  );

  if (error) {
    throw new Error(`Failed to link initiative to source: ${error.message}`);
  }

  await rebalanceInitiativePrimarySourceLinks(initiativeId);
}

async function linkDocumentToSource(documentId: string, sourceRecordId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("document_source_links").upsert(
    {
      document_id: documentId,
      source_record_id: sourceRecordId
    },
    {
      onConflict: "document_id,source_record_id"
    }
  );

  if (error) {
    throw new Error(`Failed to link document to source: ${error.message}`);
  }
}

async function upsertLegislativeEvents(
  initiativeId: string,
  sourceRecordId: string,
  mapped: SilMappedInitiative
): Promise<void> {
  const presentationEventDate = mapped.presentedAt ? `${mapped.presentedAt}T00:00:00.000Z` : null;

  if (presentationEventDate) {
    const presentationEventId = await upsertLegislativeEvent({
      initiativeId,
      eventType: "presentation",
      eventDate: presentationEventDate,
      chamber: mapped.chamber,
      title: "Presentación de iniciativa",
      description: mapped.canonicalTitle,
      normalizedStatusAfter: inferStatusFromEvent("presentation"),
      metadata: {
        source: "sil",
        initiative_type: mapped.initiativeType
      }
    });

    await linkEventToSource(presentationEventId, sourceRecordId);
  }

  const referredTo = getMetadataString(mapped.metadata, "referred_to");
  if (referredTo) {
    const referredEventId = await upsertLegislativeEvent({
      initiativeId,
      eventType: "turn_to_commission",
      eventDate: presentationEventDate ?? new Date().toISOString(),
      chamber: mapped.chamber,
      title: "Turnado a comisión",
      description: referredTo,
      normalizedStatusAfter: inferStatusFromEvent("turn_to_commission"),
      metadata: {
        source: "sil"
      }
    });

    await linkEventToSource(referredEventId, sourceRecordId);
  }

  if (mapped.rawStatus) {
    const statusEventType = inferEventTypeFromRawStatus(mapped.rawStatus);
    const statusEventId = await upsertLegislativeEvent({
      initiativeId,
      eventType: statusEventType,
      eventDate: extractStatusDate(mapped.rawStatus) ?? presentationEventDate ?? new Date().toISOString(),
      chamber: mapped.chamber,
      title: "Estatus legislativo",
      description: mapped.rawStatus,
      normalizedStatusAfter: inferStatusFromEvent(statusEventType),
      metadata: {
        source: "sil"
      }
    });

    await linkEventToSource(statusEventId, sourceRecordId);
  }
}

async function upsertLegislativeEvent(input: {
  initiativeId: string;
  eventType: EventType;
  eventDate: string;
  chamber: string | null;
  title: string;
  description: string;
  normalizedStatusAfter: InitiativeStatus;
  metadata: Record<string, unknown>;
}): Promise<string> {
  const eventHash = sha256(
    [
      input.initiativeId,
      input.eventType,
      input.eventDate,
      input.title
    ].join("|")
  );

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("legislative_events")
    .select("id")
    .eq("initiative_id", input.initiativeId)
    .eq("event_type", input.eventType)
    .eq("event_date", input.eventDate)
    .eq("title", input.title)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to query legislative_events: ${existingError.message}`);
  }

  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from("legislative_events")
      .update({
        chamber: toChamberEnum(input.chamber),
        title: input.title,
        description: input.description,
        normalized_status_after: input.normalizedStatusAfter,
        event_hash: eventHash,
        metadata: input.metadata
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`Failed to update legislative event: ${updateError.message}`);
    }

    return existing.id;
  }

  const { data, error } = await supabaseAdmin
    .from("legislative_events")
    .insert({
      initiative_id: input.initiativeId,
      event_type: input.eventType,
      event_date: input.eventDate,
      chamber: toChamberEnum(input.chamber),
      title: input.title,
      description: input.description,
      normalized_status_after: input.normalizedStatusAfter,
      event_hash: eventHash,
      metadata: input.metadata
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert legislative event: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

async function linkEventToSource(legislativeEventId: string, sourceRecordId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("event_source_links").upsert(
    {
      legislative_event_id: legislativeEventId,
      source_record_id: sourceRecordId
    },
    {
      onConflict: "legislative_event_id,source_record_id"
    }
  );

  if (error) {
    throw new Error(`Failed to link event to source: ${error.message}`);
  }
}

function inferEventTypeFromRawStatus(rawStatus: string): EventType {
  const normalized = normalizeText(rawStatus);

  if (normalized.includes("publicado en dof") || (normalized.includes("publicad") && normalized.includes("diario oficial"))) {
    return "dof_publication";
  }

  if (normalized.includes("aprob")) {
    return "approved_origin";
  }

  if (normalized.includes("pendiente en comision")) {
    return "turn_to_commission";
  }

  if (normalized.includes("desechad")) {
    return "rejection";
  }

  if (normalized.includes("devuelto")) {
    return "returned_with_changes";
  }

  if (normalized.includes("retirad")) {
    return "withdrawal";
  }

  if (normalized.includes("archivad")) {
    return "archival";
  }

  return "other";
}

function extractStatusDate(rawStatus: string): string | null {
  const monthMap: Record<string, string> = {
    ENE: "01",
    FEB: "02",
    MAR: "03",
    ABR: "04",
    MAY: "05",
    JUN: "06",
    JUL: "07",
    AGO: "08",
    SEP: "09",
    OCT: "10",
    NOV: "11",
    DIC: "12"
  };

  const match = rawStatus.match(/\b(\d{2})-([A-Z]{3})-(\d{4})\b/);
  if (!match) {
    return null;
  }

  const month = monthMap[match[2]];
  if (!month) {
    return null;
  }

  return `${match[3]}-${month}-${match[1]}T00:00:00.000Z`;
}

function deriveInitiativeStatus(mapped: SilMappedInitiative): InitiativeStatus {
  if (mapped.rawStatus) {
    return inferStatusFromEvent(inferEventTypeFromRawStatus(mapped.rawStatus));
  }

  return mapped.presentedAt ? "presented" : "unknown";
}

function getMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function chooseBestInitiativeMatch(
  rows: Array<{ id: string; canonical_title?: string | null; metadata?: unknown }>
): { id: string } | null {
  const ranked = [...rows].sort((left, right) => {
    return scoreInitiativeCandidate(right) - scoreInitiativeCandidate(left);
  });

  return ranked[0] ?? null;
}

function scoreInitiativeCandidate(row: { canonical_title?: string | null; metadata?: unknown }): number {
  const title = row.canonical_title ?? "";
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const parser = typeof metadata.parser === "string" ? metadata.parser : "";

  let score = 0;

  if (!isGenericSilPopupTitle(title)) {
    score += 10;
  }

  if (parser === "sil-detail-html-v1") {
    score += 2;
  }

  return score;
}

function isGenericSilPopupTitle(value: string): boolean {
  return /SIL - Sistema de Informaci[oó]n Legislativa|PopUp Contenido Asuntos/i.test(value);
}

function toChamberEnum(chamber: string | null): string | null {
  const normalized = normalizeText(chamber ?? "");

  if (!normalized) {
    return null;
  }

  if (normalized.includes("diput")) {
    return "diputados";
  }

  if (normalized.includes("senad")) {
    return "senado";
  }

  if (normalized.includes("ejecut")) {
    return "ejecutivo";
  }

  return "otro";
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
