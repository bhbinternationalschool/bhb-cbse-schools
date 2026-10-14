-- Fuel register ↔ the book, both ways (14 Oct 2026, on top of
-- 20261014101500_transport_fuel_register).
--
-- Director, 14 Oct 2026: "allow fuel entry in Accounts and sync both ways."
--
-- transport_fuel_fills stays the ONE fuel record. What this adds:
--
--   1. ONE TRANSACTION. transport_fuel_fill_post writes the voucher (through
--      ledger_post) and the fill(s) — or ties fills already saved — in the
--      same transaction. Before this, the register posted and then stamped the
--      fill in a second round trip; a failure between the two left a voucher
--      the register did not know it had.
--
--   2. ACCOUNTS ENTERS FUEL TOO. A Quick or Multi-line expense with a fuel
--      line writes its fill(s) here through the same function
--      (entry_source 'accounts'). One fill per voucher line, enforced by the
--      existing unique index on voucher_line_id.
--
--   3. A REVERSAL REACHES THE FILL. Any reversing voucher — Accounts →
--      void-voucher, amend, a reverse — voids the fills tied to the voucher
--      it reverses, in the reversal's own transaction (trigger on
--      ledger_vouchers). Nothing has to remember to tell Transport.
--
--   4. VOIDING IN TRANSPORT REVERSES THE VOUCHER (transport_fuel_fill_void),
--      also in one transaction — whether this register posted the voucher or
--      adopted one keyed in Accounts — but only when the voucher is this fill
--      and nothing else. A multi-line voucher (other heads, other vehicles) is
--      refused with its number: it is voided in Accounts, and the trigger in
--      (3) voids every fill on it.
--
--   5. RATE × QUANTITY. rate_paise is stored when the rate was entered, and
--      the table checks amount = round(rate × quantity) — the same rounding as
--      fuelAmountPaise in the app — so the book and the register cannot carry
--      different figures for the same fill.
--
--   6. NO SILENT EDITS. Once a fill is in the book its vehicle, date, fuel,
--      quantity, rate and amount are fixed, and it is never deleted; a fill is
--      voided only together with a reversal of its voucher. Correcting money
--      is void + enter again. Odometer, dealer, bill and note stay correctable.
--
-- APPLY BEFORE DEPLOYING the code that calls these functions.

alter table public.transport_fuel_fills
  add column if not exists rate_paise bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transport_fuel_fills_rate_x_qty_chk') then
    alter table public.transport_fuel_fills add constraint transport_fuel_fills_rate_x_qty_chk
      check (rate_paise is null or (rate_paise > 0 and amount_paise = round(rate_paise * quantity)));
  end if;
  -- 'accounts': keyed in Accounts → Quick / Multi-line expense.
  alter table public.transport_fuel_fills drop constraint if exists transport_fuel_fills_entry_source_chk;
  alter table public.transport_fuel_fills add constraint transport_fuel_fills_entry_source_chk
    check (entry_source in ('app', 'web', 'desk_import', 'accounts'));
end $$;

create index if not exists transport_fuel_fills_voucher_idx
  on public.transport_fuel_fills (tenant_id, voucher_id)
  where voucher_id is not null;

/* ─── Is this ledger account a fuel head? ───────────────────────── */

-- Same rule as isFuelAccount (apps/web/src/lib/fuelExpenseLine.ts): 5031,
-- or a head NAMED for vehicle fuel (the office renames heads). A bare "gas"
-- does not count — a kitchen gas cylinder is not a vehicle fill.
create or replace function public.ledger_is_fuel_account(p_code text, p_name text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_code, '') = '5031'
      or lower(coalesce(p_name, '')) ~ '\m(fuel|diesel|petrol|cng)\M';
$$;

/* ─── Guard: in the book means fixed ────────────────────────────── */

create or replace function public.transport_fuel_fills_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.voucher_id is not null then
      raise exception 'fuel fill % is in the book as % — void it, never delete it', old.id, old.voucher_no;
    end if;
    return old;
  end if;

  if old.voucher_id is not null then
    if new.vehicle_id is distinct from old.vehicle_id
       or new.fill_date is distinct from old.fill_date
       or new.fuel_type is distinct from old.fuel_type
       or new.unit is distinct from old.unit
       or new.quantity is distinct from old.quantity
       or new.rate_paise is distinct from old.rate_paise
       or new.amount_paise is distinct from old.amount_paise then
      raise exception 'fuel fill % is in the book as % — void it and enter it again to change vehicle, date, fuel, quantity, rate or amount',
        old.id, old.voucher_no;
    end if;
    if new.voucher_id is distinct from old.voucher_id
       or new.voucher_line_id is distinct from old.voucher_line_id then
      raise exception 'fuel fill % is already tied to %', old.id, old.voucher_no;
    end if;
    -- Void only with the money: the voucher must already be reversed.
    if new.voided_at is not null and old.voided_at is null and not exists (
      select 1 from public.ledger_vouchers
       where tenant_id = old.tenant_id and reverses_voucher_id = old.voucher_id
    ) then
      raise exception 'fuel fill % is in the book as % — void it in Transport → Fuel (it reverses the voucher) or void the voucher in Accounts',
        old.id, old.voucher_no;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists transport_fuel_fills_guard on public.transport_fuel_fills;
