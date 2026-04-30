# mex-lex

Production-grade legislative intelligence foundation for Mexican federal initiatives.

## Workspaces

- `apps/api`: ingestion, reconciliation, search, and AI tool endpoints
- `apps/web`: Next.js UI for search, initiative detail, and timeline views
- `packages/shared`: source-independent types, schemas, taxonomy, and prompts
- `packages/ui`: shared UI components and style tokens
- `infra/supabase`: SQL migrations and storage/infrastructure notes

## Core principles

- Preserve raw evidence before normalization
- Reconcile across fallible public sources
- Keep every normalized fact traceable to source records
- Use hybrid retrieval: full-text, trigram fuzzy matching, and embeddings

