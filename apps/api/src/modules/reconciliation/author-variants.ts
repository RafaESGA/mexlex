import { normalizeText } from "../../ingestion/core/normalization.js";

export type AuthorVariantInput = {
  id: string;
  fullName: string;
  nameNormalized: string;
  chamber: string | null;
  initiativeCount: number;
};

export type AuthorVariantSuggestion = {
  looseKey: string;
  chamber: string | null;
  confidence: number;
  canonicalAuthorId: string;
  canonicalFullName: string;
  aliases: Array<{
    authorId: string;
    fullName: string;
    initiativeCount: number;
  }>;
};

export function buildAuthorVariantSuggestions(authors: AuthorVariantInput[]): AuthorVariantSuggestion[] {
  const groups = groupBy(authors, (row) => `${buildLooseAuthorKey(row.fullName)}|${row.chamber ?? "no-chamber"}`);

  return [...groups.entries()]
    .map(([groupKey, rows]) => {
      const [looseKey = "", chamberKey = "no-chamber"] = groupKey.split("|");
      const aliases = [...rows].sort(compareAuthorsForCanonical);

      return {
        looseKey,
        chamber: chamberKey === "no-chamber" ? null : chamberKey,
        aliases
      };
    })
    .filter(({ aliases }) => {
      const distinctDisplay = new Set(aliases.map((row) => row.fullName));
      const distinctNormalized = new Set(aliases.map((row) => row.nameNormalized));
      return aliases.length > 1 && (distinctDisplay.size > 1 || distinctNormalized.size > 1);
    })
    .map(({ looseKey, chamber, aliases }) => ({
      looseKey,
      chamber,
      confidence: computeClusterConfidence(aliases),
      canonicalAuthorId: aliases[0]?.id ?? "",
      canonicalFullName: aliases[0]?.fullName ?? "",
      aliases: aliases.map((row) => ({
        authorId: row.id,
        fullName: row.fullName,
        initiativeCount: row.initiativeCount
      }))
    }))
    .sort((left, right) => {
      if (left.confidence !== right.confidence) {
        return right.confidence - left.confidence;
      }

      return right.aliases.length - left.aliases.length;
    });
}

function compareAuthorsForCanonical(left: AuthorVariantInput, right: AuthorVariantInput): number {
  const leftScore = displayNameQuality(left.fullName);
  const rightScore = displayNameQuality(right.fullName);
  const qualityDelta = rightScore - leftScore;

  if (Math.abs(qualityDelta) >= 3) {
    return qualityDelta;
  }

  if (left.initiativeCount !== right.initiativeCount) {
    return right.initiativeCount - left.initiativeCount;
  }

  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  return left.fullName.localeCompare(right.fullName, "es");
}

function displayNameQuality(fullName: string): number {
  const trimmed = fullName.trim();
  const normalized = normalizeText(trimmed);
  const hasLeadingHonorific =
    /^(?:el|la|los|las)\s+(?:sen|sen\.|senador|senadora|dip|dip\.|diputado|diputada)\b/i.test(trimmed) ||
    /^(?:sen|sen\.|senador|senadora|dip|dip\.|diputado|diputada)\b/i.test(trimmed);

  let score = 0;

  if (!hasLeadingHonorific) {
    score += 4;
  } else {
    score -= 4;
  }

  if (!/[,:]$/.test(trimmed)) {
    score += 1;
  }

  if (!/\b(del|de la|de los|de las)\s*$/i.test(trimmed)) {
    score += 1;
  }

  if (/^[A-ZÁÉÍÓÚÑ][\p{L}\s.'-]+$/u.test(trimmed)) {
    score += 1;
  }

  score -= Math.max(0, normalized.split(" ").length - 4);

  return score;
}

function computeClusterConfidence(aliases: AuthorVariantInput[]): number {
  if (aliases.length <= 1) {
    return 1;
  }

  const totalRelations = aliases.reduce((sum, row) => sum + Math.max(row.initiativeCount, 1), 0);
  const canonicalRelations = Math.max(aliases[0]?.initiativeCount ?? 0, 1);
  const relationShare = canonicalRelations / totalRelations;
  const qualityDelta = Math.max(0, displayNameQuality(aliases[0]?.fullName ?? "") - displayNameQuality(aliases[1]?.fullName ?? ""));

  return Number(Math.min(0.99, 0.45 + relationShare * 0.4 + Math.min(qualityDelta, 4) * 0.03).toFixed(2));
}

function buildLooseAuthorKey(fullName: string): string {
  return normalizeText(fullName)
    .replace(/\b(sen|senadora|senador|dip|diputada|diputado)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(del|de|la|las|los)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function groupBy<T>(values: T[], getKey: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const value of values) {
    const key = getKey(value);
    const current = grouped.get(key);
    if (current) {
      current.push(value);
      continue;
    }

    grouped.set(key, [value]);
  }

  return grouped;
}
