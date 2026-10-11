/*
 * Database clean-up, Stage 2 (director, 11 Oct 2026 — old-vs-new ERP review).
 *
 * 1. Indexes on the busy foreign keys the performance advisor flagged
 *    (tables with real rows only; tenant_id FKs are skipped — one tenant).
 * 2. fleet_edge_events "first-seen" check: every telemetry push ran
 *    count(*) over tenant+event_type+vehicle_ref with no index on vehicle_ref
 *    (71k calls, 27 ms each, 70k sequential scans). Index it.
 * 3. teaching_state RLS: auth.uid() was re-evaluated per row; wrap it in a
 *    sub-select so Postgres evaluates it once per query.
 * 4. Raw bus telemetry retention. fleet_edge_events is 30% of the database
 *    and grows ~1,200 rows a day. The normalised fleet_vehicle_positions rows
 *    (what the map and parent app read) keep their own 30-day prune; only the
 *    raw Tata payloads of telemetry/details pushes older than N days go.
 *    Alerts are never pruned. The two FKs that point at an event become
 *    ON DELETE SET NULL so a position or notification outlives its raw push.
 */

-- 1. Foreign-key indexes -----------------------------------------------------
create index if not exists ledger_lines_account_id_idx on public.ledger_lines (account_id);
create index if not exists ledger_lines_party_id_idx on public.ledger_lines (party_id);
create index if not exists ledger_lines_cost_centre_id_idx on public.ledger_lines (cost_centre_id);
create index if not exists accounts_desk_journal_lines_journal_id_idx on public.accounts_desk_journal_lines (journal_id);
create index if not exists accounts_desk_expense_voucher_lines_voucher_id_idx on public.accounts_desk_expense_voucher_lines (voucher_id);
create index if not exists sis_enrollments_promoted_from_idx on public.sis_enrollments (promoted_from_enrollment_id);
create index if not exists fee_desk_vouchers_household_id_idx on public.fee_desk_vouchers (household_id);
create index if not exists fee_hold_round_items_student_id_idx on public.fee_hold_round_items (student_id);
create index if not exists inv_stock_ledger_item_id_idx on public.inv_stock_ledger (item_id);
create index if not exists inv_stock_ledger_location_id_idx on public.inv_stock_ledger (location_id);
create index if not exists inv_sale_lines_sale_id_idx on public.inv_sale_lines (sale_id);
create index if not exists inv_sale_lines_item_id_idx on public.inv_sale_lines (item_id);
create index if not exists inv_sale_payments_sale_id_idx on public.inv_sale_payments (sale_id);
create index if not exists inv_sales_kit_id_idx on public.inv_sales (kit_id);
create index if not exists inv_sales_location_id_idx on public.inv_sales (location_id);
create index if not exists inv_sales_price_list_id_idx on public.inv_sales (price_list_id);
create index if not exists admission_lead_market_state_village_id_idx on public.admission_lead_market_state (village_id);
create index if not exists sis_household_village_village_id_idx on public.sis_household_village (village_id);
create index if not exists textbook_chapter_standards_case_uuid_idx on public.textbook_chapter_standards (case_uuid);
create index if not exists fleet_edge_notifications_event_id_idx on public.fleet_edge_notifications (event_id);

-- 2. First-seen check --------------------------------------------------------
create index if not exists fleet_edge_events_tenant_vehicle_type_idx
  on public.fleet_edge_events (tenant_id, vehicle_ref, event_type);

-- 3. teaching_state RLS, evaluated once per query ----------------------------
drop policy if exists teaching_state_tenant_all on public.teaching_state;
create policy teaching_state_tenant_all on public.teaching_state
  for all to authenticated
  using (tenant_id in (select p.tenant_id from public.profiles p where p.auth_user_id = (select auth.uid())))
  with check (tenant_id in (select p.tenant_id from public.profiles p where p.auth_user_id = (select auth.uid())));

-- 4. Raw telemetry retention -------------------------------------------------
alter table public.fleet_vehicle_positions
  drop constraint if exists fleet_vehicle_positions_event_id_fkey,
  add constraint fleet_vehicle_positions_event_id_fkey
    foreign key (event_id) references public.fleet_edge_events (id) on delete set null;

alter table public.fleet_edge_notifications
  drop constraint if exists fleet_edge_notifications_event_id_fkey,
  add constraint fleet_edge_notifications_event_id_fkey
    foreign key (event_id) references public.fleet_edge_events (id) on delete set null;

create or replace function public.fleet_prune_raw_events(
  p_tenant_id uuid,
  p_keep_days int default 90,
  p_batch int default 5000
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if p_keep_days < 30 then
    raise exception 'fleet_prune_raw_events: keep at least 30 days (asked %)', p_keep_days;
  end if;
  with doomed as (
    select id from public.fleet_edge_events
    where tenant_id = p_tenant_id
      and event_type in ('telemetry', 'details')
      and received_at < now() - make_interval(days => p_keep_days)
    order by received_at
    limit greatest(1, least(p_batch, 20000))
  )
  delete from public.fleet_edge_events e using doomed d where e.id = d.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.fleet_prune_raw_events(uuid, int, int) from public, anon, authenticated;
grant execute on function public.fleet_prune_raw_events(uuid, int, int) to service_role;
