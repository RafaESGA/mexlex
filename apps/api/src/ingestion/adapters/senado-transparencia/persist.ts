import { supabaseAdmin } from "../../../db/supabase.js";
import { inferStatusFromEvent } from "../../../modules/normalization/status-taxonomy.js";
import { rebalanceInitiativePrimarySourceLinks } from "../../../modules/reconciliation/source-links.js";
import { normalizeText } from "../../core/normalization.js";
import { sha256 } from "../../core/hashing.js";
import type { SenadoMappedInitiative } from "../senado-gaceta/types.js";
import type { EventType, InitiativeStatus } from "@mexlex/shared/taxonomy/legislative";

export async function persistSenadoTransparenciaInitiative(
  mapped: SenadoMappedInitiative
): Promise<{ inserted: boolean; initiativeId: string }> {
  const source = await getSource();
  let existing: { id: string } | null = null;

  try {
    existing = await findExistingInitiative(mapped);
  } catch {
    existing = null;
  }

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

async function getSource(): Promise<{ id: string }> {
  const { data, error } = await retrySupabaseOperation(
    async () => supabaseAdmin.from("sources").select("id").eq("system", "senado_transparencia").maybeSingle(),
    "Failed to query Senado Transparencia source"
  );

  if (error || !data) {
    throw new Error(`Unable to resolve Senado Transparencia source: ${error?.message ?? "not found"}`);
  }

  return data;
}

async function findExistingInitiative(mapped: SenadoMappedInitiative): Promise<{ id: string } | null> {
  const sourceRecordKey = mapped.sourceRecordKey;

  const { data, error } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin
        .from("initiatives")
        .select("id, metadata")
        .eq("title_normalized", mapped.titleNormalized)
        .limit(25),
    "Failed to query Senado Transparencia initiatives for dedupe"
  );

  if (error) {
    throw new Error(`Failed to query Senado Transparencia initiatives for dedupe: ${formatSupabaseError(error)}`);
  }

  const exact = (data ?? []).find((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return (
      metadata.senado_dedupe_hash === mapped.dedupeHash ||
      metadata.source_record_key === sourceRecordKey ||
      metadata.source_document_url === mapped.sourceUrl
    );
  });

  return exact ? { id: exact.id as string } : null;
}

async function insertInitiative(mapped: SenadoMappedInitiative): Promise<string> {
  const chamber = toChamberEnum(mapped.chamber);
  const derivedStatus = deriveInitiativeStatus(mapped);
  const { data, error } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin
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
            senado_dedupe_hash: mapped.dedupeHash,
            source_url: mapped.sourceUrl,
            source_record_key: mapped.sourceRecordKey,
            source_document_url: mapped.sourceUrl,
            initiative_type: mapped.initiativeType
          }
        })
        .select("id")
        .single(),
    "Failed to insert Senado Transparencia initiative"
  );

  if (error || !data) {
    throw new Error(
      `Failed to insert Senado Transparencia initiative: ${error ? formatSupabaseError(error) : "unknown error"}`
    );
  }

  return data.id;
}

async function updateInitiative(initiativeId: string, mapped: SenadoMappedInitiative): Promise<void> {
  const chamber = toChamberEnum(mapped.chamber);
  const derivedStatus = deriveInitiativeStatus(mapped);
  const { error } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin
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
            senado_dedupe_hash: mapped.dedupeHash,
            source_url: mapped.sourceUrl,
            source_record_key: mapped.sourceRecordKey,
            source_document_url: mapped.sourceUrl,
            initiative_type: mapped.initiativeType
          }
        })
        .eq("id", initiativeId),
    "Failed to update Senado Transparencia initiative"
  );

  if (error) {
    throw new Error(`Failed to update Senado Transparencia initiative: ${formatSupabaseError(error)}`);
  }
}

