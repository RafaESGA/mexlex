import test from "node:test";
import assert from "node:assert/strict";
import { buildQualityAuditReport } from "../modules/reconciliation/quality-audit.js";

test("flags duplicate initiatives and status mismatches in the audit report", () => {
  const report = buildQualityAuditReport({
    initiatives: [
      {
        id: "i1",
        canonicalTitle: "Ley de prueba",
        titleNormalized: "ley de prueba",
        presentedAt: "2026-01-01",
        normalizedStatus: "presented",
        originatingChamber: "senado",
        metadata: { parser: "senado-gaceta-document-local-v2", comision_turno: "Justicia" }
      },
      {
        id: "i2",
        canonicalTitle: "Ley de prueba",
        titleNormalized: "ley de prueba",
        presentedAt: "2026-01-01",
        normalizedStatus: "in_commissions",
        originatingChamber: "senado",
        metadata: { parser: "sil", comision_turno: "Cámara de Diputados." }
      }
    ],
    authors: [
      { id: "a1", fullName: "Saul Monreal Avila", nameNormalized: "saul monreal avila", chamber: "senado" },
      { id: "a2", fullName: "Saúl Monreal Ávila", nameNormalized: "saul monreal avila", chamber: "senado" }
    ],
    sources: [
      {
        initiativeId: "i1",
        sourceRecordId: "sr1",
        sourceSystem: "senado_transparencia",
        sourcePriority: 30,
        sourceUrl: "https://example.com/1",
        sourceTitle: "Ley de prueba",
        sourceStatus: "Pendiente",
        confidence: 0.9,
        isPrimary: false
      },
      {
        initiativeId: "i1",
        sourceRecordId: "sr2",
        sourceSystem: "sil",
        sourcePriority: 10,
        sourceUrl: "https://example.com/2",
        sourceTitle: "Ley de Prueba",
        sourceStatus: "Aprobada",
        confidence: 0.8,
        isPrimary: false
      }
    ],
    events: [
      {
        initiativeId: "i1",
        eventType: "approved_origin",
        eventDate: "2026-01-10T00:00:00Z",
        normalizedStatusAfter: "approved_origin"
      }
    ],
    commissions: [{ initiativeId: "i1", commissionCount: 1 }]
  });

  assert.equal(report.checks.duplicateInitiativeClusters.count, 1);
  assert.equal(report.checks.statusEventMismatches.count, 1);
  assert.equal(report.checks.statusBehindEvents.count, 1);
  assert.equal(report.checks.statusAheadOfEvents.count, 0);
  assert.equal(report.checks.commissionNormalizationGaps.count, 0);
  assert.equal(report.checks.sourceConflicts.count, 1);
  assert.equal(report.checks.primarySourceAnomalies.count, 1);
});
