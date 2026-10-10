
insert into sis_households (id, tenant_id, code, guardian_name, mobile, whatsapp_mobile, email, address, locality, landmark, city, state, pincode, alt_mobile, updated_at)
values ('hh_zzz_selftest_botai2', '6558f3c4-6d12-4636-bf53-17423b0eaad3', 'ZZZ-SELFTEST2', 'ZZZ Selftest Parent Two', '0000000097', '0000000097', '', '', '', '', '', '', '', '', now());

insert into sis_students (id, tenant_id, full_name, status, class_id, academic_year_code, household_id, admission_no, updated_at)
values ('stu_zzz_selftest_botai2', '6558f3c4-6d12-4636-bf53-17423b0eaad3', 'ZZZ Selftest Child Two', 'active', 'cls_z9nznh2i', '2026-27', 'hh_zzz_selftest_botai2', 'ZZZ-TEST-002', now());

