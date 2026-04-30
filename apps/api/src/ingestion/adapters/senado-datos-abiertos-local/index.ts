import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeText } from "../../core/normalization.js";
import { sha256 } from "../../core/hashing.js";
import type { SenadoMappedInitiative } from "../senado-gaceta/types.js";

const execFileAsync = promisify(execFile);

export type SenadoDatosAbiertosRow = {
  id: string;
  titulo: string;
  fecha_presentacion: string;
  sentido_dictamen: string;
  url_gaceta: string;
  estado: string;
  sintesis: string;
  legislatura: string;
  senadores: string;
  comisiones: string;
  leyes_modifica: string;
  tipo: string;
  camara_origen: string;
  fecha_aprobacion: string;
};

export async function extractRowsFromSenadoDatosAbiertosDocx(filePath: string): Promise<SenadoDatosAbiertosRow[]> {
  const { stdout } = await execFileAsync("unzip", ["-p", filePath, "word/document.xml"], {
    maxBuffer: 16 * 1024 * 1024
  });

  const rawText = extractWordText(stdout);
  return parseSenadoDatosAbiertosJsonArray(rawText, filePath);
}

export async function extractRowsFromSenadoDatosAbiertosJson(filePath: string): Promise<SenadoDatosAbiertosRow[]> {
  const rawText = await readFile(filePath, "utf8");
  return parseSenadoDatosAbiertosJsonArray(rawText, filePath);
}

export function parseSenadoDatosAbiertosJsonArray(
  rawText: string,
  sourceLabel: string
): SenadoDatosAbiertosRow[] {
  const start = rawText.indexOf("[{");
  const end = rawText.lastIndexOf("}]");

  if (start === -1 || end === -1) {
    throw new Error(`Could not locate JSON array bounds in ${sourceLabel}`);
  }

  const payload = rawText.slice(start, end + 2);
  const parsed = JSON.parse(payload) as SenadoDatosAbiertosRow[];

  return parsed.filter((row) => normalizeText(row.tipo ?? "") === "iniciativa");
}

export function mapSenadoDatosAbiertosRow(
  row: SenadoDatosAbiertosRow,
  context: { sourceFilePath: string; rowIndex: number }
): SenadoMappedInitiative {
  const sourceUrl = buildSourceUrl(row.url_gaceta);
  const canonicalTitle = cleanText(row.titulo);
  const authors = extractAuthorsFromDatosAbiertos(row.senadores);
  const sourceRecordKey = sourceUrl
    ? `senado_datos_abiertos:${sourceUrl}`
    : `senado_datos_abiertos:fallback:${row.id}:${context.rowIndex}`;

  return {
    canonicalTitle,
    titleNormalized: normalizeText(canonicalTitle),
    summary: cleanText(row.sintesis) || null,
    presentedAt: normalizeDate(row.fecha_presentacion),
    rawStatus: cleanText(row.estado) || cleanText(row.sentido_dictamen) || null,
    chamber: "Cámara de Senadores",
    initiativeType: "Iniciativa",
    sourceUrl: sourceUrl || `local://senado-datos-abiertos/${encodeURIComponent(basename(context.sourceFilePath))}#${row.id}`,
    dedupeHash: sha256(JSON.stringify({ sourceRecordKey, row })),
    authors,
    rawHtml: JSON.stringify(row),
    metadata: {
      parser: "senado-datos-abiertos-local-v1",
      local_file_path: context.sourceFilePath,
      source_row_id: row.id,
      source_row_index: context.rowIndex,
      source_gaceta_id: cleanText(row.url_gaceta) || null,
      legislatura: cleanText(row.legislatura) || null,
      estado: cleanText(row.estado) || null,
      senadores_raw: row.senadores,
      comisiones_raw: row.comisiones,
      leyes_modifica_raw: row.leyes_modifica,
      camara_origen: cleanText(row.camara_origen) || null,
      fecha_aprobacion: normalizeDate(row.fecha_aprobacion),
      source_kind: "docx_json_export"
    },
    sourceRecordKey
  };
}

export function extractAuthorsFromDatosAbiertos(value: string): Array<{ fullName: string; role: string }> {
  const cleaned = decodeHtmlBreaks(decodeXmlEntities(value ?? ""));
  const seen = new Set<string>();

  return cleaned
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/^\s*(senadoras?|senadores?)\s+/i, "")
        .replace(/\s*\([^)]*\)\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((fullName) => fullName.length > 0)
    .map((fullName) => ({ fullName, role: "primary" }))
    .filter((author) => {
      const key = normalizeText(author.fullName);
      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

export function extractWordText(documentXml: string): string {
  const textSegments = [...documentXml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/gs)].map((match) => match[1] ?? "");
  return decodeXmlEntities(textSegments.join(""));
}

export function buildSourceUrl(urlGaceta: string): string | null {
  const cleaned = cleanText(urlGaceta);
  if (!cleaned) {
    return null;
  }

  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }

  if (/^\d+$/.test(cleaned)) {
    return `https://www.senado.gob.mx/66/gaceta_del_senado/documento/${cleaned}`;
  }

  return null;
}

export function normalizeDate(value: string): string | null {
  const cleaned = cleanText(value);
  if (!cleaned || cleaned === "0000-00-00") {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

export function cleanText(value: string | null | undefined): string {
  return decodeHtmlBreaks(decodeXmlEntities(value ?? "")).replace(/\s+/g, " ").trim();
}

function decodeHtmlBreaks(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;br\s*\/?&gt;/gi, "\n");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
