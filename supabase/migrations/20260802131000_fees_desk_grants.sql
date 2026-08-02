-- PostgREST grants for fee_desk_* tables (Wave 1 + 1b)

grant all on public.fee_desk_vouchers to service_role;
grant all on public.fee_desk_voucher_lines to service_role;
grant all on public.fee_desk_voucher_tenders to service_role;
grant all on public.fee_desk_sync_meta to service_role;
grant all on public.fee_desk_cheques to service_role;
grant all on public.fee_desk_manual_books to service_role;
grant all on public.fee_desk_day_closes to service_role;
grant all on public.fee_desk_charge_vouchers to service_role;
grant all on public.fee_desk_charge_voucher_lines to service_role;
grant all on public.fee_desk_installment_plans to service_role;
grant all on public.fee_desk_plan_allocations to service_role;
grant all on public.fee_desk_carried_forward to service_role;
grant all on public.fee_desk_open_dues to service_role;

grant select on public.fee_open_dues_v to service_role, authenticated;

notify pgrst, 'reload schema';
