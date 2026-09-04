-- A tutor pass belongs to one child, not the household: the LKG child's
-- pass does not unlock the full tutor for a Class II sibling.
alter table public.tutor_pass_orders
  add column if not exists student_id text not null default '';

create index if not exists tutor_pass_orders_student_active_idx
  on public.tutor_pass_orders (tenant_id, student_id, ends_at desc)
  where status = 'paid';

notify pgrst, 'reload schema';
