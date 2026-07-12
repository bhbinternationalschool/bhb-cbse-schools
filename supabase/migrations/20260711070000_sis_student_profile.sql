-- Extended SIS student profile (complete records without Admissions CRM)

alter table public.households
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists pincode text,
  add column if not exists alt_mobile text;

alter table public.students
  add column if not exists blood_group text,
  add column if not exists religion text,
  add column if not exists category text,
  add column if not exists nationality text default 'Indian',
  add column if not exists mother_tongue text,
  add column if not exists place_of_birth text,
  add column if not exists aadhaar_last4 text,
  add column if not exists father_mobile text,
  add column if not exists mother_mobile text,
  add column if not exists guardian_relation text,
  add column if not exists emergency_name text,
  add column if not exists emergency_mobile text,
  add column if not exists pen_status text,
  add column if not exists apaar_id text,
  add column if not exists srn text,
  add column if not exists previous_school text,
  add column if not exists previous_tc_no text,
  add column if not exists previous_udise text,
  add column if not exists docs jsonb not null default '{}'::jsonb;

comment on column public.students.docs is
  'Checklist map: birthCert/photo/aadhaar/... -> missing|received|verified';
comment on column public.students.aadhaar_last4 is
  'Only last 4 digits stored; full Aadhaar never in SIS';
