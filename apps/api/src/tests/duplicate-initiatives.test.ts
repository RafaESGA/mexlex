import test from "node:test";
import assert from "node:assert/strict";
import { buildDuplicateMergePlan } from "../modules/reconciliation/duplicate-initiatives.js";

test("prefers richer higher-priority duplicate as canonical", () => {
  const plan = buildDuplicateMergePlan({
    matchKey: "ley|2025-01-01|senado",
    candidates: [
      {
        initiativeId: "i1",
        canonicalTitle: "Ley",
        titleNormalized: "ley",
        presentedAt: "2025-01-01",
        normalizedStatus: "unknown",
        parser: "senado-datos-abiertos-local-v1",
        sourcePriority: 40,
        sourceSystems: ["senado_transparencia"],
        sourceLinkCount: 1,
        eventCount: 0,
        authorCount: 1,
        commissionCount: 0
      },
      {
        initiativeId: "i2",
        canonicalTitle: "Ley",
        titleNormalized: "ley",
        presentedAt: "2025-01-01",
        normalizedStatus: "in_commissions",
        parser: "senado-transparencia-json-v1",
        sourcePriority: 20,
        sourceSystems: ["senado_transparencia"],
        sourceLinkCount: 2,
        eventCount: 2,
        authorCount: 2,
        commissionCount: 1
      }
    ]
  });

  assert.equal(plan?.canonicalInitiativeId, "i2");
  assert.deepEqual(plan?.duplicateInitiativeIds, ["i1"]);
  assert.equal(plan?.confidence, 0.99);
});
