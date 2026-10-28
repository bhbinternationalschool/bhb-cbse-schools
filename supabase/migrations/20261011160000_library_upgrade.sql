-- Library upgrade (11 Oct 2026): copies as first-class records with a
-- server-issued accession number, a shelf/location per copy, a fast counter
-- (issue / return on the server, one copy at a time, atomically) and a late
-- fine that is either collected through the accounts or waived — never lost.
--
-- Additive and idempotent: columns are added with defaults, nothing is
-- dropped or deleted, and the library_state blob is left exactly as it is.
-- Safe to run twice.

-- ── Loan history is never deleted with its book ─────────────────────────
-- Both keys were ON DELETE CASCADE: deleting a title took its copies, and
-- deleting a copy took every loan of it — with any fine still owed and the
-- link to its receipt. Now the database refuses; the desk save refuses
-- first, with a message (libraryNormalized.server vetLibraryDeletes).
alter table public.library_desk_copies
  drop constraint if exists library_desk_copies_title_id_fkey;
alter table public.library_desk_copies
  add constraint library_desk_copies_title_id_fkey
  foreign key (title_id) references public.library_desk_titles(id) on delete restrict;
alter table public.library_desk_issues
  drop constraint if exists library_desk_issues_copy_id_fkey;
alter table public.library_desk_issues
  add constraint library_desk_issues_copy_id_fkey
  foreign key (copy_id) references public.library_desk_copies(id) on delete restrict;

-- (tenant_id, accession_no) is already unique: library_desk_copies_tenant_id_accession_no_key.

-- ── Copies: where it sits, where it came from ───────────────────────────
alter table public.library_desk_copies
  add column if not exists location text not null default '',
  add column if not exists source text not null default 'purchase',
  add column if not exists acquired_on date,
  add column if not exists procurement_doc_id text not null default '',
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'library_desk_copies_source_check'
  ) then
    alter table public.library_desk_copies
      add constraint library_desk_copies_source_check
      check (source in ('purchase', 'donation', 'in_house'));
  end if;
end $$;

-- Existing copies inherit their title's rack as their location — only where
-- the copy has none yet, so a rerun (or a location set since) is untouched.
update public.library_desk_copies c
   set location = t.shelf
  from public.library_desk_titles t
 where t.id = c.title_id
   and t.tenant_id = c.tenant_id
   and c.location = ''
   and coalesce(t.shelf, '') <> '';

create index if not exists library_desk_copies_location_idx
  on public.library_desk_copies (tenant_id, location);
create index if not exists library_desk_copies_barcode_idx
  on public.library_desk_copies (tenant_id, barcode);
create index if not exists library_desk_issues_copy_open_idx
  on public.library_desk_issues (tenant_id, copy_id)
  where returned_on is null;

-- ── Loans: who took it back, and how the fine was settled ───────────────
alter table public.library_desk_issues
  add column if not exists returned_by text not null default '',
  add column if not exists fine_status text not null default 'none',
  add column if not exists fine_settled_at timestamptz,
  add column if not exists fine_settled_by text not null default '',
  add column if not exists fine_mode text not null default '',
  add column if not exists fine_voucher_id text not null default '',
  add column if not exists fine_voucher_no text not null default '',
  add column if not exists fine_waive_reason text not null default '';

alter table public.library_desk_issues
  drop constraint if exists library_desk_issues_fine_status_check;
alter table public.library_desk_issues
  add constraint library_desk_issues_fine_status_check
  check (fine_status in ('none', 'pending', 'collecting', 'collected', 'waived'));

-- A fine recorded before this migration is owed until someone collects or
-- waives it: it must not read as settled just because the column is new.
update public.library_desk_issues
   set fine_status = 'pending'
 where fine_paise > 0
   and returned_on is not null
   and fine_status = 'none';

create index if not exists library_desk_issues_fine_pending_idx
  on public.library_desk_issues (tenant_id)
  where fine_status = 'pending';

-- ── Fine rule: grace days and a cap beside the per-day rate ─────────────
alter table public.library_desk_settings
  add column if not exists fine_grace_days int not null default 0,
  add column if not exists fine_cap_paise bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'library_desk_settings_fine_grace_check'
  ) then
    alter table public.library_desk_settings
      add constraint library_desk_settings_fine_grace_check
      check (fine_grace_days between 0 and 365);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'library_desk_settings_fine_cap_check'
  ) then
    alter table public.library_desk_settings
      add constraint library_desk_settings_fine_cap_check
      check (fine_cap_paise >= 0);
  end if;
end $$;

-- ── Accession number sequence (one per school) ──────────────────────────
create table if not exists public.library_accession_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  prefix text not null default 'ACC',
  next_no bigint not null default 1 check (next_no >= 1),
  updated_at timestamptz not null default now()
);

