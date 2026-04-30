import { sha256 } from "../../core/hashing.js";
import { normalizeText } from "../../core/normalization.js";
import type { SilParsedInitiative, SilParsedInitiativeDetail } from "./types.js";

export function mergeSilInitiativeWithDetail(
  base: SilParsedInitiative,
  detail: SilParsedInitiativeDetail | null
): SilParsedInitiative {
  if (!detail) {
    return base;
  }

  const title = detail.title && isBetterTitle(detail.title, base.title) ? detail.title : base.title;
  const titleNormalized = detail.titleNormalized || normalizeText(title);
  const presentationDate = detail.presentationDate ?? base.presentationDate;

  return {
    ...base,
    sourceUrl: detail.sourceUrl || base.sourceUrl,
    title,
    titleNormalized,
    authors: detail.authors && detail.authors.length > 0 ? detail.authors : base.authors,
    presentationDate,
    statusRaw: detail.statusRaw ?? base.statusRaw,
    chamber: detail.chamber ?? base.chamber,
    initiativeType: detail.initiativeType ?? base.initiativeType,
    description: isBetterDescription(detail.description, base.description) ? detail.description ?? null : base.description,
    // Keep the identity discovered from the SIL results row stable.
    // Detail pages enrich the same initiative and should never create a new canonical key.
    dedupeHash: base.dedupeHash,
    rawHtml: detail.rawHtml || base.rawHtml,
    metadata: {
      ...base.metadata,
      ...(detail.metadata ?? {}),
      topic: getPreferredString(detail.metadata, "topic") ?? getPreferredString(base.metadata, "topic"),
      referred_to:
        getPreferredString(detail.metadata, "referred_to") ?? getPreferredString(base.metadata, "referred_to"),
      result_source_url: base.sourceUrl,
      detail_source_url: detail.sourceUrl
    },
    sourceRecordKey: base.sourceRecordKey
  };
}

function isBetterTitle(candidate: string | null | undefined, current: string): boolean {
  if (!candidate) {
    return false;
  }

  const normalizedCandidate = candidate.trim();
  if (!normalizedCandidate) {
    return false;
  }

  return normalizedCandidate.length >= current.trim().length;
}

function isBetterDescription(candidate: string | null | undefined, current: string | null): boolean {
  if (!candidate?.trim()) {
    return false;
  }

  if (!current?.trim()) {
    return true;
  }

  return candidate.trim().length > current.trim().length;
}

function getPreferredString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}
