import * as cheerio from "cheerio";
import { senadoGacetaClient } from "../client.js";
import { senadoGacetaLogger } from "../logger.js";
import type { SenadoDiscoveredPage, SenadoIngestionOptions, SenadoPageKind } from "../types.js";

export async function discoverSenadoGacetaPages(
  options: SenadoIngestionOptions = {}
): Promise<SenadoDiscoveredPage[]> {
  const queue: SenadoDiscoveredPage[] = (options.seedUrls ?? senadoGacetaClient.discoveryUrls).map((url) => ({
    url,
    depth: 0,
    kind: classifySeedUrl(url)
  }));
  const visited = new Set<string>();
  const sessionPages: SenadoDiscoveredPage[] = [];
  const documentPages: SenadoDiscoveredPage[] = [];
  const maxDiscoveryPages = options.maxDiscoveryPages ?? 10;
  const maxSessionPages = options.maxSessionPages ?? 30;
  const maxDetailPages = options.maxDetailPages ?? 100;

  while (
    queue.length > 0 &&
    visited.size < maxDiscoveryPages &&
    sessionPages.length < maxSessionPages &&
    documentPages.length < maxDetailPages
  ) {
    const current = queue.shift();
    if (!current || visited.has(current.url)) {
      continue;
    }

    visited.add(current.url);

    const response = await senadoGacetaClient.getHtml(current.url);
    const $ = cheerio.load(response.html);
    const acceptedLinks: string[] = [];
    const rejectedLinks: string[] = [];
    let anchorCount = 0;
    const seenCandidates = new Set<string>();
    const blockedByIncapsula = /_Incapsula_Resource/i.test(response.html);

    $("a[href]").each((_, element) => {
      anchorCount += 1;
      const href = $(element).attr("href");
      const label = $(element).text().replace(/\s+/g, " ").trim();

      if (!href || href === "#" || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) {
        return;
      }

      processCandidateUrl(href, label);
    });

    if (anchorCount === 0 || (sessionPages.length === 0 && documentPages.length === 0)) {
      for (const candidate of extractRawHtmlCandidates(response.html)) {
        processCandidateUrl(candidate, "");
      }
    }

    senadoGacetaLogger.info("Scanned Senado Gaceta discovery page", {
      url: current.url,
      blockedByIncapsula,
      anchorCount,
      rawCandidateCount: seenCandidates.size,
      htmlLength: response.html.length,
      htmlPreview: response.html.replace(/\s+/g, " ").slice(0, 500),
      acceptedSample: acceptedLinks,
      rejectedSample: rejectedLinks,
      sessionPagesFound: sessionPages.length,
      documentPagesFound: documentPages.length
    });

    function processCandidateUrl(href: string, label: string): void {
      const absoluteUrl = toAbsoluteUrl(current.url, href);
      if (!absoluteUrl || seenCandidates.has(absoluteUrl)) {
        return;
      }

      seenCandidates.add(absoluteUrl);

      if (!isAllowedSenadoUrl(absoluteUrl)) {
        if (rejectedLinks.length < 10) {
          rejectedLinks.push(absoluteUrl);
        }
        return;
      }

      const kind = classifySenadoUrl(absoluteUrl, label);
      if (kind === "document") {
        if (acceptedLinks.length < 10) {
          acceptedLinks.push(`${kind}:${absoluteUrl}`);
        }
        documentPages.push({
          url: absoluteUrl,
          depth: current.depth + 1,
          kind,
          parentUrl: current.url,
          sessionDate: extractSessionDateFromUrl(current.url) ?? null
        });
        return;
      }

      if (kind === "session" && !visited.has(absoluteUrl)) {
        if (acceptedLinks.length < 10) {
          acceptedLinks.push(`${kind}:${absoluteUrl}`);
        }
        sessionPages.push({
          url: absoluteUrl,
          depth: current.depth + 1,
          kind,
          parentUrl: current.url,
          sessionDate: extractSessionDateFromUrl(absoluteUrl) ?? null
        });
        queue.push({
          url: absoluteUrl,
          depth: current.depth + 1,
          kind,
          parentUrl: current.url,
          sessionDate: extractSessionDateFromUrl(absoluteUrl) ?? null
        });
        return;
      }

      if (kind === "index" && acceptedLinks.length < 10) {
        acceptedLinks.push(`${kind}:${absoluteUrl}`);
      }

      if (!kind && rejectedLinks.length < 10) {
        rejectedLinks.push(absoluteUrl);
      }
    }
  }

  const uniqueDocuments = uniqueBy(documentPages, (page) => page.url).slice(0, maxDetailPages);
  if (uniqueDocuments.length > 0) {
    return uniqueDocuments;
  }

  if (options.seedUrls && options.seedUrls.length > 0) {
    return uniqueBy(queue, (page) => page.url)
      .filter((page) => page.kind === "document" || page.kind === "session")
      .slice(0, maxDetailPages);
  }

  return uniqueBy(sessionPages, (page) => page.url).slice(0, maxSessionPages);
}

function classifySeedUrl(url: string): SenadoPageKind {
  if (/\/gaceta_del_senado\/documento\/\d+/i.test(url) || /\/informacion\/gaceta\/documento\/\d+/i.test(url)) {
    return "document";
  }

  if (/\/gaceta_del_senado\/\d{4}_\d{2}_\d{2}\/\d+/i.test(url) || /\/informacion\/gaceta\/sesion\/\d+/i.test(url)) {
    return "session";
  }

  return "index";
}

function classifySenadoUrl(url: string, label: string): SenadoPageKind | null {
  if (/\/gaceta_del_senado\/documento\/\d+/i.test(url) || /\/informacion\/gaceta\/documento\/\d+/i.test(url)) {
    return "document";
  }

  if (/\/gaceta_del_senado\/\d{4}_\d{2}_\d{2}\/\d+/i.test(url) || /\/informacion\/gaceta\/sesion\/\d+/i.test(url)) {
    return "session";
  }

  if (/gaceta/i.test(label) || /calendario/i.test(label)) {
    return "index";
  }

  return null;
}

function extractSessionDateFromUrl(url: string): string | null {
  const match = url.match(/\/(\d{4})_(\d{2})_(\d{2})\//);
  if (!match) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function toAbsoluteUrl(baseUrl: string, href: string): string {
  try {
    const url = new URL(href, baseUrl);
    url.hash = "";
    if (senadoGacetaClient.allowedHosts.has(url.hostname)) {
      url.protocol = "https:";
      url.hostname = "www.senado.gob.mx";
    }
    return url.toString();
  } catch {
    return href;
  }
}

function isAllowedSenadoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return senadoGacetaClient.allowedHosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

function extractRawHtmlCandidates(html: string): string[] {
  const candidates = new Set<string>();
  const patterns = [
    /https?:\/\/(?:www\.)?senado\.gob\.mx\/66\/gaceta_del_senado\/documento\/\d+/gi,
    /https?:\/\/(?:www\.)?senado\.gob\.mx\/66\/gaceta_del_senado\/\d{4}_\d{2}_\d{2}\/\d+/gi,
    /\/66\/gaceta_del_senado\/documento\/\d+/gi,
    /\/66\/gaceta_del_senado\/\d{4}_\d{2}_\d{2}\/\d+/gi,
    /\/informacion\/gaceta\/documento\/\d+/gi,
    /\/informacion\/gaceta\/sesion\/\d+/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (match[0]) {
        candidates.add(match[0]);
      }
    }
  }

  return [...candidates];
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