create trigger transport_fuel_fills_guard
  before update or delete on public.transport_fuel_fills
  for each row execute function public.transport_fuel_fills_guard();

/* ─── A reversal voids its fills ────────────────────────────────── */

create or replace function public.transport_fuel_fills_on_reversal()
returns trigger
language plpgsql
as $$
begin
  if new.reverses_voucher_id is null then
    return new;
  end if;
  update public.transport_fuel_fills
     set voided_at = now(),
         voided_by_name = left(coalesce(nullif(new.created_by, ''), 'Accounts'), 120),
         void_reason = left('Voucher reversed by ' || new.voucher_no
                            || case when new.reversal_reason <> '' then ' — ' || new.reversal_reason else '' end, 300),
         reversal_voucher_no = new.voucher_no
   where tenant_id = new.tenant_id
     and voucher_id = new.reverses_voucher_id
     and voided_at is null;
  return new;
end;
$$;

drop trigger if exists ledger_vouchers_void_fuel_fills on public.ledger_vouchers;
create trigger ledger_vouchers_void_fuel_fills
  after insert on public.ledger_vouchers
  for each row
  when (new.reverses_voucher_id is not null)
  execute function public.transport_fuel_fills_on_reversal();

/* ─── Post a voucher and its fills together ─────────────────────── */

-- p_voucher: the ledger_post payload (20260823141000_ledger_v2_rpc).
-- p_fills: [{ id, line_no, existing?, vehicle_id, fill_date, quantity, unit,
--             fuel_type, rate_paise?, amount_paise, odometer_km?, dealer_name,
--             bill_no, payment_mode, bank_account_id, payment_ref, note,
--             entry_source, created_by_staff_id, created_by_name }]
--   line_no is the 1-based position of the fill's debit line in p_voucher.lines.
--   existing = true ties a fill already in the register (saved, not in the book).
-- With no source on p_voucher, one fill keeps the register's own key
-- ('transport_fuel_fill', fill id); several use ('transport_fuel_fills', ids).
-- Replay-safe: the same call finds the same voucher and the same ties.
create or replace function public.transport_fuel_fill_post(
  p_tenant_id uuid,
  p_voucher jsonb,
  p_fills jsonb,
  p_actor text default ''
) returns jsonb
language plpgsql
as $$
declare
  v_lines jsonb := coalesce(p_voucher->'lines', '[]'::jsonb);
  v_fill jsonb;
  v_line jsonb;
  v_line_no integer;
  v_name text;
  v_amount bigint;
  v_ids text;
  v_n integer;
  v_payload jsonb := p_voucher;
  v_result jsonb;
  v_voucher_id uuid;
  v_voucher_no text;
  v_line_id uuid;
  v_row record;
  v_seen integer[] := '{}';
