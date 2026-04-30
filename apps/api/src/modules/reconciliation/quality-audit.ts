import { normalizeText } from "../../ingestion/core/normalization.js";

export type InitiativeAuditRow = {
  id: string;
  canonicalTitle: string;
  titleNormalized: string;
  presentedAt: string | null;
  normalizedStatus: string;
  originatingChamber: string | null;
  metadata: Record<string, unknown>;
};

export type InitiativeSourceAuditRow = {
  initiativeId: string;
  sourceRecordId: string;
  sourceSystem: string;
  sourcePriority: number;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceStatus: string | null;
  confidence: number;
  isPrimary: boolean;
};

export type LegislativeEventAuditRow = {
  initiativeId: string;
  eventType: string;
  eventDate: string;
  normalizedStatusAfter: string | null;
};

export type InitiativeCommissionAuditRow = {
  initiativeId: string;
  commissionCount: number;
};

export type AuthorAuditRow = {
  id: string;
  fullName: string;
  nameNormalized: string;
  chamber: string | null;
};

export type QualityAuditReport = {
  generatedAt: string;
  totals: {
    initiatives: number;
    authors: number;
    sourceLinks: number;
    eventRows: number;
  };
  coverage: {
    withPresentedAt: number;
    withAuthorsRaw: number;
    withSourceLinks: number;
    withEvents: number;
    withCommissions: number;
  };
  checks: {
    duplicateInitiativeClusters: AuditCheck<DuplicateInitiativeCluster>;
    authorVariantClusters: AuditCheck<AuthorVariantCluster>;
    statusEventMismatches: AuditCheck<StatusEventMismatch>;
    statusAheadOfEvents: AuditCheck<StatusEventMismatch>;
    statusBehindEvents: AuditCheck<StatusEventMismatch>;
    presentationEventGaps: AuditCheck<PresentationGap>;
    commissionNormalizationGaps: AuditCheck<CommissionGap>;
    sourceConflicts: AuditCheck<SourceConflict>;
    primarySourceAnomalies: AuditCheck<PrimarySourceAnomaly>;
  };
};

export type AuditCheck<T> = {
  count: number;
  sample: T[];
};

export type DuplicateInitiativeCluster = {
  matchKey: string;
  initiatives: Array<{
    id: string;
    canonicalTitle: string;
    presentedAt: string | null;
    normalizedStatus: string;
    parser: string | null;
  }>;
};

export type AuthorVariantCluster = {
  looseKey: string;
  chamber: string | null;
  names: string[];
  authorIds: string[];
};

export type StatusEventMismatch = {
  initiativeId: string;
  canonicalTitle: string;
  initiativeStatus: string;
  latestEventType: string;
  latestEventDate: string;
  latestEventStatus: string;
  direction: "ahead" | "behind" | "incomparable";
};

export type PresentationGap = {
  initiativeId: string;
  canonicalTitle: string;
  presentedAt: string | null;
  parser: string | null;
};

export type CommissionGap = {
  initiativeId: string;
  canonicalTitle: string;
  parser: string | null;
  commissionRaw: string;
};

export type SourceConflict = {
  initiativeId: string;
  canonicalTitle: string;
  systems: string[];
  statuses: string[];
  titles: string[];
};

export type PrimarySourceAnomaly = {
  initiativeId: string;
  canonicalTitle: string;
  primaryCount: number;
  recommendedPrimarySystem: string | null;
  actualPrimarySystems: string[];
};

