export const chambers = ["diputados", "senado", "congreso_union", "ejecutivo", "otro"] as const;
export type Chamber = (typeof chambers)[number];

export const initiativeStatuses = [
  "draft",
  "presented",
  "in_commissions",
  "opinion_issued",
  "approved_origin",
  "approved_reviser",
  "approved_congress",
  "sent_executive",
  "published_dof",
  "rejected",
  "archived",
  "withdrawn",
  "expired",
  "unknown"
] as const;
export type InitiativeStatus = (typeof initiativeStatuses)[number];

export const eventTypes = [
  "presentation",
  "gaceta_publication",
  "turn_to_commission",
  "commission_opinion",
  "commission_vote",
  "plenary_discussion",
  "plenary_vote",
  "approved_origin",
  "approved_reviser",
  "returned_with_changes",
  "sent_executive",
  "executive_observation",
  "dof_publication",
  "archival",
  "rejection",
  "withdrawal",
  "other"
] as const;
export type EventType = (typeof eventTypes)[number];

export const sourceSystems = [
  "sil",
  "gaceta_diputados",
  "gaceta_senado",
  "senado_transparencia",
  "manual"
] as const;
export type SourceSystem = (typeof sourceSystems)[number];

