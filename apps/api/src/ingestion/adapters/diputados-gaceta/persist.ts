import { supabaseAdmin } from "../../../db/supabase.js";
import { inferStatusFromEvent } from "../../../modules/normalization/status-taxonomy.js";
import { rebalanceInitiativePrimarySourceLinks } from "../../../modules/reconciliation/source-links.js";
import { normalizeText } from "../../core/normalization.js";
import { sha256 } from "../../core/hashing.js";
import type { DiputadosMappedInitiative } from "./types.js";
import type { EventType, InitiativeStatus } from "@mexlex/shared/taxonomy/legislative";

export async function persistDiputadosGacetaInitiative(
  mapped: DiputadosMappedInitiative
): Promise<{ inserted: boolean; initiativeId: string }> {
  const source = await getSource();
  const existing = await findExistingInitiative(mapped);
  const initiativeId = existing?.id ?? (await insertInitiative(mapped));

  if (existing?.id) {
    await updateInitiative(existing.id, mapped);
  }

  const sourceRecordId = await upsertSourceRecord(source.id, mapped);
  await linkInitiativeToSource(initiativeId, sourceRecordId, mapped);
  await upsertAuthors(initiativeId, mapped);
  await upsertLegislativeEvents(initiativeId, sourceRecordId, mapped);

  return {
    inserted: !existing,
    initiativeId
  };
}

export async function rebuildDiputadosInitiativeDerivedData(input: {
  initiativeId: string;
  canonicalTitle: string;
  summary: string | null;
  presentedAt: string | null;
  rawStatus: string | null;
  chamber: string | null;
  metadata: Record<string, unknown>;
  sourceRecordId?: string | null;
}): Promise<{ eventCount: number; normalizedStatus: InitiativeStatus }> {
  const sourceRecordId = input.sourceRecordId ?? (await findAnySourceRecordIdForInitiative(input.initiativeId));
  const derived = buildDiputadosDerivedState({
    canonicalTitle: input.canonicalTitle,
    summary: input.summary,
    presentedAt: input.presentedAt,
    rawStatus: input.rawStatus,
    chamber: input.chamber,
    metadata: input.metadata
  });

  await deleteExistingDiputadosEvents(input.initiativeId);

  for (const event of derived.events) {
    const legislativeEventId = await upsertLegislativeEvent({
      initiativeId: input.initiativeId,
      eventType: event.eventType,
      eventDate: event.eventDate,
      chamber: input.chamber,
      title: event.title,
      description: event.description,
      normalizedStatusAfter: event.normalizedStatusAfter,
      metadata: {
        source: "gaceta_diputados",
        gaceta_issue_number: getMetadataString(input.metadata, "gaceta_issue_number"),
        source_entry_id: getMetadataString(input.metadata, "source_entry_id")
      }
    });

    if (sourceRecordId) {
      await linkEventToSource(legislativeEventId, sourceRecordId);
    }
  }

  await updateDiputadosInitiativeDerivedFields(input.initiativeId, input.chamber, input.metadata, derived.normalizedStatus, derived.events);
  await upsertDiputadosCommissionRelations(input.initiativeId, input.chamber, derived.events);

  return {
    eventCount: derived.events.length,
    normalizedStatus: derived.normalizedStatus
  };
}

async function getSource(): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin.from("sources").select("id").eq("system", "gaceta_diputados").maybeSingle();

  if (error || !data) {
    throw new Error(`Unable to resolve Diputados Gaceta source: ${error?.message ?? "not found"}`);
  }

  return data;
}

