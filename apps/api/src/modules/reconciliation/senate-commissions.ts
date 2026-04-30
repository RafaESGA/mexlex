import { normalizeText } from "../../ingestion/core/normalization.js";

export function extractSenateCommissionNames(rawValue: string): string[] {
  const cleaned = rawValue
    .replace(/&lt;br\s*\/?&gt;/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

  if (!cleaned) {
    return [];
  }

  if (cleaned.includes("\n") || /\((?:Coordinadora|Comisiones Unidas)\)/i.test(cleaned)) {
    return uniqueStrings(
      cleaned
        .split("\n")
        .map((value) =>
          value
            .replace(/\((?:Coordinadora|Comisiones Unidas)\)/gi, "")
            .replace(/\.$/, "")
            .trim()
        )
        .filter(Boolean)
        .map(normalizeSenateCommissionLabel)
    );
  }

  const withoutChamberReference = cleaned
    .replace(/^c[áa]mara de diputados\.?$/i, "")
    .replace(/^c[áa]mara de senadores\.?$/i, "")
    .trim();

  if (!withoutChamberReference) {
    return [];
  }

  if (/^comisiones unidas de /i.test(withoutChamberReference)) {
    return parseUnitedCommissions(withoutChamberReference);
  }

  return uniqueStrings(
    withoutChamberReference
      .split(/\s*;\s*/g)
      .map((value) => normalizeSenateCommissionLabel(value))
      .filter(Boolean)
  );
}

export function normalizeSenateCommissionLabel(value: string): string {
  return value
    .replace(/^comisiones unidas de /i, "")
    .replace(/^comisi[oó]n de /i, "")
    .replace(/^comisiones de /i, "")
    .replace(/^y de /i, "")
    .replace(/^y /i, "")
    .replace(/^de /i, "")
    .replace(/^\s*la\s+/i, "")
    .replace(/^\s*el\s+/i, "")
    .replace(/\((?:Coordinadora|Comisiones Unidas)\)/gi, "")
    .replace(/\.$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseUnitedCommissions(value: string): string[] {
  const base = value.replace(/^comisiones unidas de /i, "").replace(/\.$/, "").trim();
  const semicolonSegments = base.split(/\s*;\s*/g).filter(Boolean);
  const expanded: string[] = [];

  for (const segment of semicolonSegments) {
    for (const part of splitUnitedCommissionSegment(segment)) {
      const normalized = normalizeSenateCommissionLabel(part);
      if (normalized) {
        expanded.push(normalized);
      }
    }
  }

  return uniqueStrings(expanded);
}

function splitUnitedCommissionSegment(segment: string): string[] {
  const prepared = segment
    .replace(/,\s*Para la Igualdad de G[ée]nero\b/gi, "|Para la Igualdad de Género")
    .replace(/\s+y\s+de\s+(Estudios Legislativos(?:,\s*(?:Primera|Segunda))?)/gi, "|$1")
    .replace(/\s+y\s+de\s+/gi, "|")
    .replace(/^\s*de\s+/i, "")
    .trim();

  return prepared
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(value);
  }

  return result;
}
