import type { CanonicalCandidate, InitiativeMatchDecision } from "@mexlex/shared/types/ingestion";

export function scoreInitiativeCandidate(candidate: CanonicalCandidate): InitiativeMatchDecision {
  const score =
    candidate.signals.titleSimilarity * 0.35 +
    candidate.signals.aliasSimilarity * 0.15 +
    candidate.signals.authorOverlap * 0.15 +
    candidate.signals.dateProximity * 0.15 +
    candidate.signals.chamberConsistency * 0.1 +
    candidate.signals.affectedNormOverlap * 0.1;

  if (score >= 0.85) {
    return { decision: "attach", confidence: score };
  }

  if (score >= 0.6) {
    return { decision: "review", confidence: score };
  }

  return { decision: "create", confidence: score };
}

