-- Subject grouping: parent subject + components (e.g. English → Oral / Written)

alter table public.subjects
  add column if not exists parent_id uuid references public.subjects(id) on delete cascade;

create index if not exists subjects_parent_idx
  on public.subjects (tenant_id, parent_id)
  where parent_id is not null;

comment on column public.subjects.parent_id is
  'Null = top-level / group head. Set = component under that subject (e.g. ENG-ORAL under ENG).';
