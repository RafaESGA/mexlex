import { senadoGacetaClient } from "../client.js";
import type { SenadoDiscoveredPage, SenadoHtmlPage } from "../types.js";

export async function fetchSenadoGacetaPage(page: SenadoDiscoveredPage): Promise<SenadoHtmlPage> {
  const response = await senadoGacetaClient.getHtml(page.url);

  return {
    url: page.url,
    html: response.html,
    fetchedAt: response.fetchedAt,
    contentType: response.contentType,
    kind: page.kind,
    parentUrl: page.parentUrl,
    sessionDate: page.sessionDate ?? null
  };
}
