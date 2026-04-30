import { timelineService } from "../../modules/timeline/timeline.service.js";
import type { RequestLike } from "../routes/index.js";
import { getRequiredQueryParam } from "../request.js";

export const timelineController = {
  async getLegislativeTimeline(req: RequestLike) {
    return timelineService.getLegislativeTimeline(getRequiredQueryParam(req.url, "initiativeId"));
  }
};