alter table public.library_accession_counters enable row level security;
grant select, insert, update, delete on public.library_accession_counters to service_role;

comment on table public.library_accession_counters is
  'Next library accession number per school — handed out only by library_add_copies';

-- ── Add copies: accession numbers handed out and copies inserted together ─
create or replace function public.library_add_copies(
  p_tenant_id uuid,
  p_title_id text,
  p_count int,
  p_location text default '',
  p_source text default 'purchase',
  p_acquired_on date default null,
  p_procurement_doc_id text default ''
)
returns setof public.library_desk_copies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no bigint;
  v_prefix text;
  v_acc text;
  v_row public.library_desk_copies;
  i int;
begin
  if p_count is null or p_count < 1 or p_count > 200 then
    raise exception 'library_add_copies: count must be 1-200';
  end if;
  if coalesce(p_source, '') not in ('purchase', 'donation', 'in_house') then
    raise exception 'library_add_copies: unknown source %', p_source;
  end if;
  perform 1 from public.library_desk_titles
   where id = p_title_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'library_add_copies: title % not found', p_title_id;
  end if;

  insert into public.library_accession_counters (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  for i in 1..p_count loop
    -- The counter row is locked by the update until commit, so two counters
    -- adding copies at once queue here instead of taking the same number.
    -- A number already used (typed by hand before this existed) is skipped.
    loop
      update public.library_accession_counters
         set next_no = next_no + 1, updated_at = now()
       where tenant_id = p_tenant_id
      returning next_no - 1, prefix into v_no, v_prefix;
      v_acc := v_prefix || '-' || lpad(v_no::text, 6, '0');
      exit when not exists (
        select 1 from public.library_desk_copies
         where tenant_id = p_tenant_id and (accession_no = v_acc or barcode = v_acc)
      );
    end loop;

    insert into public.library_desk_copies (
      id, tenant_id, title_id, accession_no, barcode, status,
      location, source, acquired_on, procurement_doc_id, created_at, updated_at
    ) values (
      'libc_' || substr(md5(random()::text || clock_timestamp()::text || i::text), 1, 16),
      p_tenant_id, p_title_id, v_acc, v_acc, 'available',
      coalesce(p_location, ''), p_source, p_acquired_on, coalesce(p_procurement_doc_id, ''),
      now(), now()
    )
    returning * into v_row;
    return next v_row;
  end loop;

  -- The title row is deliberately left alone: the browser holds it with a
  -- stamp, and touching it here would turn the librarian's next edit of the
  -- title into a "changed on another device" refusal. The screen counts
  -- copies from the copies themselves; copies_total is only a cache.
  return;
end;
$$;

-- ── Issue one copy (the counter calls it once per book) ─────────────────
create or replace function public.library_issue_copy(
  p_tenant_id uuid,
  p_copy_id text,
  p_borrower_type text,
  p_borrower_id text,
  p_academic_year_code text,
  p_issued_on date,
  p_due_on date,
  p_issued_by text,
  p_note text,
  p_issue_condition text,
  p_damage_note text,
  p_max_open int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_copy public.library_desk_copies;
  v_open int;
  v_key text;
  v_id text;
begin
  if p_borrower_type not in ('student', 'staff') or coalesce(p_borrower_id, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Choose a student or staff member');
  end if;
  if p_due_on < p_issued_on then
    return jsonb_build_object('ok', false, 'error', 'Due date is before the issue date');
  end if;
  v_key := case when p_borrower_type = 'staff' then 'staff:' || p_borrower_id else p_borrower_id end;

  select * into v_copy from public.library_desk_copies
   where id = p_copy_id and tenant_id = p_tenant_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Copy not found');
  end if;
  if v_copy.status <> 'available' then
    return jsonb_build_object('ok', false, 'error',
      'Copy ' || v_copy.accession_no || ' is ' || v_copy.status || ', not available');
  end if;
  if exists (
    select 1 from public.library_desk_issues
     where tenant_id = p_tenant_id and copy_id = p_copy_id and returned_on is null
  ) then
    return jsonb_build_object('ok', false, 'error',
      'Copy ' || v_copy.accession_no || ' is still on loan');
  end if;

  -- One borrower at a time, so two counters cannot both slip under the limit.
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || '|lib|' || v_key));
  select count(*) into v_open from public.library_desk_issues
   where tenant_id = p_tenant_id and student_id = v_key and returned_on is null;
  if p_max_open > 0 and v_open >= p_max_open then
    return jsonb_build_object('ok', false, 'error',
      'Already has ' || v_open || ' book(s) out — the limit is ' || p_max_open);
  end if;

  v_id := 'libi_' || substr(md5(random()::text || clock_timestamp()::text || p_copy_id), 1, 16);
  insert into public.library_desk_issues (
    id, tenant_id, copy_id, student_id, borrower_type, staff_id,
    academic_year_code, issued_on, due_on, fine_paise, fine_status,
    issued_by, note, issue_condition, damage_note_on_issue, created_at, updated_at
  ) values (
    v_id, p_tenant_id, p_copy_id, v_key, p_borrower_type,
    case when p_borrower_type = 'staff' then p_borrower_id else '' end,
    coalesce(p_academic_year_code, ''), p_issued_on, p_due_on, 0, 'none',
    coalesce(p_issued_by, ''), coalesce(p_note, ''),
    coalesce(nullif(p_issue_condition, ''), 'good'), coalesce(p_damage_note, ''),
    now(), now()
  );

  update public.library_desk_copies
     set status = 'issued', updated_at = now()
   where id = p_copy_id and tenant_id = p_tenant_id;

  return jsonb_build_object('ok', true, 'issue_id', v_id, 'due_on', p_due_on,
                            'accession_no', v_copy.accession_no);
end;
$$;

-- ── Return one loan; the fine is worked out by lib/libraryFine.ts ───────
create or replace function public.library_return_issue(
  p_tenant_id uuid,
  p_issue_id text,
  p_returned_on date,
  p_fine_paise bigint,
  p_return_condition text,
  p_damage_note text,
  p_returned_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue public.library_desk_issues;
  v_cond text := coalesce(nullif(p_return_condition, ''), 'good');
begin
  if p_fine_paise is null or p_fine_paise < 0 then
    return jsonb_build_object('ok', false, 'error', 'Fine must be zero or more');
  end if;
  select * into v_issue from public.library_desk_issues
   where id = p_issue_id and tenant_id = p_tenant_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Loan not found');
  end if;
  if v_issue.returned_on is not null then
    return jsonb_build_object('ok', false, 'error', 'Already returned on ' || v_issue.returned_on);
  end if;
  if p_returned_on < v_issue.issued_on then
    return jsonb_build_object('ok', false, 'error', 'Return date is before the issue date');
  end if;

  update public.library_desk_issues
     set returned_on = p_returned_on,
         fine_paise = p_fine_paise,
         fine_status = case when p_fine_paise > 0 then 'pending' else 'none' end,
         return_condition = v_cond,
         damage_note_on_return = coalesce(p_damage_note, ''),
         returned_by = coalesce(p_returned_by, ''),
         updated_at = now()
   where id = p_issue_id and tenant_id = p_tenant_id;

  update public.library_desk_copies
     set status = case when v_cond in ('damaged', 'torn') then 'damaged' else 'available' end,
         updated_at = now()
   where id = v_issue.copy_id and tenant_id = p_tenant_id
     and status = 'issued';

  return jsonb_build_object('ok', true, 'issue_id', p_issue_id, 'fine_paise', p_fine_paise);
end;
$$;

-- ── Move a copy / mark it lost, damaged or back — never while on loan ───
create or replace function public.library_update_copy(
  p_tenant_id uuid,
  p_copy_id text,
  p_location text default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_copy public.library_desk_copies;
begin
  if p_status is not null and p_status not in ('available', 'lost', 'damaged') then
    return jsonb_build_object('ok', false, 'error', 'Status can be available, lost or damaged');
  end if;
  -- Locked: library_issue_copy locks the same row, so an issue and a
  -- "mark lost" cannot both pass their checks at once.
  select * into v_copy from public.library_desk_copies
   where id = p_copy_id and tenant_id = p_tenant_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Copy not found');
  end if;
  if p_status is not null and (
       v_copy.status = 'issued'
       or exists (select 1 from public.library_desk_issues
                   where tenant_id = p_tenant_id and copy_id = p_copy_id and returned_on is null)
     ) then
    return jsonb_build_object('ok', false, 'error',
      'Copy ' || v_copy.accession_no || ' is on loan — return it at the counter first');
  end if;
  update public.library_desk_copies
     set location = coalesce(p_location, location),
         status = coalesce(p_status, status),
         updated_at = now()
   where id = p_copy_id and tenant_id = p_tenant_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.library_update_copy(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.library_update_copy(uuid, text, text, text) to service_role;
revoke all on function public.library_add_copies(uuid, text, int, text, text, date, text) from public, anon, authenticated;
grant execute on function public.library_add_copies(uuid, text, int, text, text, date, text) to service_role;
revoke all on function public.library_issue_copy(uuid, text, text, text, text, date, date, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.library_issue_copy(uuid, text, text, text, text, date, date, text, text, text, text, int) to service_role;
revoke all on function public.library_return_issue(uuid, text, date, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.library_return_issue(uuid, text, date, bigint, text, text, text) to service_role;
