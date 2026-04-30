import test from "node:test";
import assert from "node:assert/strict";
import { buildReconciliationScorecard } from "../modules/reconciliation/scorecard.js";
import type { QualityAuditReport } from "../modules/reconciliation/quality-audit.js";

test("scorecard warns on remaining author variants without blockers", () => {
  const scorecard = buildReconciliationScorecard(makeReport({ authorVariantClusters: 3 }));

  assert.equal(scorecard.status, "warn");
  assert.equal(scorecard.blockers.length, 0);
  assert.equal(scorecard.warnings.length, 1);
  assert.equal(scorecard.warnings[0]?.key, "authorVariantClusters");
});

test("scorecard fails when structural blockers remain", () => {
  const scorecard = buildReconciliationScorecard(
    makeReport({
      duplicateInitiativeClusters: 1,
      primarySourceAnomalies: 2
    })
  );

  assert.equal(scorecard.status, "fail");
  assert.deepEqual(
    scorecard.blockers.map((check) => check.key),
    ["duplicateInitiativeClusters", "primarySourceAnomalies"]
  );
});

function makeReport(counts: Partial<Record<string, number>>): QualityAuditReport {
  return {
    generatedAt: "2026-04-23T00:00:00.000Z",
    totals: {
      initiatives: 10,
      authors: 5,
      sourceLinks: 10,
      eventRows: 20
    },
    coverage: {
      withPresentedAt: 10,
      withAuthorsRaw: 5,
      withSourceLinks: 10,
      withEvents: 10,
      withCommissions: 8
    },
    checks: {
      duplicateInitiativeClusters: check(counts.duplicateInitiativeClusters),
      authorVariantClusters: check(counts.authorVariantClusters),
      statusEventMismatches: check(counts.statusEventMismatches),
      statusAheadOfEvents: check(counts.statusAheadOfEvents),
      statusBehindEvents: check(counts.statusBehindEvents),
      presentationEventGaps: check(counts.presentationEventGaps),
      commissionNormalizationGaps: check(counts.commissionNormalizationGaps),
      sourceConflicts: check(counts.sourceConflicts),
      primarySourceAnomalies: check(counts.primarySourceAnomalies)
    }
  } as QualityAuditReport;
}

function check(count = 0) {
  return {
    count,
    sample: []
  };
}