async function upsertSourceRecord(sourceId: string, mapped: SenadoMappedInitiative): Promise<string> {
  const contentHash = sha256(mapped.rawHtml);
  const { data: existing, error: existingError } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin
        .from("source_records")
        .select("id")
        .eq("source_id", sourceId)
        .eq("record_type", "initiative_json")
        .eq("source_record_key", mapped.sourceRecordKey)
        .eq("content_hash", contentHash)
        .maybeSingle(),
    "Failed to query Senado Transparencia source_records"
  );

  if (existingError) {
    throw new Error(`Failed to query Senado Transparencia source_records: ${formatSupabaseError(existingError)}`);
  }

  if (existing) {
    return existing.id;
  }

  const { data, error } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin
        .from("source_records")
        .insert({
          source_id: sourceId,
          record_type: "initiative_json",
          source_record_key: mapped.sourceRecordKey,
          source_url: mapped.sourceUrl,
          content_hash: contentHash,
          raw_payload: {
            content_type: "application/json"
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
        .single(),
    "Failed to insert Senado Transparencia source_record"
  );

  if (error || !data) {
    throw new Error(
      `Failed to insert Senado Transparencia source_record: ${error ? formatSupabaseError(error) : "unknown error"}`
    );
  }

  return data.id;
}

async function linkInitiativeToSource(
  initiativeId: string,
  sourceRecordId: string,
  mapped: SenadoMappedInitiative
): Promise<void> {
  const { error } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin.from("initiative_source_links").upsert(
        {
          initiative_id: initiativeId,
          source_record_id: sourceRecordId,
          source_native_id: mapped.sourceRecordKey,
          source_title: mapped.canonicalTitle,
          source_status: mapped.rawStatus,
          confidence: 0.95,
          is_primary: false
        },
        {
          onConflict: "initiative_id,source_record_id"
        }
      ),
    "Failed to link Senado Transparencia initiative to source"
  );

  if (error) {
    throw new Error(`Failed to link Senado Transparencia initiative to source: ${formatSupabaseError(error)}`);
  }

  await rebalanceInitiativePrimarySourceLinks(initiativeId);
}

async function upsertAuthors(initiativeId: string, mapped: SenadoMappedInitiative): Promise<void> {
  await deleteExistingInitiativeAuthors(initiativeId);

  const expandedAuthors = expandSenadoAuthors(mapped.authors);

  for (const [index, author] of expandedAuthors.entries()) {
    const nameNormalized = normalizeText(author.fullName);
    const existingAuthor = await findAuthorByNormalizedName(nameNormalized);
    const authorId = existingAuthor?.id ?? (await insertAuthor(author.fullName, nameNormalized, mapped.chamber));

    const { error } = await supabaseAdmin.from("initiative_authors").upsert(
      {
        initiative_id: initiativeId,
        author_id: authorId,
        role: author.role,
        sort_order: index + 1
      },
      {
        onConflict: "initiative_id,author_id,role"
      }
    );

    if (error) {
      throw new Error(
        `Failed to upsert Senado Transparencia initiative author relation: ${formatSupabaseError(error)}`
      );
    }
  }
}

async function deleteExistingInitiativeAuthors(initiativeId: string): Promise<void> {
  const { error } = await retrySupabaseOperation(
    async () => supabaseAdmin.from("initiative_authors").delete().eq("initiative_id", initiativeId),
    "Failed to delete existing Senado Transparencia initiative authors"
  );

  if (error) {
    throw new Error(
      `Failed to delete existing Senado Transparencia initiative authors: ${formatSupabaseError(error)}`
    );
  }
}

async function findAuthorByNormalizedName(nameNormalized: string): Promise<{ id: string } | null> {
  const { data, error } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin
        .from("authors")
        .select("id")
        .eq("name_normalized", nameNormalized)
        .limit(1)
        .maybeSingle(),
    "Failed to query Senado Transparencia authors"
  );

  if (error) {
    throw new Error(`Failed to query authors: ${formatSupabaseError(error)}`);
  }

  return data;
}

async function insertAuthor(fullName: string, nameNormalized: string, chamber: string | null): Promise<string> {
  const { data, error } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin
        .from("authors")
        .insert({
          full_name: fullName,
          name_normalized: nameNormalized,
          chamber: toChamberEnum(chamber),
          profile_data: {}
        })
        .select("id")
        .single(),
    "Failed to insert Senado Transparencia author"
  );

  if (error || !data) {
    throw new Error(`Failed to insert author: ${error ? formatSupabaseError(error) : "unknown error"}`);
  }

  return data.id;
}

