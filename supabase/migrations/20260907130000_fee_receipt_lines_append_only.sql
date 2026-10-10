-- A fee receipt's breakdown is a record of what happened, not editable state.
--
-- THIS IS THE CAUSE UNDERNEATH THIS WEEK'S FOUR INCIDENTS. Each looked like a
-- different bug and each got its own patch; all four were the same thing —
-- two copies of the truth and a full-snapshot sync that could overwrite in
-- either direction, with no event log to replay:
--
--   2026-09-01  a truncated read (PostgREST's 1000-row cap) pushed emptiness
--               over the server: 134 receipts lost their lines.
--   2026-09-06  a laptop's push deleted every line, the insert died, nothing
--               was put back: 1,913 lines, ₹20.8 lakh with no student, head
--               or month.
--   2026-09-07  a failed line write left the header committed without it:
--               seven receipts, ₹34,500, blank.
--   2026-09-07  hydration with preferDb copied the server's EMPTY receipts
--               over the browser's good ones — destroying the last copy.
--
-- Making each overwrite safer is whack-a-mole, because the overwrite is the
-- design. The ledger has lost nothing in the same week, and the reason is one
-- line of DDL: ledger_lines refuses UPDATE and DELETE outright, so a
-- correction has to be an explicit, recorded act. This gives fee receipts the
-- same property.
--
-- WHAT CHANGES
--   * lines and tenders may be INSERTed — a receipt whose breakdown has never
--     been stored can still receive one, which is how the seven blanks get
--     repaired and how any offline receipt lands;
--   * they may NOT be UPDATEd or DELETEd by an ordinary write. The desk sync
--     therefore cannot rewrite or empty a receipt that already has its lines,
--     whatever state the pushing browser is in;
--   * an explicit, deliberate correction — Re-attach, or a void-and-reissue —
--     sets `bhb.receipt_edit` for its transaction and is allowed through. That
--     is the equivalent of ledger_reverse(): corrections stay possible, but
--     they have to be asked for by name, by a person, on a path that records
--     it.
--
-- A refusal is now SAFE, which is what makes this enforceable today rather
-- than after a month of observation: since 20260907110000 the whole push is
-- one transaction, so a refused write changes nothing at all and the server
-- keeps what it had. The worst case is a push that fails loudly — and the app
-- logs the Postgres message since the same commit.

create or replace function public.fee_receipt_refuse_mutation()
returns trigger
language plpgsql
as $$
begin
  -- An explicit correction announces itself. `set_config(..., true)` is
  -- transaction-local, so the permission cannot leak into the next statement
  -- on a pooled connection.
  if coalesce(current_setting('bhb.receipt_edit', true), '') = 'repair' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  raise exception
    '% is append-only: a receipt records money that was taken. To change what '
    'a receipt settled use Fees → Receipts → Re-attach (which records who '
    'changed it); to undo the receipt itself, void and reissue. A desk sync '
    'may add the lines of a receipt that has none, never rewrite or remove '
    'the lines of one that has them.',
    tg_table_name;
end;
$$;

drop trigger if exists fee_desk_voucher_lines_append_only on public.fee_desk_voucher_lines;
create trigger fee_desk_voucher_lines_append_only
  before update or delete on public.fee_desk_voucher_lines
  for each row execute function public.fee_receipt_refuse_mutation();

drop trigger if exists fee_desk_voucher_tenders_append_only on public.fee_desk_voucher_tenders;
create trigger fee_desk_voucher_tenders_append_only
  before update or delete on public.fee_desk_voucher_tenders
  for each row execute function public.fee_receipt_refuse_mutation();

-- ── The desk push: fill in, never overwrite ────────────────────────────────
--
-- The delete is gone. A voucher whose lines the server already holds is left
-- exactly as it is, no matter what the pushing browser believes — which is
-- the whole point, because the pushing browser has been wrong four times this
-- week. A voucher with no lines still gets them, so an offline receipt lands
-- and the blanks can be filled.

create or replace function public.replace_fee_desk_voucher_lines(
  p_tenant_id uuid,
  p_line_voucher_ids text[],
  p_tender_voucher_ids text[],
  p_lines jsonb,
  p_tenders jsonb,
  p_headers jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lines int := 0;
  v_tenders int := 0;
  v_headers int := 0;
  v_kept_lines int := 0;
  v_kept_tenders int := 0;
  cols text;
begin
  if p_tenant_id is null then
    raise exception 'replace_fee_desk_voucher_lines: tenant_id is required';
  end if;

  -- Headers stay mutable: voiding a receipt, and stamping whatsapp_sent_at,
  -- are legitimate updates to the receipt's own row. What must never change
  -- is what it says the money PAID FOR.
  if p_headers is not null
     and jsonb_typeof(p_headers) = 'array'
     and jsonb_array_length(p_headers) > 0 then
    select string_agg(quote_ident(k), ', ')
      into cols
      from (
        select distinct jsonb_object_keys(e) as k
          from jsonb_array_elements(p_headers) e
      ) keys
     where exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'fee_desk_vouchers'
          and c.column_name = keys.k
     );
    if cols is null then
      raise exception 'replace_fee_desk_voucher_lines: no header key matches a column';
    end if;
    execute format(
      'insert into public.fee_desk_vouchers (%s) select %s from '
      || 'jsonb_populate_recordset(null::public.fee_desk_vouchers, %L) '
      || 'on conflict (id) do update set %s',
      cols, cols, p_headers,
      (select string_agg(format('%1$s = excluded.%1$s', c), ', ')
         from unnest(string_to_array(cols, ', ')) c
        where c <> 'id')
    );
    get diagnostics v_headers = row_count;
  end if;

  if p_line_voucher_ids is not null and array_length(p_line_voucher_ids, 1) > 0 then
    select count(*) into v_kept_lines
      from (
        select distinct l.voucher_id
          from public.fee_desk_voucher_lines l
         where l.tenant_id = p_tenant_id
           and l.voucher_id = any (p_line_voucher_ids)
      ) already;

    insert into public.fee_desk_voucher_lines
      (id, voucher_id, tenant_id, student_id, due_key, kind, label, amount_paise, line_json)
    select
      e ->> 'id',
      e ->> 'voucher_id',
      p_tenant_id,
      e ->> 'student_id',
      e ->> 'due_key',
      e ->> 'kind',
      e ->> 'label',
      (e ->> 'amount_paise')::bigint,
      coalesce(e -> 'line_json', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as e
    where not exists (
      select 1 from public.fee_desk_voucher_lines l
       where l.tenant_id = p_tenant_id
         and l.voucher_id = e ->> 'voucher_id'
    );
    get diagnostics v_lines = row_count;
  end if;

  if p_tender_voucher_ids is not null and array_length(p_tender_voucher_ids, 1) > 0 then
    select count(*) into v_kept_tenders
      from (
        select distinct t.voucher_id
          from public.fee_desk_voucher_tenders t
         where t.tenant_id = p_tenant_id
           and t.voucher_id = any (p_tender_voucher_ids)
      ) already;

    insert into public.fee_desk_voucher_tenders
      (id, voucher_id, tenant_id, tender_index, mode, amount_paise, ref,
       instrument_date, bank_name, realisation, tender_json)
    select
      e ->> 'id',
      e ->> 'voucher_id',
      p_tenant_id,
      (e ->> 'tender_index')::int,
      e ->> 'mode',
      (e ->> 'amount_paise')::bigint,
      coalesce(e ->> 'ref', ''),
      nullif(e ->> 'instrument_date', '')::date,
      coalesce(e ->> 'bank_name', ''),
      coalesce(e ->> 'realisation', ''),
      coalesce(e -> 'tender_json', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_tenders, '[]'::jsonb)) as e
    where not exists (
      select 1 from public.fee_desk_voucher_tenders t
       where t.tenant_id = p_tenant_id
         and t.voucher_id = e ->> 'voucher_id'
    );
    get diagnostics v_tenders = row_count;
  end if;

  return jsonb_build_object(
    'headers', v_headers,
    'lines', v_lines,
    'tenders', v_tenders,
    'keptLineVouchers', v_kept_lines,
    'keptTenderVouchers', v_kept_tenders
  );
end;
$$;

-- ── The explicit correction ────────────────────────────────────────────────
--
-- Re-attach, and nothing else, replaces what a receipt settled. It announces
-- itself to the trigger, takes the actor for the audit trail, and refuses an
-- allocation that does not equal the money collected — because the one thing
-- a repair must never do is quietly change how much was taken.

create or replace function public.repair_fee_receipt_allocation(
  p_tenant_id uuid,
  p_voucher_id text,
  p_lines jsonb,
  p_actor text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_alloc bigint;
  v_rows int := 0;
begin
  if p_tenant_id is null or coalesce(p_voucher_id, '') = '' then
    raise exception 'repair_fee_receipt_allocation: tenant and voucher are required';
  end if;

  select total_paise into v_total
    from public.fee_desk_vouchers
   where tenant_id = p_tenant_id and id = p_voucher_id;
  if v_total is null then
    raise exception 'repair_fee_receipt_allocation: receipt % not found', p_voucher_id;
  end if;

  select coalesce(sum((e ->> 'amount_paise')::bigint), 0) into v_alloc
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e;

  if v_alloc <> v_total then
    raise exception
      'repair_fee_receipt_allocation: the breakdown adds to % paise but the receipt took % paise. '
      'A repair may say what the money settled; it may never change how much was taken.',
      v_alloc, v_total;
  end if;

  -- Announce the correction to the append-only trigger, for this transaction
  -- only.
  perform set_config('bhb.receipt_edit', 'repair', true);

  delete from public.fee_desk_voucher_lines
   where tenant_id = p_tenant_id and voucher_id = p_voucher_id;

  insert into public.fee_desk_voucher_lines
    (id, voucher_id, tenant_id, student_id, due_key, kind, label, amount_paise, line_json)
  select
    e ->> 'id',
    p_voucher_id,
    p_tenant_id,
    e ->> 'student_id',
    e ->> 'due_key',
    e ->> 'kind',
    e ->> 'label',
    (e ->> 'amount_paise')::bigint,
    coalesce(e -> 'line_json', '{}'::jsonb)
       || jsonb_build_object('repairedAt', now(), 'repairedBy', coalesce(p_actor, ''))
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as e;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('lines', v_rows, 'totalPaise', v_total);
end;
$$;

grant execute on function public.replace_fee_desk_voucher_lines(
  uuid, text[], text[], jsonb, jsonb, jsonb
) to service_role;
grant execute on function public.repair_fee_receipt_allocation(
  uuid, text, jsonb, text
) to service_role;
