import type { EventType, InitiativeStatus } from "@mexlex/shared/taxonomy/legislative";

const eventStatusMap: Partial<Record<EventType, InitiativeStatus>> = {
  presentation: "presented",
  gaceta_publication: "presented",
  turn_to_commission: "in_commissions",
  commission_opinion: "opinion_issued",
  approved_origin: "approved_origin",
  approved_reviser: "approved_reviser",
  sent_executive: "sent_executive",
  dof_publication: "published_dof",
  rejection: "rejected",
  archival: "archived",
  withdrawal: "withdrawn"
};

export function inferStatusFromEvent(eventType: EventType): InitiativeStatus {
  return eventStatusMap[eventType] ?? "unknown";
}
