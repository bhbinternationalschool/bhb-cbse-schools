-- Behavioural test for the learning-games tables
-- (20261020100000_learning_games — review fixes of 21 Oct 2026).
--
-- Runs in CI against the E2E stack (every migration on Postgres 17):
--   bash scripts/e2e-stack.sh sql-test supabase/tests/learning_games.test.sql
-- It makes its own probe school, works inside one transaction and rolls it
-- back — nothing it does survives. Any failed check raises.
--
--  1. Nothing is granted to the browser's roles (anon, authenticated).
--  2. play_until can never be later than 21:00 (and is "HH:MM").
--  3. A competition window is at most 60 minutes, on one IST day.
--  4. game_questions has the import batch column ("approve all" per batch).

\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;

-- The SQLSTATE a statement ends with ('ok' when it succeeds).
create or replace function pg_temp.state_of(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v = returned_sqlstate;
  return v;
end $$;

do $test$
declare
  t uuid := gen_random_uuid();
  tbl text;
  role_name text;
  priv text;
  ins text;
begin
  -- 1. No grants to the browser's roles.
  foreach tbl in array array['game_settings', 'game_questions', 'game_competitions', 'game_sessions', 'game_answers'] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      foreach priv in array array['select', 'insert', 'update', 'delete'] loop
        perform pg_temp.check(not has_table_privilege(role_name, 'public.' || tbl, priv), format('%s has no %s on %s', role_name, priv, tbl));
      end loop;
    end loop;
    perform pg_temp.check(has_table_privilege('service_role', 'public.' || tbl, 'insert'), format('service_role writes %s', tbl));
    perform pg_temp.check((select relrowsecurity from pg_class where oid = ('public.' || tbl)::regclass), format('RLS is on for %s', tbl));
  end loop;

  insert into public.tenants (id, slug, name) values (t, 'games-probe-' || left(t::text, 8), 'Games probe');

  -- 2. 9 pm is the latest.
  ins := format('insert into public.game_settings (tenant_id, play_until) values (%L, %%L) on conflict (tenant_id) do update set play_until = excluded.play_until', t);
  perform pg_temp.check(pg_temp.state_of(format(ins, '22:00')) = '23514', 'play_until 22:00 is refused');
  perform pg_temp.check(pg_temp.state_of(format(ins, '24:00')) = '23514', 'play_until 24:00 ("no cut-off") is refused');
  perform pg_temp.check(pg_temp.state_of(format(ins, '9:00')) = '23514', 'play_until must be HH:MM');
  perform pg_temp.check(pg_temp.state_of(format(ins, '21:00')) = 'ok', 'play_until 21:00 is fine');
  perform pg_temp.check(pg_temp.state_of(format(ins, '20:30')) = 'ok', 'play_until 20:30 is fine');

  -- 3. A competition: at most an hour, on one IST day.
  ins := format(
    'insert into public.game_competitions (id, tenant_id, game, sections, items, opens_at, closes_at) values (%%L, %L, ''maths_speed'', ''[]'', ''[]'', %%L, %%L)',
    t
  );
  perform pg_temp.check(pg_temp.state_of(format(ins, 'c1', '2026-10-21 10:00+05:30', '2026-10-21 11:00+05:30')) = 'ok', 'a 60-minute window is fine');
  perform pg_temp.check(pg_temp.state_of(format(ins, 'c2', '2026-10-21 10:00+05:30', '2026-10-21 11:01+05:30')) = '23514', 'a 61-minute window is refused');
  perform pg_temp.check(pg_temp.state_of(format(ins, 'c3', '2026-10-21 10:00+05:30', '2026-10-28 10:00+05:30')) = '23514', 'a week-long window is refused');
  perform pg_temp.check(pg_temp.state_of(format(ins, 'c4', '2026-10-21 23:30+05:30', '2026-10-22 00:15+05:30')) = '23514', 'a window over IST midnight is refused');
  perform pg_temp.check(pg_temp.state_of(format(ins, 'c5', '2026-10-21 23:30+05:30', '2026-10-22 00:00+05:30')) = 'ok', 'ending at IST midnight exactly is the same day');
  -- 05:00 IST on the 21st is 23:30 UTC on the 20th: the IST day is what counts.
  perform pg_temp.check(pg_temp.state_of(format(ins, 'c6', '2026-10-21 05:00+05:30', '2026-10-21 05:45+05:30')) = 'ok', 'an IST-day window across UTC midnight is fine');

  -- 4. The batch column.
  perform pg_temp.check(
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'game_questions' and column_name = 'batch_id'),
    'game_questions.batch_id exists'
  );
end $test$;

rollback;