begin
  if p_tenant_id is null then
    return jsonb_build_object('ok', false, 'error', 'tenant is required');
  end if;
  if jsonb_typeof(p_fills) <> 'array' or jsonb_array_length(p_fills) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no fuel fills to post');
  end if;

  -- Every fill on its own fuel line, for exactly its amount — checked before
  -- anything is written.
  for v_fill in select * from jsonb_array_elements(p_fills) loop
    v_line_no := coalesce((v_fill->>'line_no')::integer, 0);
    if v_line_no < 1 or v_line_no > jsonb_array_length(v_lines) then
      return jsonb_build_object('ok', false, 'error',
        format('fill %s points at line %s, which the voucher does not have', v_fill->>'id', v_line_no));
    end if;
    if v_line_no = any(v_seen) then
      return jsonb_build_object('ok', false, 'error', format('two fills point at line %s', v_line_no));
    end if;
    v_seen := v_seen || v_line_no;
    v_line := v_lines->(v_line_no - 1);

    select name into v_name from public.ledger_accounts
     where tenant_id = p_tenant_id and code = v_line->>'account_code';
    if not public.ledger_is_fuel_account(v_line->>'account_code', v_name) then
      return jsonb_build_object('ok', false, 'error',
        format('line %s (%s) is not a fuel head', v_line_no, coalesce(v_name, v_line->>'account_code')));
    end if;

    if coalesce((v_fill->>'existing')::boolean, false) then
      select * into v_row from public.transport_fuel_fills
       where tenant_id = p_tenant_id and id = v_fill->>'id';
      if not found then
        return jsonb_build_object('ok', false, 'error', format('no fuel fill %s', v_fill->>'id'));
      end if;
      if v_row.voided_at is not null then
        return jsonb_build_object('ok', false, 'error', format('fuel fill %s is voided', v_fill->>'id'));
      end if;
      v_amount := v_row.amount_paise;
    else
      v_amount := coalesce((v_fill->>'amount_paise')::bigint, 0);
      -- The id is the caller's (a browser mints it so a retry lands once).
      -- If a row already holds it, it must be THIS fill — same vehicle, day,
      -- quantity, rate and amount — or the voucher would be tied to a row
      -- whose facts the amount check above never saw.
      select * into v_row from public.transport_fuel_fills
       where tenant_id = p_tenant_id and id = v_fill->>'id';
      if found and (
           v_row.vehicle_id is distinct from v_fill->>'vehicle_id'
        or v_row.fill_date is distinct from (v_fill->>'fill_date')::date
        or v_row.quantity is distinct from (v_fill->>'quantity')::numeric
        or v_row.rate_paise is distinct from nullif(v_fill->>'rate_paise', '')::bigint
        or v_row.amount_paise is distinct from v_amount
        or v_row.voided_at is not null) then
        return jsonb_build_object('ok', false, 'error',
          format('entry id %s is already used by a different fill — reload and enter it again', v_fill->>'id'));
      end if;
    end if;
    if coalesce((v_line->>'debit_paise')::bigint, 0) <> v_amount then
      return jsonb_build_object('ok', false, 'error',
        format('line %s debits %s paise but the fill is %s paise — the book and the register must carry the same figure',
               v_line_no, coalesce(v_line->>'debit_paise', '0'), v_amount));
    end if;
  end loop;

  select string_agg(f->>'id', ',' order by f->>'id'), count(*) into v_ids, v_n
    from jsonb_array_elements(p_fills) f;
  if coalesce(p_voucher->>'source_id', '') = '' then
    v_payload := v_payload || case
      when v_n = 1 then jsonb_build_object('source_type', 'transport_fuel_fill', 'source_id', v_ids)
      else jsonb_build_object('source_type', 'transport_fuel_fills', 'source_id', v_ids)
    end;
  end if;

  v_result := public.ledger_post(p_tenant_id, v_payload);
  if not coalesce((v_result->>'ok')::boolean, false) then
    return v_result;
  end if;
  v_voucher_id := (v_result->>'voucher_id')::uuid;
  v_voucher_no := v_result->>'voucher_no';

  for v_fill in select * from jsonb_array_elements(p_fills) loop
    v_line_no := (v_fill->>'line_no')::integer;
    select id into v_line_id from public.ledger_lines
     where voucher_id = v_voucher_id and line_no = v_line_no;

    if not coalesce((v_fill->>'existing')::boolean, false) then
      insert into public.transport_fuel_fills (
        id, tenant_id, vehicle_id, fill_date, quantity, unit, fuel_type, rate_paise,
        amount_paise, odometer_km, dealer_name, bill_no, payment_mode, bank_account_id,
        payment_ref, note, entry_source, created_by_staff_id, created_by_name
      ) values (
        v_fill->>'id', p_tenant_id, v_fill->>'vehicle_id', (v_fill->>'fill_date')::date,
        (v_fill->>'quantity')::numeric, v_fill->>'unit', coalesce(v_fill->>'fuel_type', ''),
        nullif(v_fill->>'rate_paise', '')::bigint, (v_fill->>'amount_paise')::bigint,
        nullif(v_fill->>'odometer_km', '')::numeric,
        left(coalesce(v_fill->>'dealer_name', ''), 120), left(coalesce(v_fill->>'bill_no', ''), 60),
        coalesce(v_fill->>'payment_mode', ''), coalesce(v_fill->>'bank_account_id', ''),
        left(coalesce(v_fill->>'payment_ref', ''), 80), left(coalesce(v_fill->>'note', ''), 500),
        coalesce(nullif(v_fill->>'entry_source', ''), 'accounts'),
        coalesce(v_fill->>'created_by_staff_id', ''), left(coalesce(v_fill->>'created_by_name', ''), 120)
      )
      on conflict (id) do nothing;
    end if;

    update public.transport_fuel_fills
       set voucher_id = v_voucher_id,
           voucher_no = v_voucher_no,
           voucher_line_id = v_line_id,
           voucher_origin = 'posted',
           posted_at = now(),
           posted_by_name = left(coalesce(p_actor, ''), 120)
     where tenant_id = p_tenant_id and id = v_fill->>'id'
       and voucher_id is null and voided_at is null;

    -- Whatever path got here, the fill must now sit on this voucher's line.
    -- A replay finds it already there; anything else is a conflict, and the
    -- exception takes the voucher back out with it.
    if not exists (
      select 1 from public.transport_fuel_fills
       where tenant_id = p_tenant_id and id = v_fill->>'id'
         and voucher_id = v_voucher_id and voucher_line_id = v_line_id
    ) then
      raise exception 'fuel fill % could not be tied to % line %', v_fill->>'id', v_voucher_no, v_line_no;
    end if;
  end loop;

  return v_result || jsonb_build_object('fill_ids', v_ids);
