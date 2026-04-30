import * as cheerio from "cheerio";
import { sha256 } from "../../../core/hashing.js";
import { normalizeText } from "../../../core/normalization.js";
import type { DiputadosHtmlPage, DiputadosParsedAuthor, DiputadosParsedInitiative } from "../types.js";

export function parseDiputadosGacetaInitiative(page: DiputadosHtmlPage): DiputadosParsedInitiative | null {
  const $ = cheerio.load(page.html);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const title = extractTitle($);

  if (!title) {
    return null;
  }

  const presentationDate = extractPresentationDate(bodyText);
  const statusRaw = extractStatus(bodyText);
  const description = extractDescription($, bodyText, title);
  const authors = extractAuthors(bodyText);
  const titleNormalized = normalizeText(title);
  const dedupeHash = sha256(`${titleNormalized}|${presentationDate ?? "no-date"}`);

  return {
    sourceUrl: page.url,
    sourceRecordKey: dedupeHash,
    title,
    titleNormalized,
    authors,
    presentationDate,
    statusRaw,
    chamber: "Cámara de Diputados",
    initiativeType: "Iniciativa",
    description,
    dedupeHash,
    rawHtml: page.html,
    metadata: {
      parser: "diputados-gaceta-html-v1",
      parentUrl: page.parentUrl ?? null,
      detail_url: page.url
    }
  };
}

function extractTitle($: cheerio.CheerioAPI): string | null {
  const candidates = [
    $("h1").first().text(),
    $("h2").first().text(),
    $("b").first().text(),
    $("title").text()
  ]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value) => /^que\s+/i.test(value) || /reforma|adiciona|deroga|expide/i.test(value));

  return candidates[0] ?? null;
}

function extractPresentationDate(bodyText: string): string | null {
  const match = bodyText.match(/\b(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/i);
  if (!match) {
    return null;
  }

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

  const month = months[normalizeText(match[2])];
  if (!month) {
    return null;
  }

  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

function extractStatus(bodyText: string): string | null {
  const lines = bodyText.split(".").map((line) => line.trim());
  return lines.find((line) => /Turnada|Prórroga|Dictaminada|Publicad/i.test(line)) ?? null;
}

function extractDescription($: cheerio.CheerioAPI, bodyText: string, title: string): string | null {
  const metaDescription = $('meta[name="description"]').attr("content")?.trim();
  if (metaDescription) {
    return metaDescription;
  }

  const paragraphs = $("p")
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 80)
    .filter((text) => text !== title);

  return paragraphs[0] ?? (bodyText.slice(0, 400) || null);
}

function extractAuthors(bodyText: string): DiputadosParsedAuthor[] {
  const match = bodyText.match(/Presentada por ([^.]+)\./i) ?? bodyText.match(/Suscrita por ([^.]+)\./i);
  if (!match) {
    return [];
  }

  return match[1]
    .split(/;|, y | y /i)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((fullName) => ({
      fullName,
      role: "primary"
    }));
}
