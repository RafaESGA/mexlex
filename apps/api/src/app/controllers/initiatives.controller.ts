import { initiativesService } from "../../modules/initiatives/initiatives.service.js";
import type { RequestLike } from "../routes/index.js";
import { getRequiredQueryParam } from "../request.js";

export const initiativesController = {
  async getInitiativeDetail(req: RequestLike) {
    const initiativeId = getRequiredQueryParam(req.url, "initiativeId");

    return initiativesService.getInitiativeDetail(initiativeId);
  }
};
