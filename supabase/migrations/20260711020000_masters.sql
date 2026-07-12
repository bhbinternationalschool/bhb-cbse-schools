-- Masters: fee heads + BHB class/section seed (campuses/classes already in foundation)

create table if not exists public.fee_heads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name_en text not null,
  name_hi text,
  category text not null default 'tuition'
    check (category in (
      'tuition', 'admission', 'exam', 'transport', 'annual',
      'development', 'lab', 'computer', 'library', 'misc', 'late_fee', 'certificate'
    )),
  frequency text not null default 'monthly'
    check (frequency in ('one_time', 'monthly', 'quarterly', 'annual', 'as_needed')),
  is_optional boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists fee_heads_tenant_active_idx
  on public.fee_heads (tenant_id) where is_active = true;

-- Ensure Main Campus exists (idempotent)
insert into public.campuses (tenant_id, name, code, is_primary)
select id, 'Main Campus', 'MAIN', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, code) do update set name = excluded.name, is_primary = true;

-- Seed classes Nursery → XII
insert into public.classes (tenant_id, name, sort_order)
select t.id, c.name, c.sort_order
from public.tenants t
cross join (values
  ('Nursery', 1), ('LKG', 2), ('UKG', 3),
  ('I', 4), ('II', 5), ('III', 6), ('IV', 7), ('V', 8),
  ('VI', 9), ('VII', 10), ('VIII', 11), ('IX', 12), ('X', 13),
  ('XI', 14), ('XII', 15)
) as c(name, sort_order)
where t.slug = 'bhb-international'
on conflict (tenant_id, name) do update set sort_order = excluded.sort_order;

-- Sections A & B for each class
insert into public.sections (class_id, name)
select cl.id, s.name
from public.tenants t
join public.classes cl on cl.tenant_id = t.id
cross join (values ('A'), ('B')) as s(name)
where t.slug = 'bhb-international'
on conflict (class_id, name) do nothing;

-- Default fee heads for BHB
insert into public.fee_heads (tenant_id, code, name_en, name_hi, category, frequency, is_optional, sort_order)
select t.id, f.code, f.name_en, f.name_hi, f.category, f.frequency, f.is_optional, f.sort_order
from public.tenants t
cross join (values
  ('TUITION', 'Tuition Fee', 'शिक्षा शुल्क', 'tuition', 'monthly', false, 10),
  ('ADMISSION', 'Admission Fee', 'प्रवेश शुल्क', 'admission', 'one_time', false, 20),
  ('ANNUAL', 'Annual Charges', 'वार्षिक शुल्क', 'annual', 'annual', false, 30),
  ('EXAM', 'Examination Fee', 'परीक्षा शुल्क', 'exam', 'as_needed', false, 40),
  ('TRANSPORT', 'Transport Fee', 'परिवहन शुल्क', 'transport', 'monthly', true, 50),
  ('COMPUTER', 'Computer Fee', 'कंप्यूटर शुल्क', 'computer', 'monthly', true, 60),
  ('LAB', 'Lab Fee', 'प्रयोगशाला शुल्क', 'lab', 'annual', true, 70),
  ('LIBRARY', 'Library Fee', 'पुस्तकालय शुल्क', 'library', 'annual', true, 80),
  ('DEV', 'Development Fee', 'विकास शुल्क', 'development', 'annual', false, 90),
  ('LATE', 'Late Fee', 'विलंब शुल्क', 'late_fee', 'as_needed', false, 100),
  ('CERT', 'Certificate Fee', 'प्रमाणपत्र शुल्क', 'certificate', 'as_needed', true, 110)
) as f(code, name_en, name_hi, category, frequency, is_optional, sort_order)
where t.slug = 'bhb-international'
on conflict (tenant_id, code) do update
  set name_en = excluded.name_en,
      name_hi = excluded.name_hi,
      category = excluded.category,
      frequency = excluded.frequency,
      is_optional = excluded.is_optional,
      sort_order = excluded.sort_order;

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'masters', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;
