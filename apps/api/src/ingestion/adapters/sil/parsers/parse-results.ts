import * as cheerio from "cheerio";
import { sha256 } from "../../../core/hashing.js";
import { normalizeText } from "../../../core/normalization.js";
import type { SilParsedAuthor, SilParsedInitiative, SilHtmlPage } from "../types.js";

export function parseSilResultsPage(page: SilHtmlPage): SilParsedInitiative[] {
  const $ = cheerio.load(page.html);
  const initiatives: SilParsedInitiative[] = [];

  $("tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .toArray()
      .map((cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (cells.length < 6) {
      return;
    }

    const titleCell = findLikelyTitleCell(cells);

    if (!titleCell || isHeaderRow(cells) || !looksLikeInitiativeTitle(titleCell)) {
      return;
    }

    const cellMap = mapResultRow(cells, titleCell);
    const initiativeType = cellMap.initiativeType;
    const chamber = cellMap.chamber;
    const presentationDate = cellMap.presentationDate;
    const authorCell = cellMap.authorCell;
    const party = cellMap.party;
    const legislature = cellMap.legislature;
    const referredTo = normalizeCommissionList(cellMap.referredTo);
    const statusRaw = cells.find((cell) => /EL\s+\d{2}-[A-Z]{3}-\d{4}|Pendiente|Publicado|Desechado|Devuelto/i.test(cell)) ?? null;
    const topic = normalizeEnumeratedList(cellMap.topic);
    const detailUrl = extractDetailUrl($, row, page.url);
    const titleNormalized = normalizeText(titleCell);
    const dedupeHash = sha256(`${titleNormalized}|${presentationDate ?? "no-date"}`);

    initiatives.push({
      sourceUrl: page.url,
      sourceRecordKey: dedupeHash,
      title: titleCell,
      titleNormalized,
      authors: parseAuthors(authorCell),
      presentationDate,
      statusRaw,
      chamber,
      initiativeType,
      description: titleCell,
      dedupeHash,
      rawHtml: page.html,
      metadata: {
        parser: "sil-results-table-v1",
        parentUrl: page.parentUrl ?? null,
        detail_url: detailUrl,
        party,
        legislature,
        referred_to: referredTo,
        topic
      }
    });
  });

  return uniqueBy(initiatives, (initiative) => initiative.dedupeHash);
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return /tipo.*asunto|camara|fecha|promovente|partido|legislatura/i.test(joined);
}

function looksLikeInitiativeTitle(value: string): boolean {
  return (
    /^que\s+/i.test(value) ||
    /decreto/i.test(value) ||
    /reforma/i.test(value) ||
    /ley/i.test(value)
  );
}

function findLikelyTitleCell(cells: string[]): string | null {
  const candidates = cells.filter((cell) => looksLikeInitiativeTitle(cell));
  return candidates[0] ?? null;
}

function mapResultRow(cells: string[], titleCell: string): {
  initiativeType: string | null;
  chamber: string | null;
  presentationDate: string | null;
  authorCell: string;
  party: string | null;
  legislature: string | null;
  referredTo: string | null;
  topic: string | null;
} {
  const titleIndex = cells.findIndex((cell) => cell === titleCell);
  const dateIndex = cells.findIndex((cell) => Boolean(normalizeDate(cell)));
  const chamberIndex = cells.findIndex((cell) => /senadores|diputados|camara/i.test(cell));
  const legislatureIndex = cells.findIndex((cell) => /^(LX|LXI|LXII|LXIII|LXIV|LXV|LXVI)/i.test(cell));
  const partyIndex = cells.findIndex((cell) => /^(PAN|PRI|PRD|PVEM|PT|MC|MORENA|PNA|PES)$/i.test(cell));
  const initiativeTypeIndex =
    titleIndex > 0 ? titleIndex - 1 : cells.findIndex((cell) => /ley|decreto|constitucion|reglamento/i.test(cell));
  const authorIndex = dateIndex > 0 ? dateIndex + 1 : titleIndex + 1;

  return {
    initiativeType: initiativeTypeIndex >= 0 ? cells[initiativeTypeIndex] ?? null : null,
    chamber: chamberIndex >= 0 ? cells[chamberIndex] ?? null : null,
    presentationDate: dateIndex >= 0 ? normalizeDate(cells[dateIndex] ?? "") : null,
    authorCell: authorIndex >= 0 ? cells[authorIndex] ?? "" : "",
    party: partyIndex >= 0 ? cells[partyIndex] ?? null : null,
    legislature: legislatureIndex >= 0 ? cells[legislatureIndex] ?? null : null,
    referredTo: cells.find((cell) => /dictamen|comision/i.test(cell)) ?? null,
    topic: cells[cells.length - 1] ?? null
  };
}

function parseAuthors(rawValue: string): SilParsedAuthor[] {
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
  const slashMatch = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, "0");
    const month = slashMatch[2].padStart(2, "0");
    return `${slashMatch[3]}-${month}-${day}`;
  }

  return null;
}

function uniqueBy<T>(items: T[], keySelector: (item: T) => string): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = keySelector(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeCommissionList(value: string | null): string | null {
  return normalizeEnumeratedList(value);
}

function normalizeEnumeratedList(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  const matches = normalized.match(/\d+\.-.*?(?=\d+\.-|$)/g);

  if (!matches || matches.length === 0) {
    return normalized;
  }

  return matches.map((match) => match.trim()).join(" | ");
}

function extractDetailUrl($: cheerio.CheerioAPI, row: cheerio.Element, baseUrl: string): string | null {
  const linkCandidates = $(row).find("a[href], a[onclick], img[onclick]").toArray();

  for (const element of linkCandidates) {
    const href = $(element).attr("href");
    const onclick = $(element).attr("onclick");
    const extracted = href || onclick;

    if (!extracted) {
      continue;
    }

    const detailUrl = extractSilDetailUrlFromString(extracted, baseUrl);
    if (detailUrl) {
      return detailUrl;
    }
  }

  const rowHtml = $.html(row);
  return extractSilDetailUrlFromString(rowHtml, baseUrl);
}

function extractSilDetailUrlFromString(input: string, baseUrl: string): string | null {
  const claveMatch = input.match(/Clave=(\d+)/i);
  if (claveMatch) {
    return toAbsoluteUrl(baseUrl, `/Librerias/pp_ContenidoAsuntos.php?Clave=${claveMatch[1]}`);
  }

  const directMatch = input.match(/pp_ContenidoAsuntos\.php\?[^"' )]+/i);
  if (directMatch) {
    const cleaned = decodeHtmlEntities(directMatch[0]).replace(/(%22|["',]).*$/i, "");
    return toAbsoluteUrl(baseUrl, cleaned);
  }

  return null;
}

function toAbsoluteUrl(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
