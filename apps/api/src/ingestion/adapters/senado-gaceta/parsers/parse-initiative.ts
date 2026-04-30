import * as cheerio from "cheerio";
import { sha256 } from "../../../core/hashing.js";
import { normalizeText } from "../../../core/normalization.js";
import type { SenadoHtmlPage, SenadoParsedAuthor, SenadoParsedInitiative } from "../types.js";

export function parseSenadoGacetaDocumentPage(page: SenadoHtmlPage): SenadoParsedInitiative | null {
  return parseSenadoGacetaDocumentInitiatives(page)[0] ?? null;
}

export function parseSenadoGacetaDocumentInitiatives(page: SenadoHtmlPage): SenadoParsedInitiative[] {
  const $ = cheerio.load(page.html);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const presentationDate = page.sessionDate ?? extractPresentationDate(bodyText) ?? extractDateFromUrl(page.url);
  const gacetaIssueNumber = extractGacetaIssueNumber(bodyText);
  const documentId = extractDocumentId(page.url);
  const initiativeEntries = extractInitiativeEntries(bodyText);

  if (initiativeEntries.length === 0) {
    const single = parseSingleInitiativeLikeDocument(page, bodyText, presentationDate, gacetaIssueNumber, documentId);
    return single ? [single] : [];
  }

  return initiativeEntries
    .map((entry, index) => buildInitiativeFromEntry(page, entry, index, presentationDate, gacetaIssueNumber, documentId))
    .filter((value): value is SenadoParsedInitiative => Boolean(value));
}

function parseSingleInitiativeLikeDocument(
  page: SenadoHtmlPage,
  bodyText: string,
  presentationDate: string | null,
  gacetaIssueNumber: string | null,
  documentId: string | null
): SenadoParsedInitiative | null {
  const $ = cheerio.load(page.html);
  const title = extractStandaloneTitle($, bodyText);
  if (!title) {
    return null;
  }

  const titleNormalized = normalizeText(title);
  const sourceRecordKey = buildSourceRecordKey({
    documentId,
    titleNormalized,
    presentationDate,
    entryIndex: 0
  });

  return {
    sourceUrl: page.url,
    sourceRecordKey,
    title,
    titleNormalized,
    authors: extractStandaloneAuthors(bodyText),
    presentationDate,
    statusRaw: extractStatus(bodyText),
    chamber: "Cámara de Senadores",
    initiativeType: "Iniciativa",
    description: extractDescription(bodyText, title),
    dedupeHash: sha256(sourceRecordKey),
    rawHtml: page.html,
    metadata: {
      parser: "senado-gaceta-document-v2",
      source_page_url: page.url,
      source_document_id: documentId,
      source_session_date: presentationDate,
      source_entry_index: 0,
      gaceta_issue_number: gacetaIssueNumber
    }
  };
}

function buildInitiativeFromEntry(
  page: SenadoHtmlPage,
  entry: string,
  entryIndex: number,
  presentationDate: string | null,
  gacetaIssueNumber: string | null,
  documentId: string | null
): SenadoParsedInitiative | null {
  const title = extractTitleFromInitiativeEntry(entry);
  if (!title) {
    return null;
  }

  const titleNormalized = normalizeText(title);
  const sourceRecordKey = buildSourceRecordKey({
    documentId,
    titleNormalized,
    presentationDate,
    entryIndex
  });

  return {
    sourceUrl: page.url,
    sourceRecordKey,
    title,
    titleNormalized,
    authors: extractAuthorsFromInitiativeEntry(entry),
    presentationDate,
    statusRaw: extractStatus(entry),
    chamber: "Cámara de Senadores",
    initiativeType: "Iniciativa",
    description: entry,
    dedupeHash: sha256(sourceRecordKey),
    rawHtml: page.html,
    metadata: {
      parser: "senado-gaceta-document-v2",
      source_page_url: page.url,
      source_document_id: documentId,
      source_session_date: presentationDate,
      source_entry_index: entryIndex,
      gaceta_issue_number: gacetaIssueNumber,
      block_text: entry.slice(0, 2000)
    }
  };
}

