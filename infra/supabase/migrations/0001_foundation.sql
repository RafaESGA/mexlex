create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists vector;

create type chamber as enum ('diputados', 'senado', 'congreso_union', 'ejecutivo', 'otro');
create type initiative_status as enum (
  'draft',
  'presented',
  'in_commissions',
  'opinion_issued',
  'approved_origin',
  'approved_reviser',
  'approved_congress',
  'sent_executive',
  'published_dof',
  'rejected',
  'archived',
  'withdrawn',
  'expired',
  'unknown'
);
create type event_type as enum (
  'presentation',
  'gaceta_publication',
  'turn_to_commission',
  'commission_opinion',
  'commission_vote',
  'plenary_discussion',
  'plenary_vote',
  'approved_origin',
  'approved_reviser',
  'returned_with_changes',
  'sent_executive',
  'executive_observation',
  'dof_publication',
  'archival',
  'rejection',
  'withdrawal',
  'other'
);
create type document_kind as enum (
  'initiative_text',
  'gaceta_entry',
  'commission_opinion',
  'dictamen',
  'decree',
  'transcript',
  'html_snapshot',
  'pdf',
  'other'
);
create type source_system as enum (
  'sil',
  'gaceta_diputados',
  'gaceta_senado',
  'senado_transparencia',
  'manual'
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  system source_system not null unique,
  name text not null,
  base_url text,
  priority integer not null default 100,
  created_at timestamptz not null default now()
);

create table initiatives (
  id uuid primary key default gen_random_uuid(),
  canonical_title text not null,
  title_normalized text not null,
  summary text,
  matter_topic text,
  originating_chamber chamber,
  current_chamber chamber,
  normalized_status initiative_status not null default 'unknown',
  raw_status text,
  presented_at date,
  last_major_event_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  search_tsv tsvector,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index initiatives_title_trgm_idx on initiatives using gin (canonical_title gin_trgm_ops);
create index initiatives_search_tsv_idx on initiatives using gin (search_tsv);
create index initiatives_status_idx on initiatives (normalized_status);

create table initiative_aliases (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references initiatives(id) on delete cascade,
  alias text not null,
  alias_normalized text not null,
  alias_type text not null default 'title_variant',
  source_confidence numeric(4,3),
  created_at timestamptz not null default now(),
  unique (initiative_id, alias_normalized)
);

create index initiative_aliases_trgm_idx on initiative_aliases using gin (alias gin_trgm_ops);

create table authors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  name_normalized text not null,
  person_type text not null default 'legislator',
  chamber chamber,
  party text,
  legislature text,
  state text,
  profile_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index authors_name_trgm_idx on authors using gin (full_name gin_trgm_ops);

create table source_records (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id),
  record_type text not null,
  source_record_key text not null,
  parent_record_key text,
  source_url text,
  fetched_at timestamptz not null default now(),
  content_hash text not null,
  raw_payload jsonb,
  parsed_payload jsonb,
  status text not null default 'fetched',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, record_type, source_record_key, content_hash)
);

create index source_records_lookup_idx
  on source_records (source_id, record_type, source_record_key);

create table initiative_authors (
  initiative_id uuid not null references initiatives(id) on delete cascade,
  author_id uuid not null references authors(id) on delete cascade,
  role text not null default 'primary',
  sort_order integer,
  source_record_id uuid references source_records(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (initiative_id, author_id, role)
);

create table commissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text not null,
  chamber chamber,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (name_normalized, chamber)
);

create table initiative_commissions (
  initiative_id uuid not null references initiatives(id) on delete cascade,
  commission_id uuid not null references commissions(id) on delete cascade,
  relation_type text not null default 'referred',
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  primary key (initiative_id, commission_id, relation_type, assigned_at)
);

create table legislative_events (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references initiatives(id) on delete cascade,
  event_type event_type not null,
  event_date timestamptz not null,
  chamber chamber,
  stage text,
  title text,
  description text,
  normalized_status_after initiative_status,
  sequence_in_day integer,
  event_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (initiative_id, event_hash)
);

create index legislative_events_initiative_date_idx on legislative_events (initiative_id, event_date asc);
create index legislative_events_type_idx on legislative_events (event_type);

create table documents (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid references initiatives(id) on delete set null,
  legislative_event_id uuid references legislative_events(id) on delete set null,
  source_id uuid not null references sources(id),
  document_kind document_kind not null,
  title text,
  language text default 'es',
  mime_type text,
  source_url text,
  storage_path text,
  sha256 text not null,
  raw_text text,
  extracted_text text,
  extraction_status text not null default 'pending',
  published_at timestamptz,
  search_tsv tsvector,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, sha256)
);

create index documents_search_tsv_idx on documents using gin (search_tsv);

create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_count integer,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index document_chunks_embedding_idx
  on document_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create table affected_norms (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references initiatives(id) on delete cascade,
  norm_name text not null,
  norm_name_normalized text not null,
  article_reference text,
  action text,
  details text,
  created_at timestamptz not null default now()
);

create index affected_norms_name_idx on affected_norms (norm_name_normalized);

create table initiative_source_links (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references initiatives(id) on delete cascade,
  source_record_id uuid not null references source_records(id) on delete cascade,
  source_native_id text,
  source_title text,
  source_status text,
  confidence numeric(4,3) not null default 0.800,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (initiative_id, source_record_id)
);

create table event_source_links (
  legislative_event_id uuid not null references legislative_events(id) on delete cascade,
  source_record_id uuid not null references source_records(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (legislative_event_id, source_record_id)
);

create table document_source_links (
  document_id uuid not null references documents(id) on delete cascade,
  source_record_id uuid not null references source_records(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, source_record_id)
);

insert into sources (system, name, base_url, priority)
values
  ('sil', 'Sistema de Informacion Legislativa', 'https://sil.gobernacion.gob.mx', 10),
  ('gaceta_diputados', 'Gaceta Parlamentaria - Camara de Diputados', 'https://gaceta.diputados.gob.mx', 20),
  ('gaceta_senado', 'Gaceta del Senado', 'https://www.senado.gob.mx', 20),
  ('senado_transparencia', 'Senado Transparencia', 'https://www.senado.gob.mx/transparencia', 30),
  ('manual', 'Carga manual', null, 100)
on conflict (system) do nothing;