export function buildQualityAuditReport(input: {
  initiatives: InitiativeAuditRow[];
  sources: InitiativeSourceAuditRow[];
  events: LegislativeEventAuditRow[];
  commissions: InitiativeCommissionAuditRow[];
  authors: AuthorAuditRow[];
}): QualityAuditReport {
  const eventsByInitiative = groupBy(input.events, (row) => row.initiativeId);
  const sourcesByInitiative = groupBy(input.sources, (row) => row.initiativeId);
  const commissionsByInitiative = new Map(input.commissions.map((row) => [row.initiativeId, row.commissionCount]));

  const duplicateInitiativeClusters = findDuplicateInitiativeClusters(input.initiatives);
  const authorVariantClusters = findAuthorVariantClusters(input.authors);
  const statusEventMismatches = findStatusEventMismatches(input.initiatives, eventsByInitiative);
  const statusAheadOfEvents = statusEventMismatches.filter((row) => row.direction === "ahead");
  const statusBehindEvents = statusEventMismatches.filter((row) => row.direction === "behind");
  const presentationEventGaps = findPresentationEventGaps(input.initiatives, eventsByInitiative);
  const commissionNormalizationGaps = findCommissionNormalizationGaps(input.initiatives, commissionsByInitiative);
  const sourceConflicts = findSourceConflicts(input.initiatives, sourcesByInitiative);
  const primarySourceAnomalies = findPrimarySourceAnomalies(input.initiatives, sourcesByInitiative);

  const initiativesWithSourceLinks = input.initiatives.filter((row) => (sourcesByInitiative.get(row.id)?.length ?? 0) > 0).length;
  const initiativesWithEvents = input.initiatives.filter((row) => (eventsByInitiative.get(row.id)?.length ?? 0) > 0).length;
  const initiativesWithCommissions = input.initiatives.filter((row) => (commissionsByInitiative.get(row.id) ?? 0) > 0).length;
  const initiativesWithAuthorsRaw = input.initiatives.filter((row) => hasRawAuthors(row.metadata)).length;
  const initiativesWithPresentedAt = input.initiatives.filter((row) => Boolean(row.presentedAt)).length;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      initiatives: input.initiatives.length,
      authors: input.authors.length,
      sourceLinks: input.sources.length,
      eventRows: input.events.length
    },
    coverage: {
      withPresentedAt: initiativesWithPresentedAt,
      withAuthorsRaw: initiativesWithAuthorsRaw,
      withSourceLinks: initiativesWithSourceLinks,
      withEvents: initiativesWithEvents,
      withCommissions: initiativesWithCommissions
    },
    checks: {
      duplicateInitiativeClusters: toCheck(duplicateInitiativeClusters),
      authorVariantClusters: toCheck(authorVariantClusters),
      statusEventMismatches: toCheck(statusEventMismatches),
      statusAheadOfEvents: toCheck(statusAheadOfEvents),
      statusBehindEvents: toCheck(statusBehindEvents),
      presentationEventGaps: toCheck(presentationEventGaps),
      commissionNormalizationGaps: toCheck(commissionNormalizationGaps),
      sourceConflicts: toCheck(sourceConflicts),
      primarySourceAnomalies: toCheck(primarySourceAnomalies)
    }
  };
}

function findDuplicateInitiativeClusters(initiatives: InitiativeAuditRow[]): DuplicateInitiativeCluster[] {
  const groups = groupBy(initiatives, (row) =>
    [row.titleNormalized, row.presentedAt ?? "no-date", row.originatingChamber ?? "no-chamber"].join("|")
  );

  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([matchKey, rows]) => ({
      matchKey,
      initiatives: rows.map((row) => ({
        id: row.id,
        canonicalTitle: row.canonicalTitle,
        presentedAt: row.presentedAt,
        normalizedStatus: row.normalizedStatus,
        parser: readString(row.metadata, "parser")
      }))
    }))
    .sort((left, right) => right.initiatives.length - left.initiatives.length);
}

function findAuthorVariantClusters(authors: AuthorAuditRow[]): AuthorVariantCluster[] {
  const groups = groupBy(authors, (row) => `${buildLooseAuthorKey(row.fullName)}|${row.chamber ?? "no-chamber"}`);

  return [...groups.entries()]
    .map(([groupKey, rows]) => ({
      groupKey,
      rows
    }))
    .filter(({ rows }) => {
      const distinctNormalized = new Set(rows.map((row) => row.nameNormalized));
      const distinctDisplay = new Set(rows.map((row) => row.fullName));
      return rows.length > 1 && (distinctNormalized.size > 1 || distinctDisplay.size > 1);
    })
    .map(({ groupKey, rows }) => {
      const [looseKey = "", chamber = "no-chamber"] = groupKey.split("|");
      return {
        looseKey,
        chamber: chamber === "no-chamber" ? null : chamber,
        names: [...new Set(rows.map((row) => row.fullName))].sort(),
        authorIds: rows.map((row) => row.id)
      };
    })
    .sort((left, right) => right.names.length - left.names.length);
}

