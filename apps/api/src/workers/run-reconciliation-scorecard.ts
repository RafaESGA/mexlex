import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { QualityAuditReport } from "../modules/reconciliation/quality-audit.js";
import { buildReconciliationScorecard } from "../modules/reconciliation/scorecard.js";

async function main() {
  const reportFile = getStringArg("--report-file") ?? "reconciliation-quality-report.json";
  const outFile = getStringArg("--out-file");
  const report = JSON.parse(await readFile(resolve(reportFile), "utf8")) as QualityAuditReport;
  const scorecard = buildReconciliationScorecard(report);

  if (outFile) {
    await writeFile(resolve(outFile), JSON.stringify(scorecard, null, 2), "utf8");
  }

  console.log(JSON.stringify(scorecard, null, 2));

  if (process.argv.includes("--fail-on-blockers") && scorecard.status === "fail") {
    process.exitCode = 1;
  }
}

function getStringArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((value) => value === flag);
  return index === -1 ? undefined : args[index + 1];
}

void main().catch((error) => {
  console.error("Reconciliation scorecard failed", error);
  process.exitCode = 1;
});
