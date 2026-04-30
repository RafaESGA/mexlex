import { aiController } from "../controllers/ai.controller.js";
import { initiativesController } from "../controllers/initiatives.controller.js";
import { reconciliationController } from "../controllers/reconciliation.controller.js";
import { searchController } from "../controllers/search.controller.js";
import { timelineController } from "../controllers/timeline.controller.js";

type RouteHandler = (req: RequestLike) => Promise<unknown>;

export type RequestLike = {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};

export function registerRoutes(): Record<string, RouteHandler> {
  return {
    "GET /health": async () => ({ ok: true }),
    "GET /v1/initiatives": searchController.searchInitiatives,
    "GET /v1/initiatives/detail": initiativesController.getInitiativeDetail,
    "GET /v1/initiatives/timeline": timelineController.getLegislativeTimeline,
    "GET /v1/authors/search": searchController.searchByAuthor,
    "GET /v1/topics/search": searchController.searchByTopic,
    "GET /v1/reconciliation/scorecard": reconciliationController.getScorecard,
    "POST /v1/ai/chat": aiController.chat
  };
}
