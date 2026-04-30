import { requireEnv } from "../../config/env.js";
import { initiativesService } from "../initiatives/initiatives.service.js";
import { reconciliationScorecardService } from "../reconciliation/scorecard.service.js";
import { searchService } from "../search/search.service.js";
import { timelineService } from "../timeline/timeline.service.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY_MESSAGES = 10;
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

type ChatInput = {
  message: string;
  history?: ChatHistoryMessage[];
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  answer: string;
  model: string;
  toolCalls: Array<{
    name: string;
    arguments: unknown;
  }>;
};

type OpenAIResponse = {
  output_text?: string;
  output?: OpenAIOutputItem[];
};

type OpenAIOutputItem =
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "message";
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }
  | Record<string, unknown>;

type ToolCall = Extract<OpenAIOutputItem, { type: "function_call" }>;

export const legislativeAgentService = {
  async chat(input: ChatInput): Promise<ChatResponse> {
    const message = input.message.trim();
    if (!message) {
      throw new Error("Message is required");
    }

    const apiKey = requireEnv(process.env.OPENAI_API_KEY ?? "", "OPENAI_API_KEY");
    const toolCalls: ChatResponse["toolCalls"] = [];
    const toolResults: unknown[] = [];
    let forcedToolRetry = false;
    let responseInput: unknown[] = [
      ...toOpenAIHistory(input.history ?? []),
      {
        role: "user",
        content: message
      }
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await createResponse(apiKey, responseInput);
      const output = response.output ?? [];
      const calls = output.filter(isFunctionCall);

      if (calls.length === 0) {
        if (!forcedToolRetry && requiresInitiativeSearch(message)) {
          forcedToolRetry = true;
          responseInput = [
            ...responseInput,
            {
              role: "user",
              content:
                "Antes de responder, usa search_initiatives con los filtros adecuados para esta pregunta. No respondas con conocimiento general ni con el historial."
            }
          ];
          continue;
        }

        const answer = response.output_text ?? extractText(output) ?? "No pude generar una respuesta.";
        if (hasContradictoryNoResultsAnswer(answer, toolResults)) {
          return {
            answer:
              "Encontré resultados en la base, pero la respuesta generada fue inconsistente. Intenta la consulta de nuevo o acótala por fecha, cámara o tema mientras ajusto esta validación.",
            model: DEFAULT_MODEL,
            toolCalls
          };
        }

        return {
          answer,
          model: DEFAULT_MODEL,
          toolCalls
        };
      }

      const toolOutputs = await Promise.all(
        calls.map(async (call) => {
          const parsedArguments = parseToolArguments(call.arguments);
          toolCalls.push({ name: call.name, arguments: parsedArguments });
          const result = await callTool(call.name, parsedArguments, message);
          toolResults.push(result);

          return {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result)
          };
        })
      );

      responseInput = [...responseInput, ...output, ...toolOutputs];
    }

    return {
      answer: "La consulta necesitó demasiados pasos. Intenta acotarla por autor, tema, fecha o estatus.",
      model: DEFAULT_MODEL,
      toolCalls
    };
  }
};

async function createResponse(apiKey: string, input: unknown[]): Promise<OpenAIResponse> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      instructions: buildInstructions(),
      input,
      tools
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI Responses API failed (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<OpenAIResponse>;
}

