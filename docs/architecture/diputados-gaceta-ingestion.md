# Diputados Gaceta Ingestion

## Seed pages

Current discovery starts from:

- `https://gaceta.diputados.gob.mx/gp_iniciativas.html`
- `https://gaceta.diputados.gob.mx/base/inis/66/gp66_b_inis.html`

## Current status

This adapter is an initial production-shaped scaffold for:

- discovery of initiative detail pages
- HTML parsing of initiative records
- persistence into canonical initiative tables and source traceability tables

## Entry point

```bash
pnpm --filter @mexlex/api diputados:ingest
```

Optional flags:

```bash
pnpm --filter @mexlex/api diputados:ingest -- --max-discovery-pages 5 --max-detail-pages 20
```

## Notes

The Gaceta site has multiple layouts across legislatures. The current parser is conservative and
intended as a first live pass for current structure discovery and incremental hardening.
