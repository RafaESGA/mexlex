import * as cheerio from "cheerio";
import type { SenadoHtmlPage } from "../types.js";

export function parseSenadoGacetaSessionPage(page: SenadoHtmlPage): Array<{
  url: string;
  titleHint: string | null;
  summaryHint: string | null;
  sessionDate: string | null;
}> {
  const $ = cheerio.load(page.html);
  const results: Array<{
    url: string;
    titleHint: string | null;
    summaryHint: string | null;
    sessionDate: string | null;
  }> = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const absoluteUrl = toAbsoluteUrl(page.url, href);
    if (!/\/documento\/\d+/i.test(absoluteUrl)) {
      return;
    }

    const containerText = $(element)
      .closest("li, article, section, div, tr")
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const anchorText = $(element).text().replace(/\s+/g, " ").trim();
    const combinedText = [anchorText, containerText].filter(Boolean).join(" ");

    if (!/Que\s+|iniciativa|proyecto de decreto|oficio con el que remite/i.test(combinedText)) {
      return;
    }

    results.push({
      url: absoluteUrl,
      titleHint: extractTitleHint(combinedText),
      summaryHint: containerText || null,
      sessionDate: page.sessionDate ?? extractSessionDateFromBody($.text())
    });
  });

  return uniqueBy(results, (item) => item.url);
}

function extractTitleHint(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(Que\s+.*?)(?=Se turnó|La Presidencia informó|ARCHIVOS PARA DESCARGAR|$)/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  if (/^Oficio con el que remite/i.test(normalized)) {
    return normalized.slice(0, 400);
  }

  return null;
}

function extractSessionDateFromBody(text: string): string | null {
  const match = text.match(/\b(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/i);
  return match ? toIsoDate(match[1], match[2], match[3]) : null;
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

  const month = months[monthName.toLowerCase()];
  return month ? `${year}-${month}-${day.padStart(2, "0")}` : null;
}

function toAbsoluteUrl(baseUrl: string, href: string): string {
  try {
    const url = new URL(href, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return href;
  }
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
