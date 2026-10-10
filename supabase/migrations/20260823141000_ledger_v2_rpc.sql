-- Ledger v2 — the posting API.
--
-- Everything that reaches the book goes through ledger_post. It is the only
-- writer, which is what lets the guarantees in the core migration hold:
-- balance, period, numbering, idempotency and audit are checked in one place
-- inside one transaction, rather than being re-implemented (and eventually
-- mis-implemented) at each of the dozen call sites that post money today.
--
-- A correction is ledger_reverse, never an edit — the append-only triggers
-- make that the only option, deliberately.
--
-- All of these take p_tenant_id explicitly and run without security definer:
-- they are reached over the service_role connection only, exactly like
-- sis_promote_enrollment.

/* ─── Period status ─────────────────────────────────────────── */

-- 'closed' beats 'locked' beats 'open'. A closed fiscal year closes every
-- month inside it regardless of what the period rows say.
create or replace function public.ledger_period_status(
  p_tenant_id uuid,
  p_date date
) returns text
language plpgsql
stable
as $$
declare
  v_fy_status text;
  v_period_status text;
begin
  select status into v_fy_status
  from public.ledger_fiscal_years
  where tenant_id = p_tenant_id
    and start_date <= p_date
    and end_date >= p_date
  limit 1;

  if v_fy_status = 'closed' then
    return 'closed';
  end if;

  select status into v_period_status
  from public.ledger_periods
  where tenant_id = p_tenant_id
    and period = to_char(p_date, 'YYYY-MM')
  limit 1;

  return coalesce(v_period_status, 'open');
end;
$$;

/* ─── Post a voucher ────────────────────────────────────────── */

