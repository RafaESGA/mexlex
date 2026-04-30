import type { SearchInitiativesResponse } from "@mexlex/shared/domain/search";
import type { LegislativeTimelineResponse } from "@mexlex/shared/domain/timeline";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type InitiativeFilters = {
  q?: string;
  status?: string;
  chamber?: string;
  dateFrom?: string;
  dateTo?: string;
  author?: string;
  commission?: string;
  limit?: number;
  offset?: number;
};

export type ScorecardCheck = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  count: number;
  threshold: number;
  description: string;
};

export type ReconciliationScorecard = {
  generatedAt: string;
  auditGeneratedAt: string;
  status: "pass" | "warn" | "fail";
  summary: {
    initiatives: number;
    authors: number;
    sourceLinks: number;
    eventRows: number;
  };
  blockers: ScorecardCheck[];
  warnings: ScorecardCheck[];
  checks: ScorecardCheck[];
};

export type AiChatResponse = {
  answer: string;
  model: string;
  toolCalls: Array<{
    name: string;
    arguments: unknown;
  }>;
};

export type AiChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function searchInitiatives(filters: InitiativeFilters): Promise<SearchInitiativesResponse> {
  return getJson<SearchInitiativesResponse>("/v1/initiatives", {
    limit: "50",
    offset: "0",
    ...toQuery(filters)
  });
}

export async function getLegislativeTimeline(initiativeId: string): Promise<LegislativeTimelineResponse> {
  return getJson<LegislativeTimelineResponse>("/v1/initiatives/timeline", { initiativeId });
}

export async function getReconciliationScorecard(): Promise<ReconciliationScorecard> {
  return getJson<ReconciliationScorecard>("/v1/reconciliation/scorecard");
}

export async function sendAiChat(message: string, history: AiChatHistoryMessage[] = []): Promise<AiChatResponse> {
  return postJson<AiChatResponse>("/v1/ai/chat", { message, history });
}

async function getJson<T>(path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(path, apiBaseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value.trim()) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function toQuery(filters: InitiativeFilters): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)])
  );
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const url = new URL(path, apiBaseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}
