-- Example BigQuery views for Power BI / Looker (dataset: bhb_erp)
-- Run in BigQuery console after the first nightly sync.

-- Monthly fee collection by academic year
create or replace view `bhb_erp.v_monthly_fee_collection` as
select
  tenant_slug,
  academic_year_code,
  date_trunc(collection_date, month) as month,
  count(*) as receipt_count,
  sum(total_paise) / 100.0 as total_inr,
  sum(if(voided_at is not null, 1, 0)) as voided_count
from `bhb_erp.fee_desk_vouchers`
group by 1, 2, 3;

-- Admissions funnel by source and stage
create or replace view `bhb_erp.v_admissions_funnel` as
select
  tenant_slug,
  academic_year_code,
  source,
  stage,
  count(*) as lead_count,
  countif(student_id != '') as enrolled_count
from `bhb_erp.admission_desk_leads`
group by 1, 2, 3, 4;

-- Student headcount by class
create or replace view `bhb_erp.v_students_by_class` as
select
  tenant_slug,
  academic_year_code,
  class_id,
  section_id,
  status,
  count(*) as student_count
from `bhb_erp.sis_students`
group by 1, 2, 3, 4, 5;

-- Attendance % (present marks / total marks) by register
create or replace view `bhb_erp.v_attendance_daily` as
select
  r.tenant_slug,
  r.academic_year_code,
  r.class_id,
  r.section_id,
  r.attendance_date,
  count(*) as mark_count,
  countif(m.status = 'P') as present_count,
  safe_divide(countif(m.status = 'P'), count(*)) as present_rate
from `bhb_erp.attendance_desk_registers` r
join `bhb_erp.attendance_desk_marks` m
  on m.register_id = r.id and m.tenant_slug = r.tenant_slug
group by 1, 2, 3, 4, 5;
