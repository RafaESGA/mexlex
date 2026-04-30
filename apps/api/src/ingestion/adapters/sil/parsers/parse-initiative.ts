import * as cheerio from "cheerio";
import { sha256 } from "../../../core/hashing.js";
import { normalizeText } from "../../../core/normalization.js";
import type { SilParsedAuthor, SilParsedInitiative, SilHtmlPage } from "../types.js";

const FIELD_LABELS = {
  title: [/titulo/i, /asunto/i, /iniciativa/i],
  authors: [/autor/i, /promovente/i, /presentada por/i],
  presentationDate: [/fecha/i, /presentacion/i],
  status: [/estatus/i, /situacion/i, /estado/i, /tramite/i],
  chamber: [/camara/i, /camara de origen/i, /origen/i],
  initiativeType: [/tipo/i, /clase/i, /naturaleza/i],
  description: [/descripcion/i, /sinopsis/i, /resumen/i, /objeto/i]
} as const;

export function parseSilInitiative(page: SilHtmlPage): SilParsedInitiative | null {
  const $ = cheerio.load(page.html);
  // SIL pages are not assumed to expose stable APIs, so we mine common
  // "label -> value" HTML structures first and only then fall back to headers/meta tags.
  const fieldMap = extractFieldMap($);

  const title = firstNonEmpty(
    fieldMap.title,
    $("h1").first().text(),
    $(".titulo, .title").first().text()
  );

  if (!title) {
    return null;
  }

  const presentationDate = normalizeDate(firstNonEmpty(fieldMap.presentationDate));
  const titleNormalized = normalizeText(title);
  const dedupeHash = sha256(`${titleNormalized}|${presentationDate ?? "no-date"}`);
  const authors = parseAuthors(firstNonEmpty(fieldMap.authors));
  const statusRaw = firstNonEmpty(fieldMap.status);
  const chamber = firstNonEmpty(fieldMap.chamber);
  const initiativeType = firstNonEmpty(fieldMap.initiativeType);
  const description = firstNonEmpty(
    fieldMap.description,
    $('meta[name="description"]').attr("content"),
    $(".resumen, .descripcion, .sinopsis").first().text()
  );

  return {
    sourceUrl: page.url,
    sourceRecordKey: dedupeHash,
    title,
    titleNormalized,
    authors,
    presentationDate,
    statusRaw: statusRaw || null,
    chamber: chamber || null,
    initiativeType: initiativeType || null,
    description: description || null,
    dedupeHash,
    rawHtml: page.html,
    metadata: {
      parser: "sil-html-heuristic-v1",
      parentUrl: page.parentUrl ?? null
    }
  };
}

function extractFieldMap($: cheerio.CheerioAPI): Record<string, string[]> {
  const fieldMap: Record<string, string[]> = {};

  // Most legislative detail pages expose metadata in either tabular rows or definition lists.
  $("table tr").each((_, row) => {
    const cells = $(row).find("th,td");
    if (cells.length < 2) {
      return;
    }

    const label = normalizeText($(cells[0]).text());
    const value = $(cells[1]).text().replace(/\s+/g, " ").trim();

    const key = resolveFieldKey(label);
    if (!key || !value) {
      return;
    }

    fieldMap[key] ??= [];
    fieldMap[key].push(value);
  });

  $("dt").each((_, element) => {
    const label = normalizeText($(element).text());
    const key = resolveFieldKey(label);
    const value = $(element).next("dd").text().replace(/\s+/g, " ").trim();

    if (!key || !value) {
      return;
    }

    fieldMap[key] ??= [];
    fieldMap[key].push(value);
  });

  return fieldMap;
}

function resolveFieldKey(label: string): string | null {
  for (const [key, patterns] of Object.entries(FIELD_LABELS)) {
    if (patterns.some((pattern) => pattern.test(label))) {
      return key;
    }
  }

  return null;
}

function parseAuthors(rawValue?: string): SilParsedAuthor[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(/;|\n|, y | y /i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((fullName) => ({
      fullName,
      role: "primary"
    }));
}

function normalizeDate(value?: string): string | null {
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const slashMatch = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, "0");
    const month = slashMatch[2].padStart(2, "0");
    return `${slashMatch[3]}-${month}-${day}`;
  }

  return null;
}

function firstNonEmpty(...values: Array<string | string[] | undefined>): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const joined = value.map((item) => item.trim()).filter(Boolean).join(" ");
      if (joined) {
        return joined;
      }
      continue;
    }

    const normalized = value?.replace(/\s+/g, " ").trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}