async function findExistingInitiative(mapped: DiputadosMappedInitiative): Promise<{ id: string } | null> {
  const sourceEntryId = getMetadataString(mapped.metadata, "source_entry_id");
  const gacetaIssueNumber = getMetadataString(mapped.metadata, "gaceta_issue_number");
  const sourcePageUrl = getMetadataString(mapped.metadata, "source_page_url");
  const sourceBlockIndex = getMetadataNumber(mapped.metadata, "source_block_index");
  const sourceLegislature = getMetadataString(mapped.metadata, "source_legislature");

  if (sourceEntryId && gacetaIssueNumber && sourceLegislature) {
    const { data: entryMatches, error: entryError } = await supabaseAdmin
      .from("initiatives")
      .select("id, metadata")
      .eq("presented_at", mapped.presentedAt)
      .limit(50);

    if (entryError) {
      throw new Error(`Failed to query iniciativas by diputados source entry id: ${entryError.message}`);
    }

    const entryMatch = (entryMatches ?? []).find((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return (
        metadata.source_entry_id === sourceEntryId &&
        metadata.gaceta_issue_number === gacetaIssueNumber &&
        metadata.source_legislature === sourceLegislature
      );
    });

    if (entryMatch) {
      return { id: entryMatch.id as string };
    }
  }

  if (sourcePageUrl && sourceBlockIndex !== null) {
    const { data: sourceMatches, error: sourceError } = await supabaseAdmin
      .from("initiatives")
      .select("id, metadata")
      .eq("presented_at", mapped.presentedAt)
      .limit(20);

    if (sourceError) {
      throw new Error(`Failed to query iniciativas by diputados source metadata: ${sourceError.message}`);
    }

    const exactSourceMatch = (sourceMatches ?? []).find((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return (
        metadata.source_page_url === sourcePageUrl &&
        Number(metadata.source_block_index ?? -1) === sourceBlockIndex &&
        metadata.source_legislature === sourceLegislature
      );
    });

    if (exactSourceMatch) {
      return { id: exactSourceMatch.id as string };
    }
  }

  const { data, error } = await supabaseAdmin
    .from("initiatives")
    .select("id, metadata")
    .eq("title_normalized", mapped.titleNormalized)
    .eq("presented_at", mapped.presentedAt)
    .limit(5);

  if (error) {
    throw new Error(`Failed to query initiatives for diputados dedupe: ${error.message}`);
  }

  const exact = (data ?? []).find((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return metadata.diputados_dedupe_hash === mapped.dedupeHash;
  });

  return exact ? { id: exact.id as string } : ((data ?? [])[0] as { id: string } | undefined) ?? null;
}

