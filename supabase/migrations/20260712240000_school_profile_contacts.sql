-- School profile: mobile, WhatsApp, website & social links

alter table public.school_profiles
  add column if not exists mobile text,
  add column if not exists whatsapp text,
  add column if not exists website text,
  add column if not exists facebook text,
  add column if not exists instagram text,
  add column if not exists google text,
  add column if not exists youtube text;

comment on column public.school_profiles.mobile is 'Primary school mobile';
comment on column public.school_profiles.whatsapp is 'WhatsApp Business / office number';
comment on column public.school_profiles.google is 'Google Business Profile or Maps URL';
