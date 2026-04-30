import test from "node:test";
import assert from "node:assert/strict";
import { buildSafeAuthorMergePlans, toAuthorMergeKey } from "../modules/reconciliation/author-merge.js";

test("accepts simple honorific variants for the same person", () => {
  const plans = buildSafeAuthorMergePlans([
    {
      looseKey: "saul monreal avila",
      chamber: "senado",
      confidence: 0.97,
      canonicalAuthorId: "a1",
      canonicalFullName: "Saúl Monreal Ávila",
      aliases: [
        { authorId: "a1", fullName: "Saúl Monreal Ávila", initiativeCount: 90 },
        { authorId: "a2", fullName: "Sen. Saúl Monreal Ávila", initiativeCount: 0 }
      ]
    }
  ]);

  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0]?.aliasAuthorIds, ["a2"]);
});

test("rejects list-like aliases that look like multiple people", () => {
  const plans = buildSafeAuthorMergePlans([
    {
      looseKey: "legisladoras legisladores",
      chamber: "senado",
      confidence: 0.95,
      canonicalAuthorId: "a1",
      canonicalFullName: "De legisladoras legisladores",
      aliases: [
        { authorId: "a1", fullName: "De legisladoras legisladores", initiativeCount: 2 },
        { authorId: "a2", fullName: "De las legisladoras los legisladores", initiativeCount: 2 }
      ]
    }
  ]);

  assert.equal(plans.length, 0);
});

test("normalizes party and honorific suffixes for merge keys", () => {
  assert.equal(toAuthorMergeKey("Sen. Virgilio Mendoza Amezcua"), "virgilio mendoza amezcua");
  assert.equal(toAuthorMergeKey("la diputada Noemí Berenice Luna Ayala"), "noemi berenice luna ayala");
  assert.equal(toAuthorMergeKey("Virgilio Mendoza Amezcua, PVEM"), "virgilio mendoza amezcua");
  assert.equal(toAuthorMergeKey("y los senadores"), null);
});
