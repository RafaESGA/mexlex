import { readJsonBody } from "../request.js";
import type { RequestLike } from "../routes/index.js";
import { legislativeAgentService, type ChatHistoryMessage } from "../../modules/ai/legislative-agent.service.js";

export const aiController = {
  async chat(req: RequestLike) {
    const body = await readJsonBody<{ message?: string; history?: ChatHistoryMessage[] }>(req);

    return legislativeAgentService.chat({
      message: body.message ?? "",
      history: body.history
    });
  }
};
