# SIL Ingestion

## Runtime shape

The SIL ingestor lives under `apps/api/src/ingestion/adapters/sil` and is split into:

- `fetchers/`: network discovery and detail-page downloads
- `parsers/`: HTML extraction logic
- `mappers/`: parser output to canonical persistence shape
- `persist.ts`: Supabase Storage and table writes
- `service.ts`: orchestration entry point

## Entry point

Use `runSilIngestion()` from the service layer or run:

```bash
pnpm --filter @mexlex/api sil:ingest
```

Optional flags:

```bash
pnpm --filter @mexlex/api sil:ingest -- --max-discovery-pages 5 --max-detail-pages 20
```

## Required setup

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SIL_RAW_STORAGE_BUCKET`
- a Storage bucket with the configured name created in Supabase

## Current parser strategy

The parser is HTML-first and heuristic because SIL pages are not assumed to expose stable APIs.
It extracts initiative fields from common `table` and `dl/dt/dd` layouts, then falls back to
headline and meta description content when needed.

