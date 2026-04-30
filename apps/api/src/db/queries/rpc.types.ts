export type SearchInitiativesRpcRow = {
  initiative_id: string;
  canonical_title: string;
  summary: string | null;
  normalized_status: string;
  raw_status: string | null;
  presented_at: string | null;
  matter_topic: string | null;
  rank_score: number | null;
  trigram_score: number | null;
  final_score: number | null;
};

export type SearchByAuthorRpcRow = {
  initiative_id: string;
  canonical_title: string;
  normalized_status: string;
  author_name: string;
  author_party: string | null;
  author_state: string | null;
  presented_at: string | null;
  match_score: number | null;
};

export type InitiativeDetailRpcRow = {
  initiative_id: string;
  canonical_title: string;
  summary: string | null;
  matter_topic: string | null;
  normalized_status: string;
  raw_status: string | null;
  originating_chamber: string | null;
  current_chamber: string | null;
  presented_at: string | null;
  last_major_event_at: string | null;
  authors: unknown;
  affected_norms: unknown;
  source_links: unknown;
  document_count: number | null;
  event_count: number | null;
};

export type TimelineRpcRow = {
  event_id: string;
  initiative_id: string;
  event_type: string;
  event_date: string;
  sequence_in_day: number | null;
  chamber: string | null;
  stage: string | null;
  title: string | null;
  description: string | null;
  normalized_status_after: string | null;
  raw_status: string | null;
  source_links: unknown;
};

