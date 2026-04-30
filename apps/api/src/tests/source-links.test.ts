import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRankedSourceLink, pickPrimarySourceLink } from "../modules/reconciliation/source-links.js";

test("pickPrimarySourceLink prefers lower source priority first", () => {
  const selected = pickPrimarySourceLink([
    {
      linkId: "b",
      initiativeId: "i1",
      sourceRecordId: "sr2",
      sourceSystem: "senado_transparencia",
      sourcePriority: 30,
      confidence: 0.95,
      isPrimary: true
    },
    {
      linkId: "a",
      initiativeId: "i1",
      sourceRecordId: "sr1",
      sourceSystem: "sil",
      sourcePriority: 10,
      confidence: 0.8,
      isPrimary: false
    }
  ]);

  assert.equal(selected?.sourceSystem, "sil");
});

test("pickPrimarySourceLink breaks same-priority ties by confidence", () => {
  const selected = pickPrimarySourceLink([
    {
      linkId: "a",
      initiativeId: "i1",
      sourceRecordId: "sr1",
      sourceSystem: "gaceta_senado",
      sourcePriority: 20,
      confidence: 0.8,
      isPrimary: false
    },
    {
      linkId: "b",
      initiativeId: "i1",
      sourceRecordId: "sr2",
      sourceSystem: "gaceta_senado",
      sourcePriority: 20,
      confidence: 1,
      isPrimary: true
    }
  ]);

  assert.equal(selected?.linkId, "b");
});

test("normalizeRankedSourceLink extracts nested source metadata", () => {
  const normalized = normalizeRankedSourceLink({
    id: "l1",
    initiative_id: "i1",
    source_record_id: "sr1",
    confidence: 1,
    is_primary: false,
    source_records: {
      source_id: "s1",
      sources: {
        system: "sil",
        priority: 10
      }
    }
  });

  assert.deepEqual(normalized, {
    linkId: "l1",
    initiativeId: "i1",
    sourceRecordId: "sr1",
    sourceSystem: "sil",
    sourcePriority: 10,
    confidence: 1,
    isPrimary: false
  });
});