-- p_voucher shape:
--   {
--     "voucher_type": "receipt",
--     "date": "2026-08-23",
--     "narration": "Fee receipt RC-0001",
--     "source_type": "fee_voucher",
--     "source_id": "fee_v_abc",
--     "created_by": "director",
--     "lines": [
--       {
--         "account_code": "1000",
--         "debit_paise": 500000,
--         "credit_paise": 0,
--         "narration": "Cash",
--         "subledger_kind": "cash_pool",       -- optional
--         "subledger_id": "pool_drawer",       -- optional
--         "cost_centre_code": "school",        -- optional
--         "party": {                            -- optional, upserted
--           "kind": "household", "external_id": "hh_1", "name": "Sharma"
--         },
--         "instrument": {                       -- optional
--           "mode": "upi", "ref": "UTR123", "date": "2026-08-23"
--         }
--       }
--     ]
--   }
--
-- Returns {ok, voucher_id, voucher_no, created} — `created` is false when the
-- source event had already been posted, which is what makes replay safe.
create or replace function public.ledger_post(
  p_tenant_id uuid,
  p_voucher jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_type text := coalesce(p_voucher->>'voucher_type', 'journal');
  v_date date;
  v_source_type text := coalesce(p_voucher->>'source_type', '');
  v_source_id text := coalesce(p_voucher->>'source_id', '');
  v_created_by text := coalesce(p_voucher->>'created_by', '');
  v_narration text := coalesce(p_voucher->>'narration', '');
  v_lines jsonb := coalesce(p_voucher->'lines', '[]'::jsonb);
  v_line jsonb;
  v_debit bigint := 0;
  v_credit bigint := 0;
  v_fy_code text;
  v_seq integer;
  v_voucher_id uuid;
  v_voucher_no text;
  v_existing record;
  v_period_status text;
  v_account_id uuid;
  v_party_id uuid;
  v_cc_id uuid;
  v_line_no integer := 0;
  v_prefix text;
begin
  if p_tenant_id is null then
    return jsonb_build_object('ok', false, 'error', 'tenant is required');
  end if;

  begin
    v_date := (p_voucher->>'date')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'a valid posting date is required');
  end;
  if v_date is null then
    return jsonb_build_object('ok', false, 'error', 'a valid posting date is required');
  end if;

  -- Idempotency first: a replay must not even look like work.
  if v_source_id <> '' then
    select id, voucher_no into v_existing
    from public.ledger_vouchers
    where tenant_id = p_tenant_id
      and source_type = v_source_type
      and source_id = v_source_id;
    if found then
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'voucher_id', v_existing.id,
        'voucher_no', v_existing.voucher_no
      );
    end if;
  end if;

  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('ok', false, 'error', 'a voucher needs at least one line');
  end if;

  -- Balance and account codes are both checked before anything is written.
  --
  -- The account lookup has to happen here rather than in the insert loop
  -- below: a plpgsql `return` does not undo inserts already made in the same
  -- function, so discovering a bad code after the voucher header is written
  -- would leave an orphan header behind. Validating up front lets a bad
  -- payload come back as a clean {ok:false} instead of an exception.
  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_debit := v_debit + coalesce((v_line->>'debit_paise')::bigint, 0);
    v_credit := v_credit + coalesce((v_line->>'credit_paise')::bigint, 0);

    if not exists (
      select 1 from public.ledger_accounts
      where tenant_id = p_tenant_id and code = v_line->>'account_code'
    ) then
      return jsonb_build_object(
        'ok', false,
        'error', format('no ledger account with code %s',
                        coalesce(v_line->>'account_code', '(missing)'))
      );
    end if;

    if coalesce((v_line->>'debit_paise')::bigint, 0) > 0
       and coalesce((v_line->>'credit_paise')::bigint, 0) > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'a line is either a debit or a credit, never both'
      );
    end if;
  end loop;

  if v_debit <> v_credit then
    return jsonb_build_object(
      'ok', false,
      'error', format('voucher is not balanced — Dr %s vs Cr %s', v_debit, v_credit)
    );
  end if;
  if v_debit <= 0 then
    return jsonb_build_object('ok', false, 'error', 'voucher amount must be greater than zero');
  end if;

  -- Period must accept the date.
  v_period_status := public.ledger_period_status(p_tenant_id, v_date);
  if v_period_status <> 'open' then
    return jsonb_build_object(
      'ok', false,
      'error', format('the period covering %s is %s — reopen it to post', v_date, v_period_status)
    );
  end if;

  -- A voucher must belong to a fiscal year.
  --
  -- The alternative — filing it under a blank year — looks harmless and is
  -- not: the voucher would be invisible to every annual statement while still
  -- sitting in the trial balance, and its number would share a bucket with
  -- every other orphan. An undefined year is a masters gap the operator can
  -- fix in seconds; a posting that quietly belongs to no year is a
  -- reconciliation someone loses a day to next March.
  select code into v_fy_code
  from public.ledger_fiscal_years
  where tenant_id = p_tenant_id
    and start_date <= v_date
    and end_date >= v_date
  limit 1;

  if v_fy_code is null then
    return jsonb_build_object(
      'ok', false,
      'error', format('no fiscal year covers %s — define it before posting', v_date)
    );
  end if;

  -- Gap-free numbering. The advisory lock is held to the end of the
  -- transaction, so two concurrent postings of the same type and year queue
  -- rather than racing to the same seq_no.
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || v_type || v_fy_code));

  select coalesce(max(seq_no), 0) + 1 into v_seq
  from public.ledger_vouchers
  where tenant_id = p_tenant_id and voucher_type = v_type and fy_code = v_fy_code;

  v_prefix := case v_type
    when 'receipt' then 'RC' when 'payment' then 'PY' when 'contra' then 'CN'
    when 'journal' then 'JV' when 'purchase' then 'PU' when 'sales' then 'SL'
    when 'payroll' then 'PR' when 'opening' then 'OB' when 'closing' then 'CL'
    when 'reversal' then 'RV' else 'JV' end;
  v_voucher_no := v_prefix || '/' || v_fy_code || '/' || lpad(v_seq::text, 5, '0');

  insert into public.ledger_vouchers (
    tenant_id, voucher_type, fy_code, seq_no, voucher_no, voucher_date,
    narration, source_type, source_id, reverses_voucher_id, reversal_reason, created_by
  ) values (
    p_tenant_id, v_type, v_fy_code, v_seq, v_voucher_no, v_date,
    v_narration, v_source_type, v_source_id,
    nullif(p_voucher->>'reverses_voucher_id', '')::uuid,
    coalesce(p_voucher->>'reversal_reason', ''),
    v_created_by
  )
  returning id into v_voucher_id;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_line_no := v_line_no + 1;

    select id into v_account_id
    from public.ledger_accounts
    where tenant_id = p_tenant_id and code = v_line->>'account_code';
    if v_account_id is null then
      raise exception 'no ledger account with code %', coalesce(v_line->>'account_code', '(null)');
    end if;

    -- Parties are upserted on the way past: the originating desk owns the
    -- master, the ledger just needs a stable row to hang the balance on.
    v_party_id := null;
    if v_line ? 'party' and coalesce(v_line->'party'->>'external_id', '') <> '' then
      insert into public.ledger_parties (tenant_id, kind, external_id, name)
      values (
        p_tenant_id,
        coalesce(v_line->'party'->>'kind', 'other'),
        v_line->'party'->>'external_id',
        coalesce(v_line->'party'->>'name', '')
      )
      on conflict (tenant_id, kind, external_id) do update
        set name = case
              when excluded.name <> '' then excluded.name
              else public.ledger_parties.name
            end,
            updated_at = now()
      returning id into v_party_id;
    end if;

    v_cc_id := null;
    if coalesce(v_line->>'cost_centre_code', '') <> '' then
      select id into v_cc_id
      from public.ledger_cost_centres
      where tenant_id = p_tenant_id and code = v_line->>'cost_centre_code';
    end if;

    insert into public.ledger_lines (
      tenant_id, voucher_id, line_no, account_id, party_id, cost_centre_id,
      subledger_kind, subledger_id, debit_paise, credit_paise, narration,
      instrument_mode, instrument_ref, instrument_date
    ) values (
      p_tenant_id, v_voucher_id, v_line_no, v_account_id, v_party_id, v_cc_id,
      coalesce(v_line->>'subledger_kind', ''),
      coalesce(v_line->>'subledger_id', ''),
      coalesce((v_line->>'debit_paise')::bigint, 0),
      coalesce((v_line->>'credit_paise')::bigint, 0),
      coalesce(v_line->>'narration', ''),
      coalesce(v_line->'instrument'->>'mode', ''),
      coalesce(v_line->'instrument'->>'ref', ''),
      nullif(v_line->'instrument'->>'date', '')::date
    );
  end loop;

  insert into public.ledger_audit (tenant_id, actor, action, detail)
  values (
    p_tenant_id, v_created_by, 'post',
    jsonb_build_object(
      'voucher_id', v_voucher_id, 'voucher_no', v_voucher_no,
      'type', v_type, 'amount_paise', v_debit,
      'source_type', v_source_type, 'source_id', v_source_id
    )
  );

  return jsonb_build_object(
    'ok', true, 'created', true,
    'voucher_id', v_voucher_id, 'voucher_no', v_voucher_no,
    'amount_paise', v_debit
  );