async function upsertLegislativeEvents(
  initiativeId: string,
  sourceRecordId: string,
  mapped: SenadoMappedInitiative
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
        source: "senado_transparencia",
        initiative_type: mapped.initiativeType
      }
    });

    await linkEventToSource(presentationEventId, sourceRecordId);
  }

  if (mapped.rawStatus) {
    const eventType = inferEventTypeFromRawStatus(mapped.rawStatus);
    const eventId = await upsertLegislativeEvent({
      initiativeId,
      eventType,
      eventDate: presentationEventDate ?? new Date().toISOString(),
      chamber: mapped.chamber,
      title: eventType === "turn_to_commission" ? "Turnado a comisión" : "Estatus legislativo",
      description: mapped.rawStatus,
      normalizedStatusAfter: inferStatusFromEvent(eventType),
      metadata: {
        source: "senado_transparencia"
      }
    });

    await linkEventToSource(eventId, sourceRecordId);
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
  const eventHash = sha256([input.initiativeId, input.eventType, input.eventDate, input.title].join("|"));
  const { data: existing, error: existingError } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin
        .from("legislative_events")
        .select("id")
        .eq("initiative_id", input.initiativeId)
        .eq("event_type", input.eventType)
        .eq("event_date", input.eventDate)
        .eq("title", input.title)
        .maybeSingle(),
    "Failed to query Senado Transparencia legislative_events"
  );

  if (existingError) {
    throw new Error(
      `Failed to query Senado Transparencia legislative_events: ${formatSupabaseError(existingError)}`
    );
  }

  if (existing) {
    const { error: updateError } = await retrySupabaseOperation(
      async () =>
        supabaseAdmin
          .from("legislative_events")
          .update({
            chamber: toChamberEnum(input.chamber),
            description: input.description,
            normalized_status_after: input.normalizedStatusAfter,
            event_hash: eventHash,
            metadata: input.metadata
          })
          .eq("id", existing.id),
      "Failed to update Senado Transparencia legislative event"
    );

    if (updateError) {
      throw new Error(
        `Failed to update Senado Transparencia legislative event: ${formatSupabaseError(updateError)}`
      );
    }

    return existing.id;
  }

  const { data, error } = await retrySupabaseOperation(
    async () =>
      supabaseAdmin
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
        .single(),
    "Failed to insert Senado Transparencia legislative event"
  );

  if (error || !data) {
    throw new Error(
      `Failed to insert Senado Transparencia legislative event: ${error ? formatSupabaseError(error) : "unknown error"}`
    );
  }

  return data.id;
}

async function linkEventToSource(legislativeEventId: string, sourceRecordId: string): Promise<void> {
  const { error } = await retrySupabaseOperation(
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
    "Failed to link Senado Transparencia event to source"
  );

  if (error) {
    throw new Error(`Failed to link Senado Transparencia event to source: ${formatSupabaseError(error)}`);
  }
}

function deriveInitiativeStatus(mapped: SenadoMappedInitiative): InitiativeStatus {
  if (mapped.rawStatus) {
    return inferStatusFromEvent(inferEventTypeFromRawStatus(mapped.rawStatus));
  }

  return mapped.presentedAt ? "presented" : "unknown";
}

function inferEventTypeFromRawStatus(rawStatus: string): EventType {
  const normalized = normalizeText(rawStatus);

  if (normalized.includes("publicad") && normalized.includes("diario oficial")) {
    return "dof_publication";
  }

  if (normalized.includes("aprob")) {
    return "approved_origin";
  }

  if (normalized.includes("se turno") || normalized.includes("turnado") || normalized.includes("comision")) {
    return "turn_to_commission";
  }

  if (normalized.includes("retirad")) {
    return "withdrawal";
  }

  return "other";
}

function toChamberEnum(chamber: string | null): "diputados" | "senado" | null {
  if (!chamber) {
    return null;
  }

  const normalized = normalizeText(chamber);
  if (normalized.includes("senador")) {
    return "senado";
  }

  if (normalized.includes("diputad")) {
    return "diputados";
  }

  return null;
}

async function retrySupabaseOperation<T extends { error: { message?: string } | null }>(
  operation: () => Promise<T>,
  errorPrefix: string,
  attempts = 4
): Promise<T> {
  let lastError: unknown = null;
  let lastResult: T | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      lastResult = result;

      if (!result.error) {
        return result;
      }

      const message = result.error.message ?? "unknown error";
      if (!isRetryableSupabaseError(message) || attempt === attempts) {
        return result;
      }

      await sleep(attempt * 500);
    } catch (error) {
      lastError = error;
      const message = formatUnknownError(error);
      if (!isRetryableSupabaseError(message) || attempt === attempts) {
        throw new Error(`${errorPrefix}: ${message}`);
      }

      await sleep(attempt * 500);
    }
  }

  if (lastResult) {
    return lastResult;
  }

  throw new Error(`${errorPrefix}: ${formatUnknownError(lastError)}`);
}

