import { execFile } from "node:child_process";
import { promisify } from "node:util";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 3;
const execFileAsync = promisify(execFile);

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: { retries?: number; timeoutMs?: number }
): Promise<Response> {
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "user-agent": "mex-lex-sil-ingestor/1.0",
          accept: "text/html,application/xhtml+xml",
          ...(init?.headers ?? {})
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);

      if (shouldFallbackToCurl(error)) {
        return fetchWithCurl(url, timeoutMs);
      }

      lastError = error;

      if (attempt === retries) {
        break;
      }

      await delay(attempt * 500);
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  const errorCause =
    lastError instanceof Error && "cause" in lastError
      ? String((lastError as Error & { cause?: unknown }).cause ?? "")
      : "";

  throw new Error(
    `Failed to fetch ${url}: ${errorMessage}${errorCause ? ` | cause: ${errorCause}` : ""}`
  );
}

async function fetchWithCurl(url: string, timeoutMs: number): Promise<Response> {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const { stdout } = await execFileAsync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      String(timeoutSeconds),
      "--header",
      "User-Agent: mex-lex-sil-ingestor/1.0",
      "--header",
      "Accept: text/html,application/xhtml+xml",
      url
    ],
    {
      encoding: "buffer",
      maxBuffer: 10 * 1024 * 1024
    }
  );

  const html = decodeSilHtml(stdout);

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

function shouldFallbackToCurl(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const cause = "cause" in error ? String((error as Error & { cause?: unknown }).cause ?? "") : "";
  const combined = `${error.message} ${cause}`;

  return /UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate/i.test(combined);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeSilHtml(stdout: Buffer): string {
  try {
    return new TextDecoder("latin1").decode(stdout);
  } catch {
    return stdout.toString("latin1");
  }
}