end;
$$;

/* ─── Reverse a voucher ─────────────────────────────────────── */

-- The only correction. Mirrors every line of the original with the sides
-- swapped, on a date of the caller's choosing (a mistake found in a later
-- month is reversed in that month, not back-dated into a closed one).
--
-- Idempotent: a voucher that already has a reversal returns it rather than
-- posting a second one, so the retry queue can replay this safely.
create or replace function public.ledger_reverse(
  p_tenant_id uuid,
  p_voucher_id uuid,
  p_reason text default '',
  p_date date default null,
  p_created_by text default ''
) returns jsonb
language plpgsql
as $$
declare
  v_orig record;
  v_existing record;
  v_date date;
  v_lines jsonb;
  v_payload jsonb;
  v_result jsonb;
begin
  select * into v_orig
  from public.ledger_vouchers
  where tenant_id = p_tenant_id and id = p_voucher_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'voucher not found');
  end if;

  if v_orig.voucher_type = 'reversal' then
    return jsonb_build_object('ok', false, 'error', 'a reversal cannot itself be reversed');
  end if;

  select id, voucher_no into v_existing
  from public.ledger_vouchers
  where tenant_id = p_tenant_id and reverses_voucher_id = p_voucher_id;
  if found then
    return jsonb_build_object(
      'ok', true, 'created', false,
      'voucher_id', v_existing.id, 'voucher_no', v_existing.voucher_no
    );
  end if;

  v_date := coalesce(p_date, v_orig.voucher_date);

  -- Swap every side, and carry across everything the original line was tagged
  -- with — account, party, cost centre, sub-ledger, instrument.
  --
  -- Party and cost centre are easy to forget here and the omission is close to
  -- invisible: the trial balance still ties, because the account codes match.
  -- What breaks is the party sub-ledger — a reversed receipt leaves the
  -- household still showing a balance it no longer owes — and any report cut
  -- by cost centre. Caught on the verification project on 2026-08-23, where a
  -- fully reversed receipt left its household at -12,000.00.
  select jsonb_agg(
    jsonb_build_object(
      'account_code', a.code,
      'debit_paise', l.credit_paise,
      'credit_paise', l.debit_paise,
      'narration', case when l.narration = '' then 'Reversal' else 'Reversal · ' || l.narration end,
      'subledger_kind', l.subledger_kind,
      'subledger_id', l.subledger_id,
      'cost_centre_code', coalesce(cc.code, ''),
      'party', case
        when p.id is null then null
        else jsonb_build_object('kind', p.kind, 'external_id', p.external_id, 'name', p.name)
      end,
      'instrument', jsonb_build_object(
        'mode', l.instrument_mode, 'ref', l.instrument_ref, 'date', l.instrument_date
      )
    ) order by l.line_no
  ) into v_lines
  from public.ledger_lines l
  join public.ledger_accounts a on a.id = l.account_id
  left join public.ledger_parties p on p.id = l.party_id
  left join public.ledger_cost_centres cc on cc.id = l.cost_centre_id
  where l.voucher_id = p_voucher_id;

  v_payload := jsonb_build_object(
    'voucher_type', 'reversal',
    'date', v_date,
    'narration', 'Reversal of ' || v_orig.voucher_no ||
                 case when p_reason = '' then '' else ' — ' || p_reason end,
    'source_type', 'ledger_reversal',
    'source_id', p_voucher_id::text,
    'created_by', p_created_by,
    'reverses_voucher_id', p_voucher_id::text,
    'reversal_reason', p_reason,
    'lines', v_lines
  );

  v_result := public.ledger_post(p_tenant_id, v_payload);
  return v_result;
