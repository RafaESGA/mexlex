export type SilDiscoveredPage = {
  url: string;
  depth: number;
  parentUrl?: string;
};

export type SilHtmlPage = {
  url: string;
  html: string;
  fetchedAt: string;
  contentType: string;
  parentUrl?: string;
};

export type SilParsedAuthor = {
  fullName: string;
  role: string;
};

export type SilParsedInitiative = {
  sourceUrl: string;
  sourceRecordKey: string;
  title: string;
  titleNormalized: string;
  authors: SilParsedAuthor[];
  presentationDate: string | null;
  statusRaw: string | null;
  chamber: string | null;
  initiativeType: string | null;
  description: string | null;
  dedupeHash: string;
  rawHtml: string;
  metadata: Record<string, unknown>;
};

export type SilParsedInitiativeDetail = {
  sourceUrl: string;
  title?: string | null;
  titleNormalized?: string | null;
  authors?: SilParsedAuthor[];
  presentationDate?: string | null;
  statusRaw?: string | null;
  chamber?: string | null;
  initiativeType?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  rawHtml: string;
};

export type SilParsedInitiativeList = {
  sourceUrl: string;
  initiatives: SilParsedInitiative[];
};

export type SilMappedInitiative = {
  canonicalTitle: string;
  titleNormalized: string;
  summary: string | null;
  presentedAt: string | null;
  rawStatus: string | null;
  chamber: string | null;
  initiativeType: string | null;
  sourceUrl: string;
  dedupeHash: string;
  authors: SilParsedAuthor[];
  rawHtml: string;
  metadata: Record<string, unknown>;
  sourceRecordKey: string;
};

export type SilIngestionOptions = {
  maxDiscoveryPages?: number;
  maxDetailPages?: number;
  seedUrls?: string[];
};

export type SilIngestionResult = {
  discoveredPages: number;
  parsedInitiatives: number;
  insertedInitiatives: number;
};
