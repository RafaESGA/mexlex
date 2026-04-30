export const toolRegistry = [
  "search_initiatives",
  "get_initiative_detail",
  "get_legislative_timeline",
  "search_by_author",
  "search_by_topic"
] as const;

export type AgentToolName = (typeof toolRegistry)[number];

