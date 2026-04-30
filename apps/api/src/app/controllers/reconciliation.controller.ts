import { reconciliationScorecardService } from "../../modules/reconciliation/scorecard.service.js";

export const reconciliationController = {
  async getScorecard() {
    return reconciliationScorecardService.getScorecard();
  }
};
