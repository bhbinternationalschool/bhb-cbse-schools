-- Catch the same item being sold to the same child twice.
--
-- The counter is fast and the queue is long, and a clerk who is interrupted
-- mid-sale genuinely does ring the same set of books up again. The parent
-- either pays twice or argues at the desk, and neither is discovered until
-- somebody reads a statement.
--
-- Both halves are needed, and they are different jobs:
--
--   * BEFORE the sale — `inv_student_purchases` tells the counter what this
--     child has already bought this year, so the clerk sees "2 × Maths
--     Textbook on 12 April" while the cart is still open. It WARNS; it does not
--     block. A second set of notebooks in March is ordinary, and a counter that
--     refuses legitimate work gets worked around, which is worse.
--
--   * AFTER the fact — `inv_report_repeat_purchases` lists every child who has
--     the same item on more than one sale this year, so the ones that slipped
--     past the warning are still found.
--
-- Void sales are excluded from both. A sale that was cancelled is not a
-- purchase, and counting it would make the report cry wolf at exactly the
-- mistakes that were already put right.

/**
 * What this student has already bought this academic year.
 *
 * One row per item, with how many were taken and when they were last taken,
 * so the counter can say "already has this" without the clerk opening a
 * second screen.
 */
create or replace function public.inv_student_purchases(
  p_tenant_id uuid,
  p_student_id text,
  p_academic_year_code text default ''
) returns table (
  item_id uuid,
  item_name text,
  total_qty numeric,
  sale_count int,
  last_sale_date date,
  last_sale_no text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.item_id,
    max(l.item_name)                       as item_name,
    sum(l.qty)                             as total_qty,
    count(distinct s.id)::int              as sale_count,
    max(s.sale_date)                       as last_sale_date,
    (array_agg(s.sale_no order by s.sale_date desc, s.sale_no desc))[1] as last_sale_no
  from public.inv_sales s
  join public.inv_sale_lines l
    on l.sale_id = s.id and l.tenant_id = s.tenant_id
 where s.tenant_id = p_tenant_id
   and s.student_id = p_student_id
   and s.status <> 'void'
   and (p_academic_year_code = '' or s.academic_year_code = p_academic_year_code)
 group by l.item_id
 order by max(s.sale_date) desc;
$$;

grant execute on function public.inv_student_purchases(uuid, text, text) to service_role;

/**
 * Children who have the same item on more than one sale this year.
 *
 * `sale_count > 1` is the signal, not quantity: two of something on ONE sale
 * is a deliberate purchase, while the same thing on two separate receipts is
 * either a genuine repeat or the mistake this report exists to surface. The
 * dates and receipt numbers are returned so the office can tell which — two
 * sales minutes apart read very differently from two sales in different terms.
 */
create or replace function public.inv_report_repeat_purchases(
  p_tenant_id uuid,
  p_academic_year_code text default ''
) returns table (
  student_id text,
  buyer_name text,
  class_id text,
  section_id text,
  item_id uuid,
  item_name text,
  sale_count int,
  total_qty numeric,
  total_paise bigint,
  first_sale_date date,
  last_sale_date date,
  sale_nos text,
  minutes_apart numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.student_id,
    max(s.buyer_name)                      as buyer_name,
    max(s.class_id)                        as class_id,
    max(s.section_id)                      as section_id,
    l.item_id,
    max(l.item_name)                       as item_name,
    count(distinct s.id)::int              as sale_count,
    sum(l.qty)                             as total_qty,
    sum(l.line_total_paise)::bigint        as total_paise,
    min(s.sale_date)                       as first_sale_date,
    max(s.sale_date)                       as last_sale_date,
    string_agg(distinct s.sale_no, ', ')   as sale_nos,
    round(extract(epoch from (max(s.created_at) - min(s.created_at))) / 60.0, 1)
                                           as minutes_apart
  from public.inv_sales s
  join public.inv_sale_lines l
    on l.sale_id = s.id and l.tenant_id = s.tenant_id
 where s.tenant_id = p_tenant_id
   and s.student_id <> ''
   and s.status <> 'void'
   and (p_academic_year_code = '' or s.academic_year_code = p_academic_year_code)
 group by s.student_id, l.item_id
having count(distinct s.id) > 1
 order by round(extract(epoch from (max(s.created_at) - min(s.created_at))) / 60.0, 1) asc,
          max(s.sale_date) desc;
$$;

grant execute on function public.inv_report_repeat_purchases(uuid, text) to service_role;

notify pgrst, 'reload schema';
