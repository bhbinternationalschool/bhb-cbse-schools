-- Fee structure publish markers on fee groups.

alter table public.fee_groups
  add column if not exists structure_published_at timestamptz,
  add column if not exists structure_published_by text not null default '';

comment on column public.fee_groups.structure_published_at is
  'When structure amounts were published for Fee Take billing';
comment on column public.fee_structure_lines.class_id is
  'Null = all classes in group; set for class-specific override amounts';
