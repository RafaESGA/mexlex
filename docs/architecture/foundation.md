# Foundation Architecture

## Intent

Create a production-grade foundation for Mexican federal initiative intelligence with:

- canonical initiative records
- source-level traceability
- evidence-preserving ingestion
- timeline normalization
- hybrid retrieval

## Initial runtime split

- `apps/api`: source adapters, persistence, search, agent tools
- `apps/web`: operator and analyst UI
- `packages/shared`: domain contracts and taxonomy
- `infra/supabase`: schema and storage conventions

## First implementation priorities

1. Apply the Supabase migration.
2. Add repository-backed query modules for initiatives, timeline, and search.
3. Implement source-specific discovery and parsing per adapter.
4. Add document extraction, chunking, and embedding workers.
5. Replace placeholder API and UI data with live queries.