function isRetryableSupabaseError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("bad gateway") ||
    normalized.includes("gateway") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("timeout") ||
    normalized.includes("network")
  );
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.toString();
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function formatSupabaseError(error: { message?: string } | null | undefined): string {
  if (!error) {
    return "unknown error";
  }

  if (error.message && error.message.trim()) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function expandSenadoAuthors(
  authors: Array<{ fullName: string; role: string }>
): Array<{ fullName: string; role: string }> {
  const expanded = authors
    .flatMap((author) =>
      splitSenadoAuthorCandidates(author.fullName).map((fullName) => ({
        fullName,
        role: author.role
      }))
    )
    .map((author) => ({
      ...author,
      fullName: normalizeSenadoAuthorName(author.fullName)
    }))
    .filter((author) => author.fullName)
    .filter((author) => !isGroupAuthor(author.fullName));

  const seen = new Set<string>();
  return expanded.filter((author) => {
    const key = `${normalizeText(author.fullName)}|${author.role}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function splitSenadoAuthorCandidates(value: string): string[] {
  const cleaned = value
    .replace(/\s*,?\s*del Grupo Parlamentario.*$/i, "")
    .replace(/\s*,?\s*el Grupo Parlamentario.*$/i, "")
    .replace(/^senadoras y de los senadores\s+/i, "")
    .replace(/^senadoras y los senadores\s+/i, "")
    .replace(/^senadoras y senadores\s+/i, "")
    .replace(/^senadoras y senadores\s*:\s*/i, "")
    .replace(/^las senadoras y de los senadores\s+/i, "")
    .replace(/^las senadoras y los senadores\s+/i, "")
    .replace(/^las senadoras y senadores\s+/i, "")
    .replace(/^del\s+/i, "")
    .replace(/^de la\s+/i, "")
    .replace(/^de los\s+/i, "")
    .replace(/^de las\s+/i, "")
    .replace(/\s+y\s+de\s+las?\s+senador(?:a|as|es)\s+/gi, ", ")
    .replace(/\s+y\s+del\s+senador\s+/gi, ", ")
    .replace(/\s+y\s+de\s+los\s+senadores\s+/gi, ", ")
    .replace(/\s*,\s*y\s+/gi, ", ")
    .replace(/\s+y\s+/gi, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(/\s*,\s*/)
    .map((part) => normalizeSenadoAuthorName(part))
    .filter(Boolean)
    .filter((part) => !isGroupAuthor(part));
}

function normalizeSenadoAuthorName(value: string): string {
  return value
    .replace(/^sen\.\s*/i, "")
    .replace(/^senador(?:a)?\s+/i, "")
    .replace(/^dip\.\s*/i, "")
    .replace(/^diputad[oa]\s+/i, "")
    .replace(/^senadores\s+/i, "")
    .replace(/^senadoras\s+/i, "")
    .replace(/^senadoras y de los senadores\s+/i, "")
    .replace(/^senadoras y los senadores\s+/i, "")
    .replace(/^senadoras y senadores\s+/i, "")
    .replace(/^las senadoras y de los senadores\s+/i, "")
    .replace(/^las senadoras y los senadores\s+/i, "")
    .replace(/^las senadoras y los senadores del grupo parlamentario.*$/i, "")
    .replace(/^las senadoras\s+/i, "")
    .replace(/^los senadores\s+/i, "")
    .replace(/^la senadora\s+/i, "")
    .replace(/^el senador\s+/i, "")
    .replace(/^de la\s+/i, "")
    .replace(/^del\s+/i, "")
    .replace(/\s*,?\s*del Grupo Parlamentario.*$/i, "")
    .replace(/\s*,?\s*el Grupo Parlamentario.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGroupAuthor(value: string): boolean {
  return (
    /^grupo parlamentario/i.test(value) ||
    /\bgrupo parlamentario\b/i.test(value) ||
    /^(senadoras|senadores)$/i.test(value)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
