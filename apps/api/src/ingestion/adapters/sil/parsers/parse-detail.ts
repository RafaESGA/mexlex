import * as cheerio from "cheerio";
import { normalizeText } from "../../../core/normalization.js";
import type { SilHtmlPage, SilParsedAuthor, SilParsedInitiativeDetail } from "../types.js";

const FIELD_LABELS = {
  title: [/titulo/i, /asunto/i, /iniciativa/i],
  authors: [/autor/i, /promovente/i, /presentada por/i],
  presentationDate: [/fecha/i, /presentacion/i],
  status: [/estatus/i, /situacion/i, /estado/i, /tramite/i],
  chamber: [/camara/i, /camara de origen/i, /origen/i],
  initiativeType: [/tipo/i, /clase/i, /naturaleza/i],
  description: [/descripcion/i, /sinopsis/i, /resumen/i, /objeto/i, /contenido/i],
  topic: [/materia/i, /tema/i, /topico/i],
  referredTo: [/turnad/i, /comision/i, /dictamen/i]
} as const;

export function parseSilDetailPage(page: SilHtmlPage): SilParsedInitiativeDetail | null {
  const $ = cheerio.load(page.html);
  const fieldMap = extractFieldMap($);

  const rawTitle = firstNonEmpty(
    fieldMap.title,
    $("h1").first().text(),
    $(".titulo, .title, .encabezado, b").first().text(),
    extractPopupTitle($),
    $("title").text()
  );
  const title = sanitizeSilDetailTitle(rawTitle);

  const description = firstNonEmpty(
    fieldMap.description,
    $("#Objeto, .objeto, .descripcion, .sinopsis").text(),
    $('meta[name="description"]').attr("content"),
    extractLongestContentBlock($)
  );

  if (!title && !description) {
    return null;
  }

  const authors = parseAuthors(firstNonEmpty(fieldMap.authors));
  const chamber = firstNonEmpty(fieldMap.chamber);
  const initiativeType = firstNonEmpty(fieldMap.initiativeType);
  const statusRaw = firstNonEmpty(fieldMap.status);
  const presentationDate = normalizeDate(firstNonEmpty(fieldMap.presentationDate));
  const topic = firstNonEmpty(fieldMap.topic);
  const referredTo = firstNonEmpty(fieldMap.referredTo);

  return {
    sourceUrl: page.url,
    title: title || null,
    titleNormalized: title ? normalizeText(title) : null,
    authors,
    presentationDate,
    statusRaw: statusRaw || null,
    chamber: chamber || null,
    initiativeType: initiativeType || null,
    description: description || null,
    metadata: {
      parser: "sil-detail-html-v1",
      parentUrl: page.parentUrl ?? null,
      extracted_title: title || null,
      extracted_title_raw: rawTitle || null,
      extracted_description_length: description?.length ?? 0,
      topic: topic || null,
      referred_to: referredTo || null
    },
    rawHtml: page.html
  };
}

function extractFieldMap($: cheerio.CheerioAPI): Record<string, string[]> {
  const fieldMap: Record<string, string[]> = {};

  // SIL popup/detail pages are old-school HTML and often encode metadata as label/value
  // rows in tables or definition lists.
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
    const value = $(element).next("dd").text().replace(/\s+/g, " ").trim();
    const key = resolveFieldKey(label);

    if (!key || !value) {
      return;
    }

    fieldMap[key] ??= [];
    fieldMap[key].push(value);
  });

  $("p, div, span").each((_, element) => {
    const text = $(element).text().replace(/\s+/g, " ").trim();
    const key = resolveFieldKey(normalizeText(text.split(":")[0] ?? ""));

    if (!key || !text.includes(":")) {
      return;
    }

    const value = text.split(":").slice(1).join(":").trim();
    if (!value) {
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

function parseAuthors(rawValue: string): SilParsedAuthor[] {
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

function normalizeDate(value: string): string | null {
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

function extractPopupTitle($: cheerio.CheerioAPI): string {
  const candidates = [
    $("center b").first().text(),
    $("font b").first().text(),
    $("td b").first().text()
  ];

  return firstNonEmpty(...candidates);
}

function extractLongestContentBlock($: cheerio.CheerioAPI): string {
  const candidates = $("p, td, div")
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 80)
    .filter((text) => !looksLikeNavigation(text))
    .sort((a, b) => b.length - a.length);

  return candidates[0] ?? "";
}

function looksLikeNavigation(text: string): boolean {
  return /cerrar|imprimir|regresar|siguiente|anterior|inicio/i.test(text);
}

function sanitizeSilDetailTitle(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  if (/SIL - Sistema de Informaci[oó]n Legislativa/i.test(normalized)) {
    return null;
  }

  if (/PopUp Contenido Asuntos/i.test(normalized)) {
    return null;
  }

  return normalized;
}