end;
$$;

/* ─── Period lock / fiscal year close ───────────────────────── */

create or replace function public.ledger_lock_period(
  p_tenant_id uuid,
  p_period text,
  p_status text default 'locked',
  p_actor text default '',
  p_note text default ''
) returns jsonb
language plpgsql
as $$
declare
  v_fy_code text;
begin
  if p_status not in ('open', 'locked', 'closed') then
    return jsonb_build_object('ok', false, 'error', 'status must be open, locked or closed');
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('ok', false, 'error', 'period must look like YYYY-MM');
  end if;

  select code into v_fy_code
  from public.ledger_fiscal_years
  where tenant_id = p_tenant_id
    and start_date <= (p_period || '-01')::date
    and end_date >= (p_period || '-01')::date
  limit 1;

  insert into public.ledger_periods (tenant_id, period, fy_code, status, locked_by, locked_at, note)
  values (
    p_tenant_id, p_period, coalesce(v_fy_code, ''), p_status, p_actor,
    case when p_status = 'open' then null else now() end,
    p_note
  )
  on conflict (tenant_id, period) do update
    set status = excluded.status,
        fy_code = excluded.fy_code,
        locked_by = excluded.locked_by,
        locked_at = excluded.locked_at,
        note = excluded.note;

  insert into public.ledger_audit (tenant_id, actor, action, detail)
  values (p_tenant_id, p_actor, 'lock_period',
          jsonb_build_object('period', p_period, 'status', p_status, 'note', p_note));

  return jsonb_build_object('ok', true, 'period', p_period, 'status', p_status);
end;
$$;

-- Closing a year sweeps income and expense into the surplus account and then
-- marks the year closed. The closing voucher is a normal voucher, so it is
-- visible, numbered and reversible like anything else.
create or replace function public.ledger_close_fiscal_year(
  p_tenant_id uuid,
  p_fy_code text,
  p_surplus_account_code text,
  p_actor text default ''
) returns jsonb
language plpgsql
as $$
declare
  v_fy record;
  v_lines jsonb;
  v_net bigint;
  v_result jsonb;
