import { fetchWithRetry } from "../sil/fetchers/http.js";

export const senadoGacetaClient = {
  source: "gaceta_senado",
  baseUrl: "https://www.senado.gob.mx",
  allowedHosts: new Set(["www.senado.gob.mx", "senado.gob.mx"]),
  discoveryUrls: [
    "https://www.senado.gob.mx/66/gaceta_del_senado",
    "https://www.senado.gob.mx/66/gaceta_del_senado/calendario"
  ],
  async getHtml(url: string): Promise<{ html: string; fetchedAt: string; contentType: string }> {
    const response = await fetchWithRetry(url, undefined, {
      retries: 3,
      timeoutMs: 15_000
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const html = decodeSenadoHtml(buffer, response.headers.get("content-type") ?? "");

    return {
      html,
      fetchedAt: new Date().toISOString(),
      contentType: response.headers.get("content-type") ?? "text/html"
    };
  }
} as const;

function decodeSenadoHtml(buffer: Buffer, contentType: string): string {
  if (/charset=iso-8859-1|charset=latin1/i.test(contentType)) {
    return buffer.toString("latin1");
  }

  const utf8Text = buffer.toString("utf8");
  if (/�|sesi�n|comisi�n|rep�blica/i.test(utf8Text)) {
    return buffer.toString("latin1");
  }

  return utf8Text;
}
