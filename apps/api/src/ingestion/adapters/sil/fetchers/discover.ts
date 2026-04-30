import * as cheerio from "cheerio";
import { silClient } from "../client.js";
import type { SilDiscoveredPage, SilIngestionOptions } from "../types.js";

export async function discoverSilPages(options: SilIngestionOptions = {}): Promise<SilDiscoveredPage[]> {
  const queue: SilDiscoveredPage[] = (options.seedUrls ?? silClient.discoveryUrls).map((url) => ({
    url,
    depth: 0
  }));
  const visited = new Set<string>();
  const resultPages: SilDiscoveredPage[] = [];
  const maxDiscoveryPages = options.maxDiscoveryPages ?? 10;
  const maxDetailPages = options.maxDetailPages ?? 50;

  while (queue.length > 0 && visited.size < maxDiscoveryPages && resultPages.length < maxDetailPages) {
    const current = queue.shift();

    if (!current || visited.has(current.url)) {
      continue;
    }

    visited.add(current.url);

    const response = await silClient.getHtml(current.url);
    const $ = cheerio.load(response.html);

    if (isResultsPage(current.url)) {
      resultPages.push(current);
    }

    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");

      if (!href || href === "#" || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) {
        return;
      }

      const absoluteUrl = toAbsoluteUrl(current.url, href);
      const label = $(element).text().trim();

      if (!absoluteUrl.startsWith(silClient.baseUrl)) {
        return;
      }

      if (isResultsPage(absoluteUrl) && !visited.has(absoluteUrl)) {
        queue.push({
          url: normalizeResultsUrl(absoluteUrl),
          depth: current.depth + 1,
          parentUrl: current.url
        });
        return;
      }

      if (looksLikePagination(label, absoluteUrl) && !visited.has(absoluteUrl)) {
        queue.push({
          url: normalizeResultsUrl(absoluteUrl),
          depth: current.depth + 1,
          parentUrl: current.url
        });
      }
    });
  }

  const normalizedSeeds = queueFromRegWindow(options.seedUrls ?? silClient.discoveryUrls, maxDetailPages);
  const pages = uniqueBy([...resultPages, ...normalizedSeeds], (page) => canonicalizeResultsPageKey(page.url)).slice(
    0,
    maxDetailPages
  );

  return pages;
}

function isResultsPage(url: string): boolean {
  return /resultadosNumeraliaIniciativas\.php/i.test(url);
}

function looksLikePagination(label: string, url: string): boolean {
  return (
    /siguiente|next|resultados|pagina|page|\d+/i.test(label) ||
    /page=|pagina=|offset=|index2?\.php|resultadosNumeraliaIniciativas\.php/i.test(url)
  );
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

function normalizeResultsUrl(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    if (isResultsPage(url.toString())) {
      url.searchParams.set("Paginas", "15");
      if (!url.searchParams.has("pagina")) {
        url.searchParams.set("pagina", "1");
      }
    }
    return url.toString();
  } catch {
    return urlValue;
  }
}

function canonicalizeResultsPageKey(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    if (!isResultsPage(url.toString())) {
      return url.toString();
    }

    const origin = url.searchParams.get("Origen") ?? "";
    const serial = url.searchParams.get("Serial") ?? "";
    const reg = url.searchParams.get("Reg") ?? "1";
    const pagina = url.searchParams.get("pagina") ?? "1";

    return `resultados:${origin}:${serial}:${reg}:${pagina}`;
  } catch {
    return urlValue;
  }
}

function queueFromRegWindow(seedUrls: string[], maxDetailPages: number): SilDiscoveredPage[] {
  const generated: SilDiscoveredPage[] = [];

  for (const seedUrl of seedUrls) {
    try {
      const url = new URL(seedUrl);
      if (!isResultsPage(url.toString())) {
        continue;
      }

      const originalReg = Number(url.searchParams.get("Reg") ?? "1");
      const windowSize = Math.min(maxDetailPages, 5);

      for (let offset = 0; offset < windowSize; offset += 1) {
        const clone = new URL(url.toString());
        clone.searchParams.set("Reg", String(Math.max(1, originalReg + offset)));
        clone.searchParams.set("pagina", "1");
        clone.searchParams.set("Paginas", "15");

        generated.push({
          url: clone.toString(),
          depth: 0,
          parentUrl: seedUrl
        });
      }
    } catch {
      continue;
    }
  }

  return generated;
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
