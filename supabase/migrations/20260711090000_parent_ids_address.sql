-- Parent IDs + address detail for transport stop matching

alter table public.students
  add column if not exists father_aadhaar_last4 text,
  add column if not exists mother_aadhaar_last4 text,
  add column if not exists father_pan text,
  add column if not exists mother_pan text;

alter table public.households
  add column if not exists locality text,
  add column if not exists landmark text;

comment on column public.students.father_aadhaar_last4 is
  'Last 4 digits only; full Aadhaar never stored';
comment on column public.students.mother_aadhaar_last4 is
  'Last 4 digits only; full Aadhaar never stored';
comment on column public.households.locality is
  'Area/mohalla — used to suggest transport pickup stops';
comment on column public.households.landmark is
  'Nearby landmark for driver/parent pickup guidance';
