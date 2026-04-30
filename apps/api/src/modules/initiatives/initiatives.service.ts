import type { InitiativeDetail } from "@mexlex/shared/domain/initiative";
import { getInitiativeDetailRpc } from "../../db/queries/initiatives.queries.js";
import { NotFoundError } from "../../app/errors.js";
import { mapInitiativeDetailRow } from "./initiatives.mapper.js";

export const initiativesService = {
  async getInitiativeDetail(initiativeId: string): Promise<InitiativeDetail> {
    const row = await getInitiativeDetailRpc(initiativeId);

    if (!row) {
      throw new NotFoundError(`Initiative not found: ${initiativeId}`);
    }

    return mapInitiativeDetailRow(row);
  }
};
