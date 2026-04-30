import * as cheerio from "cheerio";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AdapterCheckpoint,
  CanonicalCandidate,
  DiscoveredRecord,
  ParsedSourceRecord,
  RawFetchedArtifact
} from "@mexlex/shared/types/ingestion";
import type { SourceAdapter } from "../../core/adapter.js";
import { sha256 } from "../../core/hashing.js";
import { normalizeText } from "../../core/normalization.js";

const SENADO_TRANSPARENCIA_PAGE_URL =
  "https://transparenciaparlamentaria.senado.gob.mx/transparencia_parlamentaria/?a=data&c=iniciativas";
const SENADO_TRANSPARENCIA_JSON_BASE_URL =
  "https://transparenciaparlamentaria.senado.gob.mx/transparencia_parlamentaria/json/Iniciativas";
const execFileAsync = promisify(execFile);

type SenadoTransparenciaOptions = {
  years?: string[];
  maxYears?: number;
};

type SenadoTransparenciaJsonEnvelope = {
  identificadores?: Record<string, unknown>;
  data?: SenadoTransparenciaRow[];
};

type SenadoTransparenciaRow = {
  legislatura?: string;
  duracion_legislatura?: string;
  anio_legislativo?: string;
  periodo_sesiones?: string;
  inicio_periodo?: string;
  fin_periodo?: string;
  num_sesion?: string;
  num_gaceta?: string;
  fecha_documento?: string;
  tipo_documento?: string;
  titulo_docuemnto?: string;
  organo?: string;
  cargo_proponente?: string;
  link_documento?: string;
  comision_turno?: string;
  tema_documento?: string;
  prorroga?: string;
  sentido_dictamen?: string;
  fecha_dictamen?: string;
  link_dictamen?: string;
  nota?: string;
};

export { runSenadoTransparenciaIngestion } from "./service.js";

export const senadoTransparenciaAdapter: SourceAdapter = {
  source: "senado_transparencia",
  async discover(_checkpoint: AdapterCheckpoint): Promise<DiscoveredRecord[]> {
    return discoverSenadoTransparenciaRecords();
  },
  async fetch(record: DiscoveredRecord): Promise<RawFetchedArtifact[]> {
    const response = await fetchSenadoTransparenciaUrl(record.sourceUrl, "application/json,text/plain,*/*");

    return [
      {
        source: "senado_transparencia",
        recordKey: record.recordKey,
        sourceUrl: record.sourceUrl,
        mimeType: response.contentType ?? "application/json",
        body: response.body,
        fetchedAt: new Date().toISOString()
      }
    ];
  },
  async parse(raw: RawFetchedArtifact): Promise<ParsedSourceRecord[]> {
    const payload = JSON.parse(raw.body) as SenadoTransparenciaJsonEnvelope;
    const rows = payload.data ?? [];
    const year = extractYearFromJsonUrl(raw.sourceUrl);

    return rows
      .filter(isSenadoInitiativeRow)
      .map((row, index) => {
        const mapped = mapSenadoTransparenciaRow(row, {
          sourceJsonUrl: raw.sourceUrl,
          year,
          rowIndex: index
        });

        return {
          source: "senado_transparencia",
          recordType: "initiative_json",
          recordKey: mapped.sourceRecordKey,
          contentHash: mapped.dedupeHash,
          sourceUrl: mapped.sourceUrl,
          rawPayload: {
            row,
            source_json_url: raw.sourceUrl,
            source_year: year,
            fetched_at: raw.fetchedAt
          },
          parsedPayload: mapped
        };
      });
  },
  async map(parsed: ParsedSourceRecord): Promise<CanonicalCandidate[]> {
    if (parsed.recordType !== "initiative_json") {
      return [];
    }

    return [
      {
        source: "senado_transparencia",
        entityType: "initiative",
        sourceRecordKey: parsed.recordKey,
        payload: parsed.parsedPayload,
        signals: {
          titleSimilarity: 1,
          aliasSimilarity: 0,
          authorOverlap: 0,
          dateProximity: 1,
          chamberConsistency: 1,
          affectedNormOverlap: 0
        }
      }
    ];
  }
};