begin
  select * into v_fy
  from public.ledger_fiscal_years
  where tenant_id = p_tenant_id and code = p_fy_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'fiscal year not found');
  end if;
  if v_fy.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'fiscal year is already closed');
  end if;
  if not exists (
    select 1 from public.ledger_accounts
    where tenant_id = p_tenant_id and code = p_surplus_account_code
  ) then
    return jsonb_build_object('ok', false, 'error', 'surplus account code not found');
  end if;

  -- Income and expense balances for the year, each closed off against itself.
  with movement as (
    select
      a.code,
      a.kind,
      sum(l.debit_paise) as dr,
      sum(l.credit_paise) as cr
    from public.ledger_lines l
    join public.ledger_accounts a on a.id = l.account_id
    join public.ledger_vouchers v on v.id = l.voucher_id
    where l.tenant_id = p_tenant_id
      and a.kind in ('income', 'expense')
      and v.voucher_date between v_fy.start_date and v_fy.end_date
    group by a.code, a.kind
    having sum(l.debit_paise) <> sum(l.credit_paise)
  )
  select
    jsonb_agg(
      jsonb_build_object(
        'account_code', code,
        'debit_paise', case when cr > dr then cr - dr else 0 end,
        'credit_paise', case when dr > cr then dr - cr else 0 end,
        'narration', 'Year-end close'
      )
    ),
    sum(cr - dr)
  into v_lines, v_net
  from movement;

  if v_lines is null then
    -- Nothing to sweep; just close the year.
    update public.ledger_fiscal_years
      set status = 'closed', closed_by = p_actor, closed_at = now(), updated_at = now()
      where tenant_id = p_tenant_id and code = p_fy_code;
    insert into public.ledger_audit (tenant_id, actor, action, detail)
    values (p_tenant_id, p_actor, 'close_fy',
            jsonb_build_object('fy', p_fy_code, 'surplus_paise', 0));
    return jsonb_build_object('ok', true, 'fy', p_fy_code, 'surplus_paise', 0, 'voucher_id', null);
  end if;

  -- v_net > 0 is a surplus: income exceeded expense, so equity is credited.
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object(
      'account_code', p_surplus_account_code,
      'debit_paise', case when v_net < 0 then -v_net else 0 end,
      'credit_paise', case when v_net > 0 then v_net else 0 end,
      'narration', 'Surplus / (deficit) carried to corpus'
    )
  );

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'closing',
    'date', v_fy.end_date,
    'narration', 'Year-end close ' || p_fy_code,
    'source_type', 'ledger_close',
    'source_id', p_fy_code,
    'created_by', p_actor,
    'lines', v_lines
  ));

  if not (v_result->>'ok')::boolean then
    return v_result;
  end if;

  update public.ledger_fiscal_years
    set status = 'closed', closed_by = p_actor, closed_at = now(), updated_at = now()
    where tenant_id = p_tenant_id and code = p_fy_code;

  insert into public.ledger_audit (tenant_id, actor, action, detail)
  values (p_tenant_id, p_actor, 'close_fy',
          jsonb_build_object('fy', p_fy_code, 'surplus_paise', v_net,
                             'voucher_id', v_result->>'voucher_id'));

  return jsonb_build_object(
    'ok', true, 'fy', p_fy_code, 'surplus_paise', v_net,
    'voucher_id', v_result->>'voucher_id',
    'voucher_no', v_result->>'voucher_no'
  );
end;
$$;

/* ─── Opening balances ──────────────────────────────────────── */

-- The one-time bridge out of Tally: the CA's audited closing trial balance
-- becomes a single opening voucher dated the first day of the year.
--
-- p_rows: [{"account_code":"1000","debit_paise":0,"credit_paise":0}, ...]
-- Refuses an unbalanced trial balance, which is the whole point of loading it
-- this way rather than seeding numbers into a balances column.
create or replace function public.ledger_open_balances(
  p_tenant_id uuid,
  p_fy_code text,
  p_rows jsonb,
  p_created_by text default ''
) returns jsonb
language plpgsql
as $$
declare
  v_fy record;
  v_result jsonb;
  v_attempts integer;
  v_source_id text;
