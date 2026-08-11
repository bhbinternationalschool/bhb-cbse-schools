
delete from admission_desk_leads where id = 'adm_y1pnui49';
delete from admission_desk_households where id = 'ahh_luohr8y0';
delete from wa_contact_state where mobile_e164 = '910000000096';

update wa_desk_bot_slices
set payload = jsonb_set(payload, '{threads}',
  (select coalesce(jsonb_agg(t), '[]'::jsonb) from jsonb_array_elements(payload->'threads') t
   where t->>'mobile' != '0000000096'))
where slice_key = 'crm' and tenant_id = '6558f3c4-6d12-4636-bf53-17423b0eaad3';

update wa_desk_bot_slices
set payload = payload #- '{sessions,0000000096}'
where slice_key = 'unified' and tenant_id = '6558f3c4-6d12-4636-bf53-17423b0eaad3';

