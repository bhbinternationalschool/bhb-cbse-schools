-- Fee hold overrides (Principal PIN) — demo uses localStorage; schema for Supabase.

create table if not exists public.fee_hold_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  hold_code text not null check (hold_code in (
    'HOLD_REPORT_CARD', 'HOLD_TC', 'HOLD_CERT', 'HOLD_TRANSPORT',
    'HOLD_STORE_CREDIT', 'HOLD_LIBRARY', 'HOLD_ADMIT_CARD', 'HOLD_TRIP', 'HOLD_NEXT_AY'
  )),
  reason text not null,
  overridden_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_on date not null,
  revoked_at timestamptz
);

create index if not exists fee_hold_overrides_active_idx
  on public.fee_hold_overrides (tenant_id, student_id, hold_code)
  where revoked_at is null;

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'fees.holds', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;