function extractInitiativeEntries(bodyText: string): string[] {
  const sectionMatch = bodyText.match(
    /INICIATIVAS:\s*(.*?)(?=DICTÁMENES A DISCUSIÓN Y VOTACIÓN|PROPOSICIONES:|AGENDA POLÍTICA|EFEMÉRIDES|CITA|$)/i
  );

  if (!sectionMatch?.[1]) {
    return [];
  }

  const sectionText = sectionMatch[1].replace(/\s+/g, " ").trim();
  const entryPattern =
    /(?:Del Sen\.|Del senador|Del Senador|De la Sen\.|De la Senadora|De la senadora|De las senadoras y los senadores|De las senadoras y de los senadores|De los senadores|De las senadoras)[\s\S]*?(?=(?:Del Sen\.|Del senador|Del Senador|De la Sen\.|De la Senadora|De la senadora|De las senadoras y los senadores|De las senadoras y de los senadores|De los senadores|De las senadoras)\s|$)/gi;

  return [...sectionText.matchAll(entryPattern)]
    .map((match) => match[0]?.trim() ?? "")
    .filter(Boolean)
    .filter((value) => /con proyecto de decreto|con Proyecto de Decreto|que reforma|por el que se expide|por el que se adiciona|por el que se reforma/i.test(value));
}

function extractTitleFromInitiativeEntry(entry: string): string | null {
  const cleaned = entry.replace(/\s+/g, " ").trim();
  const match =
    cleaned.match(/con proyecto de decreto\s+(.*)$/i) ??
    cleaned.match(/con Proyecto de Decreto\s+(.*)$/i) ??
    cleaned.match(/,\s*(que\s+reforma.*)$/i);

  const rawTitle = match?.[1]?.trim();
  if (!rawTitle) {
    return null;
  }

  return capitalizeInitial(rawTitle.replace(/\.$/, ""));
}

function extractAuthorsFromInitiativeEntry(entry: string): SenadoParsedAuthor[] {
  const prefix = entry.split(/,\s*con proyecto de decreto/i)[0] ?? entry;
  const normalizedPrefix = prefix.replace(/\s+/g, " ").trim();
  const authors = [
    ...normalizedPrefix.matchAll(
      /(?:Del|De la|De las|De los)\s+(.+?)(?=,\s*del Grupo Parlamentario|,\s*el Grupo Parlamentario|\s+y\s+de\s+las?\s+senador(?:a|as|es)\b|\s+y\s+del\s+senador\b|$)/gi
    )
  ]
    .map((match) => match[1] ?? "")
    .flatMap(splitAuthorSegment)
    .map(cleanAuthor)
    .filter(Boolean)
    .filter((value) => !/^grupo parlamentario/i.test(value))
    .map((fullName) => ({
      fullName,
      role: "primary"
    }));

  return uniqueBy(authors, (author) => normalizeText(author.fullName));
}

function extractStandaloneTitle($: cheerio.CheerioAPI, bodyText: string): string | null {
  const headingCandidates = $("h1, h2, h3, strong, b")
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const candidate of headingCandidates) {
    if (/^Que\s+/i.test(candidate) || /^Oficio con el que remite/i.test(candidate)) {
      return candidate;
    }
  }

  const bodyMatch =
    bodyText.match(/(Que\s+.*?)(?=Se turnó|La Presidencia informó|ARCHIVOS PARA DESCARGAR|El contenido de esta página|$)/i) ??
    bodyText.match(/(Oficio con el que remite.*?)(?=Se turnó|La Presidencia informó|ARCHIVOS PARA DESCARGAR|El contenido de esta página|$)/i);

  return bodyMatch?.[1]?.trim() ?? null;
}

function extractStandaloneAuthors(text: string): SenadoParsedAuthor[] {
  const authors: SenadoParsedAuthor[] = [];
  const patterns = [
    /(?:del|de la)\s+(senador(?:a)?\s+[^.,;]+(?:,\s*[A-ZÁÉÍÓÚÑ]+)?)/gi,
    /(?:presentada|presentado)\s+por\s+([^.;]+)/gi,
    /remite\s+de\s+([^.;]+)/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = cleanAuthor(match[1] ?? "");
      if (!raw) {
        continue;
      }

      authors.push({
        fullName: raw,
        role: "primary"
      });
    }
  }

  return uniqueBy(authors, (author) => normalizeText(author.fullName));
}

