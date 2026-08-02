grant all on public.exam_desk_terms to service_role;
grant all on public.exam_desk_subjects to service_role;
grant all on public.exam_desk_date_sheet to service_role;
grant all on public.exam_desk_sheets to service_role;
grant all on public.exam_desk_marks to service_role;
grant all on public.exam_desk_policy to service_role;
grant all on public.exam_desk_promotions to service_role;
grant all on public.exam_desk_sync_meta to service_role;

notify pgrst, 'reload schema';