export async function discoverSenadoTransparenciaRecords(
  options: SenadoTransparenciaOptions = {}
): Promise<DiscoveredRecord[]> {
  const years = options.years ?? (await discoverAvailableSenadoTransparenciaYears());
  const limitedYears = typeof options.maxYears === "number" ? years.slice(0, options.maxYears) : years;

  return limitedYears.map((year) => ({
    source: "senado_transparencia",
    recordKey: `senado_transparencia:json:${year}`,
    sourceUrl: buildSenadoTransparenciaJsonUrl(year),
    discoveredAt: new Date().toISOString()
  }));
}

export async function discoverAvailableSenadoTransparenciaYears(): Promise<string[]> {
  const response = await fetchSenadoTransparenciaUrl(SENADO_TRANSPARENCIA_PAGE_URL, "text/html,application/xhtml+xml");
  const html = response.body;
  const $ = cheerio.load(html);
  const years = $("#slt_ejercicio option")
    .toArray()
    .map((option) => $(option).attr("value")?.trim() ?? "")
    .filter((value) => /^\d{4}$/.test(value));

  return years.sort((left, right) => right.localeCompare(left));
}

function buildSenadoTransparenciaJsonUrl(year: string): string {
  return `${SENADO_TRANSPARENCIA_JSON_BASE_URL}/iniciativas_proposiciones_${year}.json`;
}

function extractYearFromJsonUrl(url: string): string {
  const match = url.match(/iniciativas_proposiciones_(\d{4})\.json/i);
  return match?.[1] ?? "unknown";
}

function isSenadoInitiativeRow(row: SenadoTransparenciaRow): boolean {
  const tipo = normalizeText(row.tipo_documento ?? "");
  const organo = normalizeText(row.organo ?? "");

  return tipo.startsWith("iniciativa") && organo.includes("senadores");
}

function mapSenadoTransparenciaRow(
  row: SenadoTransparenciaRow,
  context: { sourceJsonUrl: string; year: string; rowIndex: number }
): Record<string, unknown> {
  const canonicalTitle = cleanTitle(row.titulo_docuemnto ?? "");
  const presentedAt = toIsoDate(row.fecha_documento ?? null);
  const authors = extractAuthorsFromSenadoTransparenciaProponentes(row.cargo_proponente ?? "");
  const sourceUrl = row.link_documento?.trim() || context.sourceJsonUrl;
  const sourceRecordKey = buildSourceRecordKey({
    sourceUrl,
    title: canonicalTitle,
    presentedAt,
    rowIndex: context.rowIndex
  });

  return {
    canonicalTitle,
    titleNormalized: normalizeText(canonicalTitle),
    summary: cleanOptionalText(row.tema_documento) ?? cleanOptionalText(row.nota),
    presentedAt,
    rawStatus: cleanOptionalText(row.sentido_dictamen) ?? cleanOptionalText(row.nota),
    chamber: "Cámara de Senadores",
    initiativeType: cleanOptionalText(row.tipo_documento) ?? "Iniciativa",
    sourceUrl,
    dedupeHash: sha256(JSON.stringify({ sourceRecordKey, row })),
    authors,
    rawHtml: JSON.stringify(row),
    metadata: {
      parser: "senado-transparencia-json-v1",
      source_json_url: context.sourceJsonUrl,
      source_year: context.year,
      source_row_index: context.rowIndex,
      legislatura: cleanOptionalText(row.legislatura),
      legislatura_duracion: cleanOptionalText(row.duracion_legislatura),
      anio_legislativo: cleanOptionalText(row.anio_legislativo),
      periodo_sesiones: cleanOptionalText(row.periodo_sesiones),
      inicio_periodo: cleanOptionalText(row.inicio_periodo),
      fin_periodo: cleanOptionalText(row.fin_periodo),
      num_sesion: cleanOptionalText(row.num_sesion),
      num_gaceta: cleanOptionalText(row.num_gaceta),
      organo: cleanOptionalText(row.organo),
      cargo_proponente: cleanOptionalText(row.cargo_proponente),
      comision_turno: cleanOptionalText(row.comision_turno),
      prorroga: cleanOptionalText(row.prorroga),
      fecha_dictamen: cleanOptionalText(row.fecha_dictamen),
      link_dictamen: cleanOptionalText(row.link_dictamen),
      nota: cleanOptionalText(row.nota)
    },
    sourceRecordKey
  };
}

