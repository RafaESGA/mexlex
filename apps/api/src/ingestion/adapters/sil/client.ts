import { loadEnv } from "../../../config/env.js";
import { fetchWithRetry } from "./fetchers/http.js";

const env = loadEnv();

export const silClient = {
  source: "sil",
  baseUrl: "https://sil.gobernacion.gob.mx",
  discoveryUrls: env.silDiscoveryUrls,
  async getHtml(url: string): Promise<{ html: string; fetchedAt: string; contentType: string }> {
    const response = await fetchWithRetry(url, undefined, {
      retries: 3,
      timeoutMs: 15_000
    });

    return {
      html: await response.text(),
      fetchedAt: new Date().toISOString(),
      contentType: response.headers.get("content-type") ?? "text/html"
    };
  }
} as const;
