export type SenadoPageKind = "index" | "session" | "document";

export type SenadoDiscoveredPage = {
  url: string;
  depth: number;
  kind: SenadoPageKind;
  parentUrl?: string;
  sessionDate?: string | null;
};

export type SenadoHtmlPage = {
  url: string;
  html: string;
  fetchedAt: string;
  contentType: string;
  kind: SenadoPageKind;
  parentUrl?: string;
  sessionDate?: string | null;
};

export type SenadoParsedAuthor = {
  fullName: string;
  role: string;
};

export type SenadoParsedInitiative = {
  sourceUrl: string;
  sourceRecordKey: string;
  title: string;
  titleNormalized: string;
  authors: SenadoParsedAuthor[];
  presentationDate: string | null;
  statusRaw: string | null;
  chamber: string | null;
  initiativeType: string | null;
  description: string | null;
  dedupeHash: string;
  rawHtml: string;
  metadata: Record<string, unknown>;
};

export type SenadoMappedInitiative = {
  canonicalTitle: string;
  titleNormalized: string;
  summary: string | null;
  presentedAt: string | null;
  rawStatus: string | null;
  chamber: string | null;
  initiativeType: string | null;
  sourceUrl: string;
  dedupeHash: string;
  authors: SenadoParsedAuthor[];
  rawHtml: string;
  metadata: Record<string, unknown>;
  sourceRecordKey: string;
};

export type SenadoIngestionOptions = {
  maxDiscoveryPages?: number;
  maxSessionPages?: number;
  maxDetailPages?: number;
  seedUrls?: string[];
};

export type SenadoIngestionResult = {
  discoveredPages: number;
  parsedInitiatives: number;
  insertedInitiatives: number;
};
