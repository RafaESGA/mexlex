begin;

create temp table tmp_senado_initiatives on commit drop as
select distinct i.id as initiative_id
from initiatives i
join initiative_source_links isl on isl.initiative_id = i.id
join source_records sr on sr.id = isl.source_record_id
join sources s on s.id = sr.source_id
where s.system = 'gaceta_senado';

create temp table tmp_bad_senado_author_links on commit drop as
with raw_links as (
  select
    ia.initiative_id,
    ia.author_id as old_author_id,
    ia.role,
    ia.sort_order,
    a.full_name as old_full_name,
    a.chamber,
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(a.full_name, '^\s*sen\.\s*', '', 'i'),
                        '^\s*(las\s+)?senadoras\s+y\s+de\s+los\s+senadores\s+',
                        '',
                        'i'
                      ),
                      '^\s*(las\s+)?senadoras\s+y\s+los\s+senadores\s+',
                      '',
                      'i'
                    ),
                    '^\s*(las\s+)?senadoras\s+y\s+senadores\s+',
                    '',
                    'i'
                  ),
                  '^\s*senadoras\s+$',
                  '',
                  'i'
                ),
                '^\s*senadores\s+$',
                '',
                'i'
              ),
              '^\s*senadoras\s+',
              '',
              'i'
            ),
            '^\s*senadores\s+',
            '',
            'i'
          ),
          '\s*,?\s*(del|el)\s+Grupo Parlamentario.*$',
          '',
          'i'
        ),
        '\s+',
        ' ',
        'g'
      )
    ) as canonical_full_name
  from initiative_authors ia
  join authors a on a.id = ia.author_id
  join tmp_senado_initiatives tsi on tsi.initiative_id = ia.initiative_id
  where
    a.full_name ~* '^\s*grupo parlamentario\b'
    or a.full_name ~* '\bgrupo parlamentario\b'
    or a.full_name ~* '^\s*senadoras?\s*$'
    or a.full_name ~* '^\s*senadores?\s+'
)
select *
from raw_links
where old_full_name <> canonical_full_name
   or canonical_full_name = '';

do $$
declare
  rec record;
begin
  for rec in
    select distinct canonical_full_name, chamber
    from tmp_bad_senado_author_links
    where canonical_full_name <> ''
  loop
    if not exists (
      select 1
      from authors a
      where a.full_name = rec.canonical_full_name
        and a.chamber is not distinct from rec.chamber
    ) then
      insert into authors (
        full_name,
        name_normalized,
        person_type,
        chamber,
        profile_data
      )
      values (
        rec.canonical_full_name,
        lower(regexp_replace(unaccent(rec.canonical_full_name), '[^a-z0-9]+', ' ', 'g')),
        'legislator',
        rec.chamber,
        '{}'::jsonb
      );
    end if;
  end loop;
end
$$;

create temp table tmp_senado_author_repoint on commit drop as
select
  bad.initiative_id,
  bad.old_author_id,
  bad.role,
  bad.sort_order,
  canonical.id as new_author_id
from tmp_bad_senado_author_links bad
join authors canonical
  on canonical.full_name = bad.canonical_full_name
 and canonical.chamber is not distinct from bad.chamber
where bad.canonical_full_name <> '';

insert into initiative_authors (
  initiative_id,
  author_id,
  role,
  sort_order,
  source_record_id
)
select
  repoint.initiative_id,
  repoint.new_author_id,
  repoint.role,
  repoint.sort_order,
  null
from tmp_senado_author_repoint repoint
where not exists (
  select 1
  from initiative_authors existing
  where existing.initiative_id = repoint.initiative_id
    and existing.author_id = repoint.new_author_id
    and existing.role = repoint.role
);

delete from initiative_authors ia
using tmp_bad_senado_author_links bad
where ia.initiative_id = bad.initiative_id
  and ia.author_id = bad.old_author_id
  and ia.role = bad.role;

delete from authors a
where not exists (
  select 1
  from initiative_authors ia
  where ia.author_id = a.id
)
and (
  a.full_name ~* '^\s*grupo parlamentario\b'
  or a.full_name ~* '\bgrupo parlamentario\b'
  or a.full_name ~* '^\s*senadoras?\s*$'
  or a.full_name ~* '^\s*senadores?\s+'
);

commit;
