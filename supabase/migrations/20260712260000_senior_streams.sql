-- Higher secondary streams / pathways (XI–XII)

create table if not exists public.senior_streams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name_en text not null,
  traditional_label text,
  nep_note text,
  grades text[] not null default array['XI','XII'],
  core_codes text[] not null default '{}',
  elective_codes text[] not null default '{}',
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

comment on table public.senior_streams is
  'XI–XII pathways (Science PCM/PCB, Commerce, Humanities, Multidisciplinary). NEP treats these as packages, not hard walls.';