end;
$$;

/* ─── Void a fill, with its voucher ─────────────────────────────── */

create or replace function public.transport_fuel_fill_void(
  p_tenant_id uuid,
  p_id text,
  p_reason text,
  p_actor text default ''
) returns jsonb
language plpgsql
as $$
declare
  v_row record;
  v_rev_no text := '';
  v_other integer;
  v_result jsonb;
begin
  if coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Say why this entry is wrong');
  end if;
  select * into v_row from public.transport_fuel_fills
   where tenant_id = p_tenant_id and id = p_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Fuel entry not found');
  end if;
  if v_row.voided_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'reversal_voucher_no', v_row.reversal_voucher_no);
  end if;

  if v_row.voucher_id is not null then
    select voucher_no into v_rev_no from public.ledger_vouchers
     where tenant_id = p_tenant_id and reverses_voucher_id = v_row.voucher_id;
    if v_rev_no is null then
      v_rev_no := '';
      select count(*) into v_other from public.ledger_lines
       where voucher_id = v_row.voucher_id
         and debit_paise > 0
         and id is distinct from v_row.voucher_line_id;
      if v_other > 0 then
        return jsonb_build_object('ok', false, 'error',
          format('%s also carries %s other expense line(s) — void the whole voucher in Accounts → Vouchers; this fill turns void with it',
                 v_row.voucher_no, v_other));
      end if;
      -- The reversal's own trigger voids this fill (and stamps its number).
      v_result := public.ledger_reverse(
        p_tenant_id, v_row.voucher_id,
        left('Fuel entry voided in Transport — ' || btrim(p_reason), 300), null, coalesce(p_actor, ''));
      if not coalesce((v_result->>'ok')::boolean, false) then
        return v_result;
      end if;
      v_rev_no := v_result->>'voucher_no';
    end if;
  end if;

  update public.transport_fuel_fills
     set voided_at = coalesce(voided_at, now()),
         voided_by_name = left(coalesce(p_actor, ''), 120),
         void_reason = left(btrim(p_reason), 300),
         reversal_voucher_no = case when v_rev_no <> '' then v_rev_no else reversal_voucher_no end
   where tenant_id = p_tenant_id and id = p_id;

  return jsonb_build_object('ok', true, 'reversal_voucher_no', v_rev_no);
end;
$$;

-- Server-only, like ledger_post (20260823141000): EXECUTE on a new function
-- goes to PUBLIC by default, and Supabase also grants anon / authenticated
-- directly — both must be taken away, or the anon key could post money.
revoke all on function public.ledger_is_fuel_account(text, text) from public;
revoke all on function public.transport_fuel_fill_post(uuid, jsonb, jsonb, text) from public;
revoke all on function public.transport_fuel_fill_void(uuid, text, text, text) from public;
revoke all on function public.transport_fuel_fills_guard() from public;
revoke all on function public.transport_fuel_fills_on_reversal() from public;
revoke all on function public.ledger_is_fuel_account(text, text) from anon, authenticated;
revoke all on function public.transport_fuel_fill_post(uuid, jsonb, jsonb, text) from anon, authenticated;
revoke all on function public.transport_fuel_fill_void(uuid, text, text, text) from anon, authenticated;
revoke all on function public.transport_fuel_fills_guard() from anon, authenticated;
revoke all on function public.transport_fuel_fills_on_reversal() from anon, authenticated;
grant execute on function public.ledger_is_fuel_account(text, text) to service_role;
grant execute on function public.transport_fuel_fill_post(uuid, jsonb, jsonb, text) to service_role;
grant execute on function public.transport_fuel_fill_void(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
