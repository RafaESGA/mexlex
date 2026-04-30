type DuplicateCandidate = {
  initiativeId: string;
  canonicalTitle: string;
  titleNormalized: string;
  presentedAt: string | null;
  normalizedStatus: string;
  parser: string | null;
  sourcePriority: number;
  sourceSystems: string[];
  sourceLinkCount: number;
  eventCount: number;
  authorCount: number;
  commissionCount: number;
};

export type DuplicateCluster = {
  matchKey: string;
  candidates: DuplicateCandidate[];
};

export type DuplicateMergePlan = {
  matchKey: string;
  canonicalInitiativeId: string;
  canonicalTitle: string;
  confidence: number;
  reason: string[];
  duplicateInitiativeIds: string[];
};

const statusRank = new Map<string, number>([
  ["unknown", 0],
  ["draft", 1],
  ["presented", 2],
  ["in_commissions", 3],
  ["opinion_issued", 4],
  ["approved_origin", 5],
  ["approved_reviser", 6],
  ["approved_congress", 7],
  ["sent_executive", 8],
  ["published_dof", 9],
  ["rejected", 9],
  ["archived", 9],
  ["withdrawn", 9],
  ["expired", 9]
]);

export function buildDuplicateMergePlans(clusters: DuplicateCluster[]): DuplicateMergePlan[] {
  return clusters
    .map(buildDuplicateMergePlan)
    .filter((plan): plan is DuplicateMergePlan => plan !== null);
}

export function buildDuplicateMergePlan(cluster: DuplicateCluster): DuplicateMergePlan | null {
  if (cluster.candidates.length < 2) {
    return null;
  }

  const ranked = [...cluster.candidates].sort(compareDuplicateCandidates);
  const canonical = ranked[0];
  const duplicates = ranked.slice(1);

  if (!canonical || duplicates.length === 0) {
    return null;
  }

  const reasons: string[] = [];
  reasons.push(`parser=${canonical.parser ?? "unknown"}`);
  reasons.push(`sourcePriority=${canonical.sourcePriority}`);
  reasons.push(`status=${canonical.normalizedStatus}`);
  reasons.push(`links=${canonical.sourceLinkCount}`);
  reasons.push(`events=${canonical.eventCount}`);

  const second = ranked[1];
  const confidence = scoreCanonicalAdvantage(canonical, second);

  return {
    matchKey: cluster.matchKey,
    canonicalInitiativeId: canonical.initiativeId,
    canonicalTitle: canonical.canonicalTitle,
    confidence,
    reason: reasons,
    duplicateInitiativeIds: duplicates.map((candidate) => candidate.initiativeId)
  };
}

function compareDuplicateCandidates(left: DuplicateCandidate, right: DuplicateCandidate): number {
  if (left.sourcePriority !== right.sourcePriority) {
    return left.sourcePriority - right.sourcePriority;
  }

  const leftStatus = statusRank.get(left.normalizedStatus) ?? 0;
  const rightStatus = statusRank.get(right.normalizedStatus) ?? 0;
  if (leftStatus !== rightStatus) {
    return rightStatus - leftStatus;
  }

  if (left.sourceLinkCount !== right.sourceLinkCount) {
    return right.sourceLinkCount - left.sourceLinkCount;
  }

  if (left.eventCount !== right.eventCount) {
    return right.eventCount - left.eventCount;
  }

  if (left.authorCount !== right.authorCount) {
    return right.authorCount - left.authorCount;
  }

  if (left.commissionCount !== right.commissionCount) {
    return right.commissionCount - left.commissionCount;
  }

  if (left.parser !== right.parser) {
    return (left.parser ?? "").localeCompare(right.parser ?? "");
  }

  return left.initiativeId.localeCompare(right.initiativeId);
}

function scoreCanonicalAdvantage(best: DuplicateCandidate, next: DuplicateCandidate | undefined): number {
  if (!next) {
    return 0.99;
  }

  let score = 0.6;

  if (best.sourcePriority < next.sourcePriority) {
    score += 0.15;
  }

  if ((statusRank.get(best.normalizedStatus) ?? 0) > (statusRank.get(next.normalizedStatus) ?? 0)) {
    score += 0.1;
  }

  if (best.sourceLinkCount > next.sourceLinkCount) {
    score += 0.05;
  }

  if (best.eventCount > next.eventCount) {
    score += 0.05;
  }

  if (best.authorCount > next.authorCount || best.commissionCount > next.commissionCount) {
    score += 0.05;
  }

  return Number(Math.min(score, 0.99).toFixed(2));
}
