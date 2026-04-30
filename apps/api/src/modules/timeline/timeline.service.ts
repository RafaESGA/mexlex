import type { LegislativeTimelineResponse } from "@mexlex/shared/domain/timeline";
import { getLegislativeTimelineRpc } from "../../db/queries/timeline.queries.js";
import { mapTimelineRow } from "./timeline.mapper.js";

export const timelineService = {
  async getLegislativeTimeline(initiativeId: string): Promise<LegislativeTimelineResponse> {
    const rows = await getLegislativeTimelineRpc(initiativeId);

    return {
      initiativeId,
      events: rows.map(mapTimelineRow)
    };
  }
};
