import * as cheerio from "cheerio";
import { sha256 } from "../../../core/hashing.js";
import { normalizeText } from "../../../core/normalization.js";
import type { DiputadosHtmlPage, DiputadosParsedAuthor, DiputadosParsedInitiative } from "../types.js";

export function parseDiputadosGacetaListPage(page: DiputadosHtmlPage): DiputadosParsedInitiative[] {
  const $ = cheerio.load(page.html);
  const blocks = collectCandidateBlocks($);
  const initiatives: DiputadosParsedInitiative[] = [];
  const legislature = extractLegislatureFromUrl(page.url);

  for (const [blockIndex, block] of blocks.entries()) {
    const title = extractTitle(block);
    if (!title) {
      continue;
    }

    const presentationDate = extractPresentationDate(block);
    const titleNormalized = normalizeText(title);
    const authorNames = extractAuthors(block).map((author) => normalizeText(author.fullName)).join("|");
    const gacetaIssueNumber = extractGacetaIssueNumber(block);
    const sourceEntryId = extractSourceEntryId(block);
    const stableSourceKey = buildStableSourceKey({
      legislature,
      gacetaIssueNumber,
      sourceEntryId,
      titleNormalized,
      presentationDate,
      authorNames
    });
    const dedupeHash = sha256(stableSourceKey);

    initiatives.push({
      sourceUrl: page.url,
      sourceRecordKey: stableSourceKey,
      title,
      titleNormalized,
      authors: extractAuthors(block),
      presentationDate,
      statusRaw: extractStatus(block),
      chamber: "Cámara de Diputados",
      initiativeType: "Iniciativa",
      description: extractDescription(block, title),
      dedupeHash,
      rawHtml: page.html,
      metadata: {
        parser: "diputados-gaceta-list-v1",
        parentUrl: page.parentUrl ?? null,
        detail_url: page.url,
        source_legislature: legislature,
        source_page_url: page.url,
        source_block_index: blockIndex,
        source_entry_id: sourceEntryId,
        gaceta_issue_number: gacetaIssueNumber,
        block_text: block.slice(0, 2000)
      }
    });
  }

  return uniqueBy(initiatives, (initiative) => initiative.dedupeHash);
}

function collectCandidateBlocks($: cheerio.CheerioAPI): string[] {
  const blocks = $("li, p")
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim())
    .filter((text) => /^Que\s+/i.test(text))
    .filter((text) => text.length > 40);

  if (blocks.length > 0) {
    return blocks;
  }

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const fallbackBlocks = bodyText.match(/Que\s+.*?(?=Que\s+|$)/g) ?? [];
  return fallbackBlocks.map((block) => block.trim()).filter((block) => block.length > 40);
}

function extractTitle(block: string): string | null {
  const match = block.match(/^(Que\s+.*?)(?=Presentada por|Suscrita por|Turnada a|Gaceta Parlamentaria|$)/i);
  return match?.[1]?.trim() ?? null;
}

function extractPresentationDate(block: string): string | null {
  const preferredPatterns = [
    /Gaceta Parlamentaria,[^.]*?\b(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/i,
    /Presentad[ao] por [^.]*?\b(?:el|la)\s+(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo),?\s+(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/i,
    /Presentad[ao] por [^.]*?\b(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/i
  ];

  for (const pattern of preferredPatterns) {
    const match = block.match(pattern);
    if (match) {
      return toIsoDate(match[1], match[2], match[3]);
    }
  }

  const allDates = [...block.matchAll(/\b(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/gi)];
  if (allDates.length === 0) {
    return null;
  }

  const parsedDates = allDates
    .map((match) => toIsoDate(match[1], match[2], match[3]))
    .filter((value): value is string => Boolean(value))
    .sort();

  return parsedDates[0] ?? null;
}

function toIsoDate(day: string, monthName: string, year: string): string | null {
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

  const month = months[normalizeText(monthName)];
  if (!month) {
    return null;
  }

  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function extractAuthors(block: string): DiputadosParsedAuthor[] {
  const match = block.match(/Presentada por ([^.]+)\./i) ?? block.match(/Suscrita por ([^.]+)\./i);
  if (!match) {
    return [];
  }

  return match[1]
    .replace(/;\s*y\s+suscrit[ao]s?\s+por.*$/i, "")
    .split(/;|, y | y /i)
    .map(cleanAuthorCandidate)
    .filter(Boolean)
    .map((fullName) => ({
      fullName,
      role: "primary"
    }));
}

function cleanAuthorCandidate(value: string): string {
  const cleaned = value
    .replace(/^presentad[ao]s?\s+por\s+/i, "")
    .replace(/^suscrit[ao]s?\s+por\s+/i, "")
    .replace(/^(?:el|la|los|las)\s+diputad(?:o|a|os|as)\s+/i, "")
    .replace(/^(?:el|la|los|las)\s+senad(?:or|ora|ores|oras)\s+/i, "")
    .replace(/,\s*(PAN|PRI|PRD|PVEM|PT|MC|MORENA|PES|PNA)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (
    /^(integrantes|grupo parlamentario|diputados del grupo parlamentario|diversos diputados|diversas diputadas|suscrit)/i.test(
      cleaned
    )
  ) {
    return "";
  }

  if (/^del\s+(PAN|PRI|PRD|PVEM|PT|MC|MORENA|PES|PNA)\b/i.test(cleaned)) {
    return "";
  }

  return cleaned;
}

function extractStatus(block: string): string | null {
  const parts = block.split(".").map((value) => value.trim());
  return parts.find((part) => /Turnada|Prórroga|Dictaminada|Publicad/i.test(part)) ?? null;
}

function extractDescription(block: string, title: string): string | null {
  const normalized = block.replace(title, "").trim();
  return normalized || title;
}

function extractGacetaIssueNumber(block: string): string | null {
  const match = block.match(/Gaceta Parlamentaria,\s*número\s*([^,]+),/i);
  return match?.[1]?.trim() ?? null;
}

function extractSourceEntryId(block: string): string | null {
  const match = block.match(/\((\d+)\)\s*$/);
  return match?.[1] ?? null;
}

function buildStableSourceKey(input: {
  legislature: string | null;
  gacetaIssueNumber: string | null;
  sourceEntryId: string | null;
  titleNormalized: string;
  presentationDate: string | null;
  authorNames: string;
}): string {
  if (input.legislature && input.gacetaIssueNumber && input.sourceEntryId) {
    return `diputados:${input.legislature}:${normalizeText(input.gacetaIssueNumber)}:${input.sourceEntryId}`;
  }

  return `diputados:fallback:${input.titleNormalized}:${input.presentationDate ?? "no-date"}:${input.authorNames || "no-authors"}`;
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

function extractLegislatureFromUrl(url: string): string | null {
  const match = url.match(/\/Gaceta\/Iniciativas\/(\d+)\//i) ?? url.match(/\/base\/inis\/(\d+)\//i);
  return match?.[1] ?? null;
}