function findStatusEventMismatches(
  initiatives: InitiativeAuditRow[],
  eventsByInitiative: Map<string, LegislativeEventAuditRow[]>
): StatusEventMismatch[] {
  const mismatches: StatusEventMismatch[] = [];

  for (const initiative of initiatives) {
    const latest = getLatestEvent(eventsByInitiative.get(initiative.id) ?? []);
    if (!latest?.normalizedStatusAfter) {
      continue;
    }

    if (latest.normalizedStatusAfter === initiative.normalizedStatus) {
      continue;
    }

    mismatches.push({
      initiativeId: initiative.id,
      canonicalTitle: initiative.canonicalTitle,
      initiativeStatus: initiative.normalizedStatus,
      latestEventType: latest.eventType,
      latestEventDate: latest.eventDate,
      latestEventStatus: latest.normalizedStatusAfter,
      direction: compareStatuses(initiative.normalizedStatus, latest.normalizedStatusAfter)
    });
  }

  return mismatches;
}

function findPresentationEventGaps(
  initiatives: InitiativeAuditRow[],
  eventsByInitiative: Map<string, LegislativeEventAuditRow[]>
): PresentationGap[] {
  return initiatives
    .filter((initiative) => {
      if (!initiative.presentedAt) {
        return false;
      }

      const events = eventsByInitiative.get(initiative.id) ?? [];
      return !events.some((event) => event.eventType === "presentation");
    })
    .map((initiative) => ({
      initiativeId: initiative.id,
      canonicalTitle: initiative.canonicalTitle,
      presentedAt: initiative.presentedAt,
      parser: readString(initiative.metadata, "parser")
    }));
}

function findCommissionNormalizationGaps(
  initiatives: InitiativeAuditRow[],
  commissionsByInitiative: Map<string, number>
): CommissionGap[] {
  return initiatives
    .filter((initiative) => {
      if ((commissionsByInitiative.get(initiative.id) ?? 0) > 0) {
        return false;
      }

      return readActionableCommissionText(initiative.metadata).length > 0;
    })
    .map((initiative) => ({
      initiativeId: initiative.id,
      canonicalTitle: initiative.canonicalTitle,
      parser: readString(initiative.metadata, "parser"),
      commissionRaw: readActionableCommissionText(initiative.metadata)
    }));
}

function findSourceConflicts(
  initiatives: InitiativeAuditRow[],
  sourcesByInitiative: Map<string, InitiativeSourceAuditRow[]>
): SourceConflict[] {
  return initiatives
    .map((initiative) => {
      const rows = sourcesByInitiative.get(initiative.id) ?? [];
      const systems = [...new Set(rows.map((row) => row.sourceSystem))];
      const statuses = uniqueNormalized(rows.map((row) => row.sourceStatus));
      const titles = uniqueNormalized(rows.map((row) => row.sourceTitle));

      return {
        initiativeId: initiative.id,
        canonicalTitle: initiative.canonicalTitle,
        systems,
        statuses,
        titles
      };
    })
    .filter((row) => row.systems.length > 1 && (row.statuses.length > 1 || row.titles.length > 1));
}

