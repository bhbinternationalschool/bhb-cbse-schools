
update wa_desk_bot_slices
set payload = jsonb_set(payload, '{threads}', '[]'::jsonb)
where slice_key = 'sis' and tenant_id = '6558f3c4-6d12-4636-bf53-17423b0eaad3';

delete from wa_contact_state where mobile_e164 in ('910000000097','910000000098');
delete from sis_students where id in ('stu_zzz_selftest_botai','stu_zzz_selftest_botai2');
delete from sis_households where id in ('hh_zzz_selftest_botai','hh_zzz_selftest_botai2');

