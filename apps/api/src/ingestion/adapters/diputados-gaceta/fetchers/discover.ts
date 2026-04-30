import * as cheerio from "cheerio";
import { diputadosGacetaClient } from "../client.js";
import type { DiputadosDiscoveredPage, DiputadosIngestionOptions } from "../types.js";

export async function discoverDiputadosGacetaPages(
  options: DiputadosIngestionOptions = {}
): Promise<DiputadosDiscoveredPage[]> {
  const queue: DiputadosDiscoveredPage[] = (options.seedUrls ?? diputadosGacetaClient.discoveryUrls).map((url) => ({
    url,
    depth: 0
  }));
  const visited = new Set<string>();
  const detailPages: DiputadosDiscoveredPage[] = [];
  const maxDiscoveryPages = options.maxDiscoveryPages ?? 10;
  const maxDetailPages = options.maxDetailPages ?? 50;

  while (queue.length > 0 && visited.size < maxDiscoveryPages && detailPages.length < maxDetailPages) {
    const current = queue.shift();

    if (!current || visited.has(current.url)) {
      continue;
    }

    visited.add(current.url);

    const response = await diputadosGacetaClient.getHtml(current.url);
    const $ = cheerio.load(response.html);

    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");
      if (!href || href === "#" || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) {
        return;
      }

      const absoluteUrl = toAbsoluteUrl(current.url, href);
      const label = $(element).text().replace(/\s+/g, " ").trim();

      if (!absoluteUrl.startsWith(diputadosGacetaClient.baseUrl)) {
        return;
      }

      if (looksLikeDetailPage(absoluteUrl, label)) {
        detailPages.push({
          url: absoluteUrl,
          depth: current.depth + 1,
          parentUrl: current.url
        });
        return;
      }

      if (looksLikeIndexPage(absoluteUrl, label) && !visited.has(absoluteUrl)) {
        queue.push({
          url: absoluteUrl,
          depth: current.depth + 1,
          parentUrl: current.url
        });
      }
    });
  }

  return uniqueBy(detailPages, (page) => page.url).slice(0, maxDetailPages);
}

function looksLikeDetailPage(url: string, label: string): boolean {
  return (
    /Gaceta\/Iniciativas\/\d+\//i.test(url) ||
    /gp\d+_a/i.test(url) ||
    /^que\s+/i.test(label)
  );
}

function looksLikeIndexPage(url: string, label: string): boolean {
  return /gp_iniciativas\.html|gp_b_indice\.html|gp\d+_b_inis\.html|base\/inis\//i.test(url) || /legislatura|iniciativas/i.test(label);
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

