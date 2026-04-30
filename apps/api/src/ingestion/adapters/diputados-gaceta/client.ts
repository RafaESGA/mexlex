import { fetchWithRetry } from "../sil/fetchers/http.js";

export const diputadosGacetaClient = {
  source: "gaceta_diputados",
  baseUrl: "https://gaceta.diputados.gob.mx",
  discoveryUrls: [
    "https://gaceta.diputados.gob.mx/gp_iniciativas.html",
    "https://gaceta.diputados.gob.mx/base/inis/66/gp66_b_inis.html"
  ],
  async getHtml(url: string): Promise<{ html: string; fetchedAt: string; contentType: string }> {
    const response = await fetchWithRetry(url, undefined, {
      retries: 3,
      timeoutMs: 15_000
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const html = decodeDiputadosHtml(buffer, response.headers.get("content-type") ?? "");

    return {
      html,
      fetchedAt: new Date().toISOString(),
      contentType: response.headers.get("content-type") ?? "text/html"
    };
  }
} as const;

function decodeDiputadosHtml(buffer: Buffer, contentType: string): string {
  if (/charset=iso-8859-1|charset=latin1/i.test(contentType)) {
    return buffer.toString("latin1");
  }

  const utf8Text = buffer.toString("utf8");
  if (utf8LooksBroken(utf8Text)) {
    return buffer.toString("latin1");
  }

  return utf8Text;
}

function utf8LooksBroken(value: string): boolean {
  return /�|Comisi�n|C�digo|P�blica|Constituci�n|Cr�dito/i.test(value);
}
