-- Household WhatsApp for all parent communications (fee reminders, receipts, notices)

alter table public.households
  add column if not exists whatsapp_mobile text;

comment on column public.households.whatsapp_mobile is
  'WhatsApp number for school communications; falls back to mobile when null';

update public.households
set whatsapp_mobile = mobile
where whatsapp_mobile is null
  and mobile is not null
  and length(regexp_replace(mobile, '\D', '', 'g')) = 10;
