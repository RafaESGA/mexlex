import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { QualityAuditReport } from "./quality-audit.js";
import { buildReconciliationScorecard, type ReconciliationScorecard } from "./scorecard.js";

export const reconciliationScorecardService = {
  async getScorecard(reportFile = "reconciliation-quality-report.json"): Promise<ReconciliationScorecard> {
    const raw = await readFile(resolve(reportFile), "utf8");
    return buildReconciliationScorecard(JSON.parse(raw) as QualityAuditReport);
  }
};