const tools = [
  {
    type: "function",
    name: "search_initiatives",
    description: "Busca iniciativas legislativas por texto, autor, comision, camara, estatus o fecha.",
    parameters: {
      type: "object",
      properties: {
        q: { type: "string", description: "Texto libre, tema, titulo parcial o concepto legislativo." },
        author: { type: "string", description: "Nombre parcial o completo del autor o legislador." },
        commission: { type: "string", description: "Nombre parcial de comision." },
        status: { type: "string", description: "Estatus normalizado, por ejemplo presented o in_commissions." },
        chamber: { type: "string", description: "Camara de origen, por ejemplo senado o diputados." },
        dateFrom: { type: "string", description: "Fecha minima YYYY-MM-DD." },
        dateTo: { type: "string", description: "Fecha maxima YYYY-MM-DD." },
        limit: { type: "number", description: "Maximo de resultados. Usa 5 por defecto y no mas de 10." }
      },
      required: [],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_initiative_detail",
    description: "Obtiene detalle completo de una iniciativa por id.",
    parameters: {
      type: "object",
      properties: {
        initiativeId: { type: "string", description: "UUID interno de la iniciativa." }
      },
      required: ["initiativeId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_legislative_timeline",
    description: "Obtiene eventos legislativos y fuentes de una iniciativa por id.",
    parameters: {
      type: "object",
      properties: {
        initiativeId: { type: "string", description: "UUID interno de la iniciativa." }
      },
      required: ["initiativeId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_reconciliation_scorecard",
    description: "Consulta el scorecard de calidad y reconciliacion del dataset.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  }
] as const;

async function callTool(name: string, args: Record<string, unknown>, userMessage: string): Promise<unknown> {
  if (name === "search_initiatives") {
    const limit = Math.min(Number(args.limit ?? 5), 10);
    const shouldUseDateFilters = hasExplicitDateConstraint(userMessage);
    return searchService.searchInitiatives({
      query: stringArg(args.q),
      author: stringArg(args.author),
      commission: stringArg(args.commission),
      status: stringArg(args.status),
      chamber: stringArg(args.chamber),
      dateFrom: shouldUseDateFilters ? stringArg(args.dateFrom) : undefined,
      dateTo: shouldUseDateFilters ? stringArg(args.dateTo) : undefined,
      limit,
      offset: 0
    });
  }

  if (name === "get_initiative_detail") {
    return initiativesService.getInitiativeDetail(requiredStringArg(args.initiativeId, "initiativeId"));
  }

  if (name === "get_legislative_timeline") {
    return timelineService.getLegislativeTimeline(requiredStringArg(args.initiativeId, "initiativeId"));
  }

  if (name === "get_reconciliation_scorecard") {
    return reconciliationScorecardService.getScorecard();
  }

  return { error: `Unknown tool: ${name}` };
}

function isFunctionCall(item: OpenAIOutputItem): item is ToolCall {
  return item.type === "function_call";
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredStringArg(value: unknown, name: string): string {
  const parsed = stringArg(value);
  if (!parsed) {
    throw new Error(`Missing required tool argument: ${name}`);
  }

  return parsed;
}

function buildInstructions(): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "Eres MexLex, un analista legislativo mexicano. Responde en español claro.",
    `Fecha actual del sistema: ${today}. No inventes otra fecha actual.`,
    "No inventes datos: usa las herramientas disponibles para buscar iniciativas, autores, detalles, timelines y calidad del dataset.",
    "El historial del chat puede contener respuestas previas incorrectas; no lo uses como fuente de verdad si contradice las herramientas.",
    "Para preguntas que pidan buscar, encontrar, listar, contar o filtrar iniciativas, autores o proponentes, llama search_initiatives antes de responder.",
    "No agregues filtros de fecha por el historial ni por tu conocimiento general; solo usa dateFrom/dateTo si el mensaje actual del usuario pide explicitamente una fecha, año, periodo o legislatura.",
    "Cuando el usuario diga Poder Ejecutivo, Ejecutivo Federal o Presidenta/Presidente como proponente, busca con author='Ejecutivo Federal'.",
    "Cuando menciones una iniciativa, incluye titulo, fecha y estatus.",
    "Si el usuario pide fuente, evidencia, enlace, autor exacto o detalles, primero llama get_initiative_detail para las iniciativas relevantes antes de responder.",
    "Si el usuario pide cronologia o que paso con una iniciativa, llama get_legislative_timeline.",
    "Si no hay evidencia suficiente despues de usar herramientas, dilo."
  ].join(" ");
}

function hasExplicitDateConstraint(message: string): boolean {
  const normalized = message
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  return /\b(19|20)\d{2}\b|\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b|\b(desde|hasta|entre|periodo|legislatura|fecha|ano|anio|mes|dia|hoy|ayer|reciente|recientes|actual)\b/.test(
    normalized
  );
}

function requiresInitiativeSearch(message: string): boolean {
  const normalized = message
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  return (
    /\b(busca|buscar|encuentra|encontrar|lista|listar|cuantas|cuantos|filtra|filtrar|presentadas?|iniciativas?)\b/.test(
      normalized
    ) &&
    /\b(iniciativa|iniciativas|autor|autores|proponente|proponentes|ejecutivo|senador|senadora|diputado|diputada)\b/.test(
      normalized
    )
  );
}

function hasContradictoryNoResultsAnswer(answer: string, toolResults: unknown[]): boolean {
  const normalized = answer
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (!/(no se encontraron|no encontre|no se han registrado|no hay iniciativas)/.test(normalized)) {
    return false;
  }

  return toolResults.some((result) => {
    if (!result || typeof result !== "object" || !("results" in result)) {
      return false;
    }

    const results = (result as { results?: unknown }).results;
    return Array.isArray(results) && results.length > 0;
  });
}

function extractText(output: OpenAIOutputItem[]): string | undefined {
  return output
    .flatMap((item) => (item.type === "message" ? (item.content ?? []).map((content) => content.text).filter(Boolean) : []))
    .join("\n")
    .trim();
}

function toOpenAIHistory(history: ChatHistoryMessage[]): unknown[] {
  return history
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000)
    }));
}