function buildSourceRecordKey(input: {
  sourceUrl: string;
  title: string;
  presentedAt: string | null;
  rowIndex: number;
}): string {
  if (input.sourceUrl && input.sourceUrl !== SENADO_TRANSPARENCIA_PAGE_URL) {
    return `senado_transparencia:${input.sourceUrl}`;
  }

  return `senado_transparencia:fallback:${normalizeText(input.title)}:${input.presentedAt ?? "no-date"}:${input.rowIndex}`;
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/\.$/, "");
}

function cleanOptionalText(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : null;
}

export function extractAuthorsFromSenadoTransparenciaProponentes(
  value: string
): Array<{ fullName: string; role: string }> {
  const cleaned = cleanOptionalText(value);
  if (!cleaned) {
    return [];
  }

  const collectiveNames = tryExtractCollectiveAuthors(cleaned);
  if (collectiveNames.length > 0) {
    return dedupeAuthors(collectiveNames);
  }

  const expanded = cleaned
    .replace(/\s+y\s+suscrita\s+por\s+la\s+sen\.\s+/gi, ", Sen. ")
    .replace(/\s+y\s+suscrito\s+por\s+el\s+sen\.\s+/gi, ", Sen. ")
    .replace(/\s+y\s+suscrita\s+por\s+el\s+sen\.\s+/gi, ", Sen. ")
    .replace(/\s+y\s+suscrito\s+por\s+la\s+sen\.\s+/gi, ", Sen. ")
    .replace(/\s+y\s+suscrita\s+por\s+la\s+senadora\s+/gi, ", Senadora ")
    .replace(/\s+y\s+suscrito\s+por\s+el\s+senador\s+/gi, ", Senador ")
    .replace(/\s+y\s+suscrita\s+por\s+el\s+senador\s+/gi, ", Senador ")
    .replace(/\s+y\s+suscrito\s+por\s+la\s+senadora\s+/gi, ", Senadora ")
    .replace(/\s+y\s+suscrita\s+por\s+la\s+dip\.\s+/gi, ", Dip. ")
    .replace(/\s+y\s+suscrito\s+por\s+el\s+dip\.\s+/gi, ", Dip. ")
    .replace(/\s+y\s+suscrita\s+por\s+la\s+diputada\s+/gi, ", Diputada ")
    .replace(/\s+y\s+suscrito\s+por\s+el\s+diputado\s+/gi, ", Diputado ");

  const names = [
    ...expanded.matchAll(
      /\b(?:Del\s+)?(?:De\s+la\s+)?(?:Sen\.|Senadora|Senador|Dip\.|Diputada|Diputado)\s+([^.;]+?)(?=(?:,\s*(?:Sen\.|Senadora|Senador|Dip\.|Diputada|Diputado)\s)|(?:\s+y\s+(?:Sen\.|Senadora|Senador|Dip\.|Diputada|Diputado)\s)|(?:\.\s*(?:MORENA|PAN|PRI|PVEM|PT|MC|PRD|PES|Sin Grupo Parlamentario|Congresos Locales)\b)|$)/gi
    )
  ]
    .flatMap((match) => splitCompoundAuthorSegment(match[1] ?? ""))
    .map((part) => cleanAuthorName(part))
    .filter(Boolean);

  if (names.length > 0) {
    return dedupeAuthors(names);
  }

  return [
    {
      fullName: cleanAuthorName(cleaned),
      role: "primary"
    }
  ].filter((author) => author.fullName);
}

