import type { SilDiscoveredPage, SilHtmlPage } from "../types.js";
import { silClient } from "../client.js";

export async function fetchSilInitiativePage(page: SilDiscoveredPage): Promise<SilHtmlPage> {
  const response = await silClient.getHtml(page.url);

  return {
    url: page.url,
    html: response.html,
    fetchedAt: response.fetchedAt,
    contentType: response.contentType,
    parentUrl: page.parentUrl
  };
}