begin
  select * into v_fy
  from public.ledger_fiscal_years
  where tenant_id = p_tenant_id and code = p_fy_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'fiscal year not found');
  end if;

  -- Loading opening balances twice for the same year must not double the
  -- corpus, so this is idempotent — but only while the load still stands.
  --
  -- Keying it on the year alone was subtly wrong: after reversing a wrong
  -- load, a corrected one would match the same key, return the reversed
  -- original, and report success while the corrected figures never reached
  -- the book. A load that has been reversed is spent; the next one gets its
  -- own key.
  if exists (
    select 1
    from public.ledger_vouchers v
    where v.tenant_id = p_tenant_id
      and v.source_type = 'ledger_opening'
      and v.source_id like p_fy_code || '%'
      and not exists (
        select 1 from public.ledger_vouchers r
        where r.reverses_voucher_id = v.id
      )
  ) then
    -- A live opening voucher already exists: hand it back untouched.
    v_source_id := (
      select v.source_id
      from public.ledger_vouchers v
      where v.tenant_id = p_tenant_id
        and v.source_type = 'ledger_opening'
        and v.source_id like p_fy_code || '%'
        and not exists (
          select 1 from public.ledger_vouchers r where r.reverses_voucher_id = v.id
        )
      limit 1
    );
  else
    select count(*) into v_attempts
    from public.ledger_vouchers
    where tenant_id = p_tenant_id
      and source_type = 'ledger_opening'
      and source_id like p_fy_code || '%';
    v_source_id := case
      when v_attempts = 0 then p_fy_code
      else p_fy_code || '#' || (v_attempts + 1)::text
    end;
  end if;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'opening',
    'date', v_fy.start_date,
    'narration', 'Opening balances ' || p_fy_code,
    'source_type', 'ledger_opening',
    'source_id', v_source_id,
    'created_by', p_created_by,
    'lines', p_rows
  ));

  return v_result;
end;
$$;


/* ─── Access ────────────────────────────────────────────────── */
--
-- These functions are the only writer to the book, and they take the tenant as
-- an argument rather than deriving it from a session — so anything able to
-- call them can post to any tenant. They belong to service_role alone.
--
-- Both revokes are needed and neither is redundant. EXECUTE on a new function
-- is granted to PUBLIC implicitly, and a stock Supabase project additionally
-- grants it to `anon` and `authenticated` explicitly — revoking PUBLIC does
-- not touch an explicit grant. Miss the second line and `ledger_post` stays
-- callable with the anon key that ships in the browser bundle, against any
-- tenant id the caller cares to name.

revoke all on function public.ledger_period_status(uuid, date) from public;
revoke all on function public.ledger_post(uuid, jsonb) from public;
revoke all on function public.ledger_reverse(uuid, uuid, text, date, text) from public;
revoke all on function public.ledger_lock_period(uuid, text, text, text, text) from public;
revoke all on function public.ledger_close_fiscal_year(uuid, text, text, text) from public;
revoke all on function public.ledger_open_balances(uuid, text, jsonb, text) from public;

revoke all on function public.ledger_period_status(uuid, date) from anon, authenticated;
revoke all on function public.ledger_post(uuid, jsonb) from anon, authenticated;
revoke all on function public.ledger_reverse(uuid, uuid, text, date, text) from anon, authenticated;
revoke all on function public.ledger_lock_period(uuid, text, text, text, text) from anon, authenticated;
revoke all on function public.ledger_close_fiscal_year(uuid, text, text, text) from anon, authenticated;
revoke all on function public.ledger_open_balances(uuid, text, jsonb, text) from anon, authenticated;

grant execute on function public.ledger_period_status(uuid, date) to service_role;
grant execute on function public.ledger_post(uuid, jsonb) to service_role;
grant execute on function public.ledger_reverse(uuid, uuid, text, date, text) to service_role;
grant execute on function public.ledger_lock_period(uuid, text, text, text, text) to service_role;
grant execute on function public.ledger_close_fiscal_year(uuid, text, text, text) to service_role;
grant execute on function public.ledger_open_balances(uuid, text, jsonb, text) to service_role;
