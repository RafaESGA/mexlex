export function getRequiredQueryParam(urlValue: string | undefined, key: string): string {
  const url = new URL(urlValue ?? "", "http://localhost");
  const value = url.searchParams.get(key)?.trim();

  if (!value) {
    throw new Error(`Missing required query parameter: ${key}`);
  }

  return value;
}

export function getOptionalQueryParam(urlValue: string | undefined, key: string): string | undefined {
  const url = new URL(urlValue ?? "", "http://localhost");
  return url.searchParams.get(key)?.trim() || undefined;
}

export function getIntQueryParam(
  urlValue: string | undefined,
  key: string,
  defaultValue: number,
  bounds?: { min?: number; max?: number }
): number {
  const url = new URL(urlValue ?? "", "http://localhost");
  const raw = url.searchParams.get(key);
  const value = raw ? Number(raw) : defaultValue;

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric query parameter: ${key}`);
  }

  const min = bounds?.min ?? value;
  const max = bounds?.max ?? value;

  return Math.min(Math.max(value, min), max);
}

type ReadableRequest = AsyncIterable<Buffer | string>;

export async function readJsonBody<T>(req: unknown): Promise<T> {
  let rawBody = "";

  for await (const chunk of req as ReadableRequest) {
    rawBody += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }

  if (!rawBody.trim()) {
    throw new Error("Missing JSON request body");
  }

  return JSON.parse(rawBody) as T;
}
