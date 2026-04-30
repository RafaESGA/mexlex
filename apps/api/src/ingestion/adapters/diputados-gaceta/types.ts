export type DiputadosDiscoveredPage = {
  url: string;
  depth: number;
  parentUrl?: string;
};

export type DiputadosHtmlPage = {
  url: string;
  html: string;
  fetchedAt: string;
  contentType: string;
  parentUrl?: string;
};

export type DiputadosParsedAuthor = {
  fullName: string;
  role: string;
};

export type DiputadosParsedInitiative = {
  sourceUrl: string;
  sourceRecordKey: string;
  title: string;
  titleNormalized: string;
  authors: DiputadosParsedAuthor[];
  presentationDate: string | null;
  statusRaw: string | null;
  chamber: string | null;
  initiativeType: string | null;
  description: string | null;
  dedupeHash: string;
  rawHtml: string;
  metadata: Record<string, unknown>;
};

export type DiputadosMappedInitiative = {
  canonicalTitle: string;
  titleNormalized: string;
  summary: string | null;
  presentedAt: string | null;
  rawStatus: string | null;
  chamber: string | null;
  initiativeType: string | null;
  sourceUrl: string;
  dedupeHash: string;
  authors: DiputadosParsedAuthor[];
  rawHtml: string;
  metadata: Record<string, unknown>;
  sourceRecordKey: string;
};

export type DiputadosIngestionOptions = {
  maxDiscoveryPages?: number;
  maxDetailPages?: number;
  seedUrls?: string[];
};

export type DiputadosIngestionResult = {
  discoveredPages: number;
  parsedInitiatives: number;
  insertedInitiatives: number;
};

