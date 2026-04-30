import type { QualityAuditReport } from "./quality-audit.js";

export type ReconciliationScorecard = {
  generatedAt: string;
  auditGeneratedAt: string;
  status: "pass" | "warn" | "fail";
  summary: {
    initiatives: number;
    authors: number;
    sourceLinks: number;
    eventRows: number;
  };
  blockers: ScorecardCheck[];
  warnings: ScorecardCheck[];
  checks: ScorecardCheck[];
};

export type ScorecardCheck = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  count: number;
  threshold: number;
  description: string;
};

export function buildReconciliationScorecard(report: QualityAuditReport): ReconciliationScorecard {
  const checks: ScorecardCheck[] = [
    failIfAboveZero(
      "duplicateInitiativeClusters",
      "Iniciativas duplicadas",
      report.checks.duplicateInitiativeClusters.count,
      "No deben quedar clusters de iniciativas duplicadas exactas."
    ),
    failIfAboveZero(
      "sourceConflicts",
      "Conflictos entre fuentes",
      report.checks.sourceConflicts.count,
      "No deben quedar iniciativas con conflicto entre fuentes enlazadas."
    ),
    failIfAboveZero(
      "primarySourceAnomalies",
      "Fuente primaria inconsistente",
      report.checks.primarySourceAnomalies.count,
      "Cada iniciativa con fuentes debe tener exactamente una fuente primaria."
    ),
    failIfAboveZero(
      "statusEventMismatches",
      "Estatus inconsistente con timeline",
      report.checks.statusEventMismatches.count,
      "El estatus actual debe coincidir con el evento legislativo más avanzado."
    ),
    failIfAboveZero(
      "presentationEventGaps",
      "Faltan eventos de presentación",
      report.checks.presentationEventGaps.count,
      "Toda iniciativa con fecha de presentación debe tener evento presentation."
    ),
    failIfAboveZero(
      "commissionNormalizationGaps",
      "Comisiones sin normalizar",
      report.checks.commissionNormalizationGaps.count,
      "Las comisiones crudas accionables deben estar normalizadas en initiative_commissions."
    ),
    warnIfAboveThreshold(
      "authorVariantClusters",
      "Variantes de autores para revisión",
      report.checks.authorVariantClusters.count,
      0,
      "Pueden quedar clusters complejos, pero deben revisarse antes de publicar análisis nominativo fino."
    )
  ];

  const blockers = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");

  return {
    generatedAt: new Date().toISOString(),
    auditGeneratedAt: report.generatedAt,
    status: blockers.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    summary: {
      initiatives: report.totals.initiatives,
      authors: report.totals.authors,
      sourceLinks: report.totals.sourceLinks,
      eventRows: report.totals.eventRows
    },
    blockers,
    warnings,
    checks
  };
}

function failIfAboveZero(key: string, label: string, count: number, description: string): ScorecardCheck {
  return {
    key,
    label,
    status: count > 0 ? "fail" : "pass",
    count,
    threshold: 0,
    description
  };
}

function warnIfAboveThreshold(
  key: string,
  label: string,
  count: number,
  threshold: number,
  description: string
): ScorecardCheck {
  return {
    key,
    label,
    status: count > threshold ? "warn" : "pass",
    count,
    threshold,
    description
  };
}