function findPrimarySourceAnomalies(
  initiatives: InitiativeAuditRow[],
  sourcesByInitiative: Map<string, InitiativeSourceAuditRow[]>
): PrimarySourceAnomaly[] {
  return initiatives
    .map((initiative) => {
      const rows = sourcesByInitiative.get(initiative.id) ?? [];
      if (rows.length === 0) {
        return null;
      }

      const primaries = rows.filter((row) => row.isPrimary);
      const recommended = [...rows].sort((left, right) => {
        if (left.sourcePriority !== right.sourcePriority) {
          return left.sourcePriority - right.sourcePriority;
        }

        return right.confidence - left.confidence;
      })[0];

      const anomaly =
        primaries.length !== 1 || (primaries[0] && primaries[0].sourceSystem !== recommended?.sourceSystem);

      if (!anomaly) {
        return null;
      }

      return {
        initiativeId: initiative.id,
        canonicalTitle: initiative.canonicalTitle,
        primaryCount: primaries.length,
        recommendedPrimarySystem: recommended?.sourceSystem ?? null,
        actualPrimarySystems: primaries.map((row) => row.sourceSystem)
      };
    })
    .filter((row): row is PrimarySourceAnomaly => row !== null);
}

function getLatestEvent(events: LegislativeEventAuditRow[]): LegislativeEventAuditRow | null {
  if (events.length === 0) {
    return null;
  }

  return [...events].sort(compareEventsByProgress)[0] ?? null;
}

function compareEventsByProgress(left: LegislativeEventAuditRow, right: LegislativeEventAuditRow): number {
  const dateComparison = right.eventDate.localeCompare(left.eventDate);
  if (dateComparison !== 0) {
    return dateComparison;
  }

  const leftRank = statusRank.get(left.normalizedStatusAfter ?? "unknown") ?? -1;
  const rightRank = statusRank.get(right.normalizedStatusAfter ?? "unknown") ?? -1;
  if (leftRank !== rightRank) {
    return rightRank - leftRank;
  }

  return right.eventType.localeCompare(left.eventType);
}

function readRawCommissionText(metadata: Record<string, unknown>): string {
  return [
    readString(metadata, "comisiones_raw"),
    readString(metadata, "comision_turno"),
    readString(metadata, "commission_turno")
  ]
    .filter(Boolean)
    .join(" | ");
}

function readActionableCommissionText(metadata: Record<string, unknown>): string {
  return readRawCommissionText(metadata)
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !/^camara de diputados\.?$/i.test(normalizeText(value)))
    .join(" | ");
}

function hasRawAuthors(metadata: Record<string, unknown>): boolean {
  return Boolean(
    readString(metadata, "senadores_raw") ||
      readString(metadata, "cargo_proponente") ||
      readString(metadata, "authors_raw")
  );
}

function readString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildLooseAuthorKey(fullName: string): string {
  return normalizeText(fullName)
    .replace(/\b(sen|senadora|senador|dip|diputada|diputado)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(del|de|la|las|los)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const statusRank = new Map<string, number>([
  ["draft", 0],
  ["presented", 1],
  ["in_commissions", 2],
  ["opinion_issued", 3],
  ["approved_origin", 4],
  ["approved_reviser", 5],
  ["approved_congress", 6],
  ["sent_executive", 7],
  ["published_dof", 8],
  ["rejected", 8],
  ["archived", 8],
  ["withdrawn", 8],
  ["expired", 8],
  ["unknown", -1]
]);

function compareStatuses(current: string, latestEvent: string): "ahead" | "behind" | "incomparable" {
  const currentRank = statusRank.get(current) ?? -1;
  const latestRank = statusRank.get(latestEvent) ?? -1;

  if (currentRank === -1 || latestRank === -1) {
    return "incomparable";
  }

  if (currentRank > latestRank) {
    return "ahead";
  }

  return "behind";
}

function uniqueNormalized(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const key = normalizeText(value);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result.sort((left, right) => left.localeCompare(right));
}

function groupBy<T>(values: T[], getKey: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const value of values) {
    const key = getKey(value);
    const existing = grouped.get(key);

    if (existing) {
      existing.push(value);
    } else {
      grouped.set(key, [value]);
    }
  }

  return grouped;
}

function toCheck<T>(items: T[]): AuditCheck<T> {
  return {
    count: items.length,
    sample: items.slice(0, 20)
  };
}