async function insertInitiative(mapped: DiputadosMappedInitiative): Promise<string> {
  const chamber = toChamberEnum(mapped.chamber);
  const derivedStatus = deriveInitiativeStatus(mapped);
  const { data, error } = await supabaseAdmin
    .from("initiatives")
    .insert({
      canonical_title: mapped.canonicalTitle,
      title_normalized: mapped.titleNormalized,
      summary: mapped.summary,
      originating_chamber: chamber,
      current_chamber: chamber,
      normalized_status: derivedStatus,
      raw_status: mapped.rawStatus,
      presented_at: mapped.presentedAt,
      metadata: {
        ...mapped.metadata,
        diputados_dedupe_hash: mapped.dedupeHash,
        source_url: mapped.sourceUrl,
        initiative_type: mapped.initiativeType
      }
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert diputados initiative: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

async function updateInitiative(initiativeId: string, mapped: DiputadosMappedInitiative): Promise<void> {
  const chamber = toChamberEnum(mapped.chamber);
  const derivedStatus = deriveInitiativeStatus(mapped);
  const { error } = await supabaseAdmin
    .from("initiatives")
    .update({
      canonical_title: mapped.canonicalTitle,
      title_normalized: mapped.titleNormalized,
      summary: mapped.summary,
      originating_chamber: chamber,
      current_chamber: chamber,
      normalized_status: derivedStatus,
      raw_status: mapped.rawStatus,
      presented_at: mapped.presentedAt,
      metadata: {
        ...mapped.metadata,
        diputados_dedupe_hash: mapped.dedupeHash,
        source_url: mapped.sourceUrl,
        initiative_type: mapped.initiativeType
      }
    })
    .eq("id", initiativeId);

  if (error) {
    throw new Error(`Failed to update diputados initiative: ${error.message}`);
  }
}

async function upsertSourceRecord(sourceId: string, mapped: DiputadosMappedInitiative): Promise<string> {
  const contentHash = sha256(mapped.rawHtml);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("source_records")
    .select("id")
    .eq("source_id", sourceId)
    .eq("record_type", "initiative_html")
    .eq("source_record_key", mapped.sourceRecordKey)
    .eq("content_hash", contentHash)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to query diputados source_records: ${existingError.message}`);
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
        content_type: "text/html"
      },
      parsed_payload: {
        title: mapped.canonicalTitle,
        presented_at: mapped.presentedAt,
        authors: mapped.authors,
        raw_status: mapped.rawStatus
      },
      status: "parsed"
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert diputados source_record: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

async function linkInitiativeToSource(
  initiativeId: string,
  sourceRecordId: string,
  mapped: DiputadosMappedInitiative
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
    throw new Error(`Failed to link diputados initiative to source: ${error.message}`);
  }

  await rebalanceInitiativePrimarySourceLinks(initiativeId);
}

async function upsertAuthors(initiativeId: string, mapped: DiputadosMappedInitiative): Promise<void> {
  for (const [index, author] of mapped.authors.entries()) {
    const nameNormalized = normalizeText(author.fullName);
    const existingAuthor = await findAuthorByNormalizedName(nameNormalized);
    const authorId = existingAuthor?.id ?? (await insertAuthor(author.fullName, nameNormalized));

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
      throw new Error(`Failed to upsert diputados initiative author relation: ${error.message}`);
    }
  }
}

async function upsertLegislativeEvents(
  initiativeId: string,
  sourceRecordId: string,
  mapped: DiputadosMappedInitiative
): Promise<void> {
  const derived = buildDiputadosDerivedState(mapped);

  for (const event of derived.events) {
    const legislativeEventId = await upsertLegislativeEvent({
      initiativeId,
      eventType: event.eventType,
      eventDate: event.eventDate,
      chamber: mapped.chamber,
      title: event.title,
      description: event.description,
      normalizedStatusAfter: event.normalizedStatusAfter,
      metadata: {
        source: "gaceta_diputados",
        gaceta_issue_number: getMetadataString(mapped.metadata, "gaceta_issue_number"),
        source_entry_id: getMetadataString(mapped.metadata, "source_entry_id")
      }
    });

    await linkEventToSource(legislativeEventId, sourceRecordId);
  }

  await upsertDiputadosCommissionRelations(initiativeId, mapped.chamber, derived.events);
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
  const eventHash = sha256([input.initiativeId, input.eventType, input.eventDate, input.title].join("|"));

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
    throw new Error(`Failed to query diputados legislative_events: ${existingError.message}`);
  }

  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from("legislative_events")
      .update({
        chamber: toChamberEnum(input.chamber),
        description: input.description,
        normalized_status_after: input.normalizedStatusAfter,
        event_hash: eventHash,
        metadata: input.metadata
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`Failed to update diputados legislative event: ${updateError.message}`);
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
    throw new Error(`Failed to insert diputados legislative event: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

async function linkEventToSource(legislativeEventId: string, sourceRecordId: string): Promise<void> {
  await retrySupabaseWrite(
    async () =>
      supabaseAdmin.from("event_source_links").upsert(
        {
          legislative_event_id: legislativeEventId,
          source_record_id: sourceRecordId
        },
        {
          onConflict: "legislative_event_id,source_record_id"
        }
      ),
    "Failed to link diputados event to source"
  );
}

async function findAuthorByNormalizedName(nameNormalized: string): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("authors")
    .select("id")
    .eq("name_normalized", nameNormalized)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query authors for diputados: ${error.message}`);
  }

  return data;
}

async function insertAuthor(fullName: string, nameNormalized: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("authors")
    .insert({
      full_name: fullName,
      name_normalized: nameNormalized,
      chamber: "diputados",
      profile_data: {}
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert diputados author: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

function getMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function getMetadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractDiputadosEvents(mapped: DiputadosMappedInitiative): Array<{
  eventType: EventType;
  eventDate: string;
  title: string;
  description: string;
  normalizedStatusAfter: InitiativeStatus;
}> {
  const events: Array<{
    eventType: EventType;
    eventDate: string;
    title: string;
    description: string;
    normalizedStatusAfter: InitiativeStatus;
  }> = [];
  const seen = new Set<string>();
  const summary = mapped.summary ?? "";
  const presentationDate = mapped.presentedAt ? `${mapped.presentedAt}T00:00:00.000Z` : null;
  const gacetaIssueNumber = getMetadataString(mapped.metadata, "gaceta_issue_number");

  if (presentationDate) {
    pushEvent(events, seen, {
      eventType: "presentation",
      eventDate: presentationDate,
      title: "Presentación de iniciativa",
      description: mapped.canonicalTitle,
      normalizedStatusAfter: inferStatusFromEvent("presentation")
    });
  }

  if (presentationDate && gacetaIssueNumber) {
    pushEvent(events, seen, {
      eventType: "gaceta_publication",
      eventDate: presentationDate,
      title: "Publicación en Gaceta Parlamentaria",
      description: `Gaceta Parlamentaria, número ${gacetaIssueNumber}`,
      normalizedStatusAfter: inferStatusFromEvent("presentation")
    });
  }

  for (const sentence of splitSummarySentences(summary)) {
    const normalized = normalizeText(sentence);
    const eventDate = extractSpanishLongDate(sentence);

    if (normalized.startsWith("turnada a")) {
      pushEvent(events, seen, {
        eventType: "turn_to_commission",
        eventDate: eventDate ?? presentationDate ?? new Date().toISOString(),
        title: "Turnado a comisión",
        description: sentence,
        normalizedStatusAfter: inferStatusFromEvent("turn_to_commission")
      });
      continue;
    }

    if (normalized.startsWith("prorroga hasta")) {
      pushEvent(events, seen, {
        eventType: "other",
        eventDate: eventDate ?? presentationDate ?? new Date().toISOString(),
        title: "Prórroga legislativa",
        description: sentence,
        normalizedStatusAfter: "in_commissions"
      });
      continue;
    }

    if (normalized.startsWith("retirada")) {
      pushEvent(events, seen, {
        eventType: "withdrawal",
        eventDate: eventDate ?? presentationDate ?? new Date().toISOString(),
        title: "Retiro de iniciativa",
        description: sentence,
        normalizedStatusAfter: inferStatusFromEvent("withdrawal")
      });
      continue;
    }

    if (normalized.includes("dictaminada y aprobada en la camara de diputados")) {
      pushEvent(events, seen, {
        eventType: "approved_origin",
        eventDate: eventDate ?? presentationDate ?? new Date().toISOString(),
        title: "Aprobación en cámara de origen",
        description: sentence,
        normalizedStatusAfter: inferStatusFromEvent("approved_origin")
      });
      continue;
    }

    if (normalized.includes("dictaminada y aprobada en la camara de senadores")) {
      pushEvent(events, seen, {
        eventType: "approved_reviser",
        eventDate: eventDate ?? presentationDate ?? new Date().toISOString(),
        title: "Aprobación en cámara revisora",
        description: sentence,
        normalizedStatusAfter: inferStatusFromEvent("approved_reviser")
      });
      continue;
    }

    if (normalized.startsWith("publicado en el diario oficial de la federacion")) {
      pushEvent(events, seen, {
        eventType: "dof_publication",
        eventDate: eventDate ?? presentationDate ?? new Date().toISOString(),
        title: "Publicación en DOF",
        description: sentence,
        normalizedStatusAfter: inferStatusFromEvent("dof_publication")
      });
    }
  }

  if (mapped.rawStatus) {
    const rawStatusEventType = inferDiputadosEventTypeFromRawStatus(mapped.rawStatus);
    pushEvent(events, seen, {
      eventType: rawStatusEventType,
      eventDate: presentationDate ?? new Date().toISOString(),
      title: inferDiputadosEventTitle(rawStatusEventType),
      description: mapped.rawStatus,
      normalizedStatusAfter: inferStatusFromEvent(rawStatusEventType)
    });
  }

  return events.sort((left, right) => left.eventDate.localeCompare(right.eventDate));
}

function buildDiputadosDerivedState(input: {
  canonicalTitle: string;
  summary: string | null;
  presentedAt: string | null;
  rawStatus: string | null;
  chamber: string | null;
  metadata: Record<string, unknown>;
}): {
  events: Array<{
    eventType: EventType;
    eventDate: string;
    title: string;
    description: string;
    normalizedStatusAfter: InitiativeStatus;
  }>;
  normalizedStatus: InitiativeStatus;
} {
  const events = extractDiputadosEvents({
    canonicalTitle: input.canonicalTitle,
    titleNormalized: "",
    summary: input.summary,
    presentedAt: input.presentedAt,
    rawStatus: input.rawStatus,
    chamber: input.chamber,
    initiativeType: null,
    sourceUrl: "",
    dedupeHash: "",
    authors: [],
    rawHtml: "",
    metadata: input.metadata,
    sourceRecordKey: ""
  });

  const latestKnownStatus = [...events]
    .reverse()
    .find((event) => event.normalizedStatusAfter !== "unknown")
    ?.normalizedStatusAfter;

  return {
    events,
    normalizedStatus: latestKnownStatus ?? (input.presentedAt ? "presented" : "unknown")
  };
}

function pushEvent(
  events: Array<{
    eventType: EventType;
    eventDate: string;
    title: string;
    description: string;
    normalizedStatusAfter: InitiativeStatus;
  }>,
  seen: Set<string>,
  event: {
    eventType: EventType;
    eventDate: string;
    title: string;
    description: string;
    normalizedStatusAfter: InitiativeStatus;
  }
): void {
  const key = `${event.eventType}|${event.eventDate}|${event.title}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  events.push(event);
}

function splitSummarySentences(summary: string): string[] {
  return summary
    .split(/\.\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function extractSpanishLongDate(value: string): string | null {
  const match = value.match(
    /\b(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/i
  ) ?? value.match(/\b(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/i);

  if (!match) {
    return null;
  }

  const months: Record<string, string> = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    setiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12"
  };

  const month = months[normalizeText(match[2])];
  if (!month) {
    return null;
  }

  return `${match[3]}-${month}-${match[1].padStart(2, "0")}T00:00:00.000Z`;
}

function deriveInitiativeStatus(mapped: DiputadosMappedInitiative): InitiativeStatus {
  return buildDiputadosDerivedState(mapped).normalizedStatus;
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

function inferDiputadosEventTypeFromRawStatus(rawStatus: string): EventType {
  const normalized = normalizeText(rawStatus);

  if (normalized.includes("turnada a")) {
    return "turn_to_commission";
  }

  if (normalized.includes("publicado en el diario oficial de la federacion") || normalized.includes("publicado en dof")) {
    return "dof_publication";
  }

  if (normalized.includes("retirada")) {
    return "withdrawal";
  }

  if (normalized.includes("desechad")) {
    return "rejection";
  }

  if (normalized.includes("archivad")) {
    return "archival";
  }

  if (normalized.includes("dictaminada y aprobada en la camara de diputados")) {
    return "approved_origin";
  }

  if (normalized.includes("dictaminada y aprobada en la camara de senadores")) {
    return "approved_reviser";
  }

  return "other";
}

function inferDiputadosEventTitle(eventType: EventType): string {
  switch (eventType) {
    case "turn_to_commission":
      return "Turnado a comisión";
    case "dof_publication":
      return "Publicación en DOF";
    case "withdrawal":
      return "Retiro de iniciativa";
    case "rejection":
      return "Desechamiento";
    case "archival":
      return "Archivo legislativo";
    case "approved_origin":
      return "Aprobación en cámara de origen";
    case "approved_reviser":
      return "Aprobación en cámara revisora";
    default:
      return "Estatus legislativo";
  }
}

async function upsertDiputadosCommissionRelations(
  initiativeId: string,
  chamber: string | null,
  events: Array<{
    eventType: EventType;
    eventDate: string;
    description: string;
  }>
): Promise<void> {
  const chamberEnum = toChamberEnum(chamber);

  for (const event of events) {
    if (event.eventType !== "turn_to_commission") {
      continue;
    }

    const commissionNames = extractCommissionNames(event.description);
    for (const commissionName of commissionNames) {
      const commissionId = await upsertCommission(commissionName, chamberEnum);
      await upsertInitiativeCommissionRelation(initiativeId, commissionId, event.eventDate);
    }
  }
}

async function upsertCommission(name: string, chamber: string | null): Promise<string> {
  const nameNormalized = normalizeText(name);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("commissions")
    .select("id")
    .eq("name_normalized", nameNormalized)
    .eq("chamber", chamber)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to query commissions: ${existingError.message}`);
  }

  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabaseAdmin
    .from("commissions")
    .insert({
      name,
      name_normalized: nameNormalized,
      chamber,
      metadata: {
        source: "gaceta_diputados"
      }
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert commission: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

async function upsertInitiativeCommissionRelation(
  initiativeId: string,
  commissionId: string,
  assignedAt: string
): Promise<void> {
  const { error } = await supabaseAdmin.from("initiative_commissions").upsert(
    {
      initiative_id: initiativeId,
      commission_id: commissionId,
      relation_type: "referred",
      assigned_at: assignedAt
    },
    {
      onConflict: "initiative_id,commission_id,relation_type,assigned_at"
    }
  );

  if (error) {
    throw new Error(`Failed to upsert initiative commission relation: ${error.message}`);
  }
}

function extractCommissionNames(description: string): string[] {
  const normalized = description.replace(/\s+/g, " ").trim();
  const withoutPrefix = normalized.replace(/^Turnada\s+a\s+/i, "");

  if (/^las Comisiones Unidas de /i.test(withoutPrefix)) {
    const names = withoutPrefix
      .replace(/^las Comisiones Unidas de /i, "")
      .split(/\s*,\s*|\s+y\s+de\s+|\s+y\s+/i)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value, index) => (index === 0 ? value : value.replace(/^(la|el|los|las)\s+/i, "")));

    return uniqueStrings(names.map(normalizeCommissionLabel));
  }

  if (/^la Comisión de /i.test(withoutPrefix)) {
    return [normalizeCommissionLabel(withoutPrefix.replace(/^la Comisión de /i, ""))];
  }

  if (/^las Comisiones de /i.test(withoutPrefix)) {
    return uniqueStrings(
      withoutPrefix
        .replace(/^las Comisiones de /i, "")
        .split(/\s*,\s*|\s+y\s+/i)
        .map((value) => normalizeCommissionLabel(value))
        .filter(Boolean)
    );
  }

  return uniqueStrings([normalizeCommissionLabel(withoutPrefix)]);
}

function normalizeCommissionLabel(value: string): string {
  return value
    .replace(/^de\s+/i, "")
    .replace(/^\s*la\s+/i, "")
    .replace(/^\s*el\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function retrySupabaseWrite(
  operation: () => Promise<{ error: { message?: string } | null }>,
  errorPrefix: string,
  attempts = 4
): Promise<void> {
  let lastMessage = "unknown error";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { error } = await operation();

    if (!error) {
      return;
    }

    lastMessage = error.message ?? lastMessage;

    if (!isRetryableSupabaseError(lastMessage) || attempt === attempts) {
      throw new Error(`${errorPrefix}: ${lastMessage}`);
    }

    await sleep(attempt * 500);
  }
}

function isRetryableSupabaseError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("bad gateway") || normalized.includes("502") || normalized.includes("gateway");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteExistingDiputadosEvents(initiativeId: string): Promise<void> {
  const { data, error: queryError } = await supabaseAdmin
    .from("legislative_events")
    .select("id, metadata")
    .eq("initiative_id", initiativeId)
    ;

  if (queryError) {
    throw new Error(`Failed to query existing diputados legislative events: ${queryError.message}`);
  }

  const ids = (data ?? [])
    .filter((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return metadata.source === "gaceta_diputados";
    })
    .map((row) => row.id as string);

  if (ids.length === 0) {
    return;
  }

  const { error } = await supabaseAdmin.from("legislative_events").delete().in("id", ids);

  if (error) {
    throw new Error(`Failed to delete existing diputados legislative events: ${error.message}`);
  }
}

async function updateDiputadosInitiativeDerivedFields(
  initiativeId: string,
  chamber: string | null,
  metadata: Record<string, unknown>,
  normalizedStatus: InitiativeStatus,
  events: Array<{ eventDate: string }>
): Promise<void> {
  const lastMajorEventAt = events.length > 0 ? events[events.length - 1]?.eventDate ?? null : null;

  const { error } = await supabaseAdmin
    .from("initiatives")
    .update({
      originating_chamber: toChamberEnum(chamber),
      current_chamber: toChamberEnum(chamber),
      normalized_status: normalizedStatus,
      last_major_event_at: lastMajorEventAt,
      metadata
    })
    .eq("id", initiativeId);

  if (error) {
    throw new Error(`Failed to update diputados initiative derived fields: ${error.message}`);
  }
}

async function findAnySourceRecordIdForInitiative(initiativeId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("initiative_source_links")
    .select("source_record_id")
    .eq("initiative_id", initiativeId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query diputados initiative source links: ${error.message}`);
  }

  return data?.source_record_id ?? null;
}
