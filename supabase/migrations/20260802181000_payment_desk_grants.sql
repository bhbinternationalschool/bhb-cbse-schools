grant all on public.payment_desk_links to service_role;
grant all on public.payment_desk_link_lines to service_role;
grant all on public.payment_desk_gateway_events to service_role;
grant all on public.payment_desk_sync_meta to service_role;

notify pgrst, 'reload schema';
