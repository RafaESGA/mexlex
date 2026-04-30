import { diputadosGacetaClient } from "../client.js";
import type { DiputadosDiscoveredPage, DiputadosHtmlPage } from "../types.js";

export async function fetchDiputadosGacetaInitiativePage(page: DiputadosDiscoveredPage): Promise<DiputadosHtmlPage> {
  const response = await diputadosGacetaClient.getHtml(page.url);

  return {
    url: page.url,
    html: response.html,
    fetchedAt: response.fetchedAt,
    contentType: response.contentType,
    parentUrl: page.parentUrl
  };
}