function cleanAuthorName(value: string): string {
  return value
    .replace(/^\s*(del|de la)\s+/i, "")
    .replace(/^\s*de las senadoras y los senadores\s+/i, "")
    .replace(/^\s*de las senadoras y senadores\s+/i, "")
    .replace(/^\s*de las senadoras y de los senadores\s+/i, "")
    .replace(/^\s*de los senadores y las senadoras\s+/i, "")
    .replace(/^\s*de las senadoras\s+/i, "")
    .replace(/^\s*de los senadores\s+/i, "")
    .replace(/^\s*las senadoras y los senadores\s+/i, "")
    .replace(/^\s*las senadoras y senadores\s+/i, "")
    .replace(/^\s*las senadoras y de los senadores\s+/i, "")
    .replace(/^\s*senadoras y los senadores\s+/i, "")
    .replace(/^\s*senadoras y senadores\s+/i, "")
    .replace(/^\s*senadoras y de los senadores\s+/i, "")
    .replace(/^\s*sen\.\s*/i, "")
    .replace(/^\s*senador(?:a)?\s+/i, "")
    .replace(/^\s*dip\.\s*/i, "")
    .replace(/^\s*diputad[oa]\s+/i, "")
    .replace(/\s*,?\s*del Grupo Parlamentario.*$/i, "")
    .replace(/\s*,?\s*del partido .*$/i, "")
    .replace(/\s*,?\s*del grupo .*$/i, "")
    .replace(/\s*,?\s*(MORENA|PAN|PRI|PVEM|PT|MC|PRD|PES|Sin Grupo Parlamentario|Congresos Locales)\s*$/i, "")
    .replace(/\s+y\s+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

function tryExtractCollectiveAuthors(value: string): string[] {
  const collectiveMatch = value.match(
    /^\s*de\s+las?\s+senadoras?\s+y\s+(?:de\s+los\s+)?senadores?\s+(.+?)(?:(?:,\s*del\s+Grupo\s+Parlamentario.*)|(?:\.\s*(?:MORENA|PAN|PRI|PVEM|PT|MC|PRD|PES)\b)|$)/i
  );

  if (!collectiveMatch?.[1]) {
    return [];
  }

  const expanded = collectiveMatch[1]
    .replace(/\s+y\s+suscrita\s+por\s+la\s+sen\.\s+/gi, ", ")
    .replace(/\s+y\s+suscrito\s+por\s+el\s+sen\.\s+/gi, ", ")
    .replace(/\s+y\s+suscrita\s+por\s+la\s+senadora\s+/gi, ", ")
    .replace(/\s+y\s+suscrito\s+por\s+el\s+senador\s+/gi, ", ")
    .replace(/\s*,\s*y\s+/gi, ", ")
    .replace(/\s+y\s+/gi, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return expanded
    .split(/\s*,\s*/)
    .map((part) => cleanAuthorName(part))
    .filter(Boolean);
}

function splitCompoundAuthorSegment(value: string): string[] {
  const cleaned = value
    .replace(/\s+y\s+la\s+sen\.\s+/gi, ", ")
    .replace(/\s+y\s+el\s+sen\.\s+/gi, ", ")
    .replace(/\s+y\s+la\s+senadora\s+/gi, ", ")
    .replace(/\s+y\s+el\s+senador\s+/gi, ", ")
    .replace(/\s+y\s+la\s+dip\.\s+/gi, ", ")
    .replace(/\s+y\s+el\s+dip\.\s+/gi, ", ")
    .replace(/\s+y\s+la\s+diputada\s+/gi, ", ")
    .replace(/\s+y\s+el\s+diputado\s+/gi, ", ")
    .replace(/\s*,\s*y\s+/gi, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function dedupeAuthors(names: string[]): Array<{ fullName: string; role: string }> {
  const seen = new Set<string>();

  return names
    .map((fullName) => ({
      fullName,
      role: "primary"
    }))
    .filter((author) => {
      const key = normalizeText(author.fullName);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function toIsoDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

async function fetchSenadoTransparenciaUrl(
  url: string,
  accept: string
): Promise<{ body: string; contentType: string | null }> {
  try {
    const response = await fetch(url, {
      headers: {
        accept,
        "user-agent": "Mozilla/5.0 (compatible; mex-lex/0.1; +https://github.com/)"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return {
      body: await response.text(),
      contentType: response.headers.get("content-type")
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isRetryableViaCurl(message)) {
      throw error;
    }

    const { stdout } = await execFileAsync("curl", [
      "--http1.1",
      "-L",
      "-sS",
      "-H",
      `Accept: ${accept}`,
      "-H",
      "User-Agent: Mozilla/5.0 (compatible; mex-lex/0.1; +https://github.com/)",
      url
    ], {
      maxBuffer: 16 * 1024 * 1024
    });

    return {
      body: stdout,
      contentType: null
    };
  }
}

function isRetryableViaCurl(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unable to verify the first certificate") ||
    normalized.includes("leaf signature") ||
    normalized.includes("fetch failed") ||
    normalized.includes("enotfound")
  );
}
