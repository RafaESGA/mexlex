import test from "node:test";
import assert from "node:assert/strict";
import { scoreInitiativeCandidate } from "../modules/reconciliation/reconcile-initiative.js";

test("scores a strong candidate as attach", () => {
  const result = scoreInitiativeCandidate({
    source: "sil",
    entityType: "initiative",
    sourceRecordKey: "abc",
    payload: {},
    signals: {
      titleSimilarity: 0.95,
      aliasSimilarity: 0.9,
      authorOverlap: 0.8,
      dateProximity: 0.9,
      chamberConsistency: 1,
      affectedNormOverlap: 0.7
    }
  });

  assert.equal(result.decision, "attach");
});

