import { supabaseAdmin } from "../db/supabase.js";

type InitiativeRow = {
  id: string;
  canonical_title: string;
  normalized_status: string;
};

type EventRow = {
  initiative_id: string;
  event_type: string;
  event_date: string;
  normalized_status_after: string | null;
};

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

async function main() {
  const apply = process.argv.includes("--apply");
  const initiatives = await fetchUnknownInitiatives();
  const eventsByInitiative = groupBy(await fetchEventsForInitiatives(initiatives.map((row) => row.id)));

  const counters = {
    apply,
    scanned: initiatives.length,
    changed: 0,
    unchanged: 0,
    skippedNoKnownEvent: 0,
    sample: [] as Array<{
      initiativeId: string;
      title: string;
      from: string;
      to: string;
      eventType: string;
      eventDate: string;
    }>
  };

  for (const initiative of initiatives) {
    const latest = getLatestEvent(eventsByInitiative.get(initiative.id) ?? []);
    if (!latest?.normalized_status_after || latest.normalized_status_after === "unknown") {
      counters.skippedNoKnownEvent += 1;
      continue;
    }

    if (latest.normalized_status_after === initiative.normalized_status) {
      counters.unchanged += 1;
      continue;
    }

    counters.changed += 1;
    if (counters.sample.length < 10) {
      counters.sample.push({
        initiativeId: initiative.id,
        title: initiative.canonical_title,
        from: initiative.normalized_status,
        to: latest.normalized_status_after,
        eventType: latest.event_type,
        eventDate: latest.event_date
      });
    }

    if (!apply) {
      continue;
    }

    const { error } = await supabaseAdmin
      .from("initiatives")
      .update({ normalized_status: latest.normalized_status_after })
      .eq("id", initiative.id);

    if (error) {
      throw new Error(`Failed to update initiative ${initiative.id}: ${error.message}`);
    }
  }

  console.log(JSON.stringify(counters, null, 2));
}

async function fetchUnknownInitiatives(): Promise<InitiativeRow[]> {
  const rows: InitiativeRow[] = [];

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("initiatives")
      .select("id, canonical_title, normalized_status")
      .eq("normalized_status", "unknown")
      .range(from, from + 999);

    if (error) {
      throw new Error(`Failed to fetch unknown initiatives: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...(data as InitiativeRow[]));

    if (data.length < 1000) {
      break;
    }
  }

  return rows;
}

async function fetchEventsForInitiatives(initiativeIds: string[]): Promise<EventRow[]> {
  const rows: EventRow[] = [];

  for (let index = 0; index < initiativeIds.length; index += 250) {
    const ids = initiativeIds.slice(index, index + 250);
    const { data, error } = await supabaseAdmin
      .from("legislative_events")
      .select("initiative_id, event_type, event_date, normalized_status_after")
      .in("initiative_id", ids);

    if (error) {
      throw new Error(`Failed to fetch legislative events: ${error.message}`);
    }

    rows.push(...((data ?? []) as EventRow[]));
  }

  return rows;
}

function getLatestEvent(events: EventRow[]): EventRow | null {
  if (events.length === 0) {
    return null;
  }

  return [...events].sort(compareEventsByProgress)[0] ?? null;
}

function compareEventsByProgress(left: EventRow, right: EventRow): number {
  const dateComparison = right.event_date.localeCompare(left.event_date);
  if (dateComparison !== 0) {
    return dateComparison;
  }

  const leftRank = statusRank.get(left.normalized_status_after ?? "unknown") ?? -1;
  const rightRank = statusRank.get(right.normalized_status_after ?? "unknown") ?? -1;
  return rightRank - leftRank;
}

function groupBy(events: EventRow[]): Map<string, EventRow[]> {
  const grouped = new Map<string, EventRow[]>();

  for (const event of events) {
    const current = grouped.get(event.initiative_id);
    if (current) {
      current.push(event);
      continue;
    }

    grouped.set(event.initiative_id, [event]);
  }

  return grouped;
}

void main().catch((error) => {
  console.error("Initiative status backfill failed", error);
  process.exitCode = 1;
});