function cleanAuthor(value: string): string {
  return value
    .replace(/^senador(?:a)?\s+/i, "")
    .replace(/^sen\.\s*/i, "")
    .replace(/^senadores\s+/i, "")
    .replace(/^senadoras\s+/i, "")
    .replace(/\s*,?\s*del Grupo Parlamentario.*$/i, "")
    .replace(/\s*,?\s*el Grupo Parlamentario.*$/i, "")
    .replace(/^las senadoras y los senadores\s+/i, "")
    .replace(/^las senadoras y de los senadores\s+/i, "")
    .replace(/^senadoras y los senadores\s+/i, "")
    .replace(/^senadoras y de los senadores\s+/i, "")
    .replace(/^senadoras y senadores\s+/i, "")
    .replace(/^las senadoras y de los senadores\s+/i, "")
    .replace(/^la senadora\s+/i, "")
    .replace(/^el senador\s+/i, "")
    .replace(/^los senadores\s+/i, "")
    .replace(/^las senadoras\s+/i, "")
    .replace(/^de la titular del poder ejecutivo federal$/i, "Titular del Poder Ejecutivo Federal")
    .replace(/^la titular del poder ejecutivo federal$/i, "Titular del Poder Ejecutivo Federal")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAuthorSegment(value: string): string[] {
  const cleaned = value
    .replace(/^senadoras y de los senadores\s+/i, "")
    .replace(/^senadoras y los senadores\s+/i, "")
    .replace(/^senadoras y senadores\s+/i, "")
    .replace(/^las senadoras y de los senadores\s+/i, "")
    .replace(/^las senadoras y los senadores\s+/i, "")
    .replace(/\s+y\s+de\s+las?\s+senador(?:a|as|es)\s+/gi, ", ")
    .replace(/\s+y\s+del\s+senador\s+/gi, ", ")
    .replace(/\s+y\s+de\s+los\s+senadores\s+/gi, ", ")
    .replace(/\s+y\s+/gi, ", ")
    .replace(/\s*,\s*y\s+/gi, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractStatus(text: string): string | null {
  const sentences = text.split(".").map((value) => value.trim());
  return (
    sentences.find((sentence) => /^Se turnó/i.test(sentence)) ??
    sentences.find((sentence) => /^La Presidencia informó/i.test(sentence)) ??
    null
  );
}

function extractDescription(text: string, title: string): string | null {
  const normalized = text.replace(title, "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 3000) : null;
}

function extractPresentationDate(text: string): string | null {
  const match = text.match(/\b(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/i);
  return match ? toIsoDate(match[1], match[2], match[3]) : null;
}

function extractDateFromUrl(url: string): string | null {
  const match = url.match(/\/(\d{4})_(\d{2})_(\d{2})\//);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function extractDocumentId(url: string): string | null {
  const match = url.match(/\/documento\/(\d+)/i);
  return match?.[1] ?? null;
}

function extractGacetaIssueNumber(text: string): string | null {
  const match = text.match(/Gaceta:\s*([^\s]+)/i);
  return match?.[1]?.trim() ?? null;
}

function buildSourceRecordKey(input: {
  documentId: string | null;
  titleNormalized: string;
  presentationDate: string | null;
  entryIndex: number;
}): string {
  if (input.documentId) {
    return `senado:documento:${input.documentId}:entrada:${input.entryIndex}`;
  }

  return `senado:fallback:${input.titleNormalized}:${input.presentationDate ?? "no-date"}:${input.entryIndex}`;
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
  return month ? `${year}-${month}-${day.padStart(2, "0")}` : null;
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

function capitalizeInitial(value: string): string {
  if (!value) {
    return value;
  }

  return value[0].toUpperCase() + value.slice(1);
}
