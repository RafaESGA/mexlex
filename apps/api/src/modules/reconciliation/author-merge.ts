import { normalizeText } from "../../ingestion/core/normalization.js";
import type { AuthorVariantSuggestion } from "./author-variants.js";

export type AuthorMergePlan = {
  canonicalAuthorId: string;
  canonicalFullName: string;
  confidence: number;
  aliasAuthorIds: string[];
  aliasNames: string[];
  canonicalKey: string;
};

const partySuffixPattern =
  /(?:,|\s)+(morena|pvem|pan|pri|pt|mc|prd|pes|verde|movimiento ciudadano|partido verde ecologista de mexico)$/i;

const leadingHonorificPattern =
  /^(?:el|la|los|las)\s+|^(?:sen|sen\.|senador|senadora|dip|dip\.|diputado|diputada)\s+/i;

const unsafeAuthorPattern =
  /\b(grupo parlamentario|integrantes|legisladoras?|senadoras?|diputadas?|legisladores|proponentes?)\b/i;

export function buildSafeAuthorMergePlans(
  suggestions: AuthorVariantSuggestion[],
  options?: {
    minConfidence?: number;
  }
): AuthorMergePlan[] {
  const minConfidence = options?.minConfidence ?? 0.9;

  return suggestions
    .filter((suggestion) => suggestion.confidence >= minConfidence)
    .map(toSafeMergePlan)
    .filter((plan): plan is AuthorMergePlan => plan !== null);
}

export function toSafeMergePlan(suggestion: AuthorVariantSuggestion): AuthorMergePlan | null {
  if (suggestion.aliases.length < 2) {
    return null;
  }

  const canonicalKey = toAuthorMergeKey(suggestion.canonicalFullName);
  if (!canonicalKey) {
    return null;
  }

  const aliases = suggestion.aliases.filter((alias) => alias.authorId !== suggestion.canonicalAuthorId);
  if (aliases.length === 0) {
    return null;
  }

  const aliasKeys = aliases.map((alias) => toAuthorMergeKey(alias.fullName));
  if (aliasKeys.some((key) => !key || key !== canonicalKey)) {
    return null;
  }

  return {
    canonicalAuthorId: suggestion.canonicalAuthorId,
    canonicalFullName: suggestion.canonicalFullName,
    confidence: suggestion.confidence,
    aliasAuthorIds: aliases.map((alias) => alias.authorId),
    aliasNames: aliases.map((alias) => alias.fullName),
    canonicalKey
  };
}

export function toAuthorMergeKey(fullName: string): string | null {
  const stripped = stripLeadingHonorifics(fullName)
    .replace(/\s*,?\s*(del|de la|de los|de las)\s*$/i, "")
    .replace(partySuffixPattern, "")
    .replace(/[.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^y\s+/i.test(stripped)) {
    return null;
  }

  const normalized = normalizeText(stripped);
  if (!normalized) {
    return null;
  }

  if (unsafeAuthorPattern.test(normalized)) {
    return null;
  }

  if (/\s+y\s+/i.test(stripped)) {
    return null;
  }

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 6) {
    return null;
  }

  return parts.join(" ");
}

function stripLeadingHonorifics(value: string): string {
  let current = value.trim();

  for (let index = 0; index < 3; index += 1) {
    const next = current.replace(leadingHonorificPattern, "").trim();
    if (next === current) {
      break;
    }

    current = next;
  }

  return current;
}
