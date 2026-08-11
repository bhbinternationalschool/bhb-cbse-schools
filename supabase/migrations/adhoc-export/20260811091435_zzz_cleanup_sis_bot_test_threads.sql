
update wa_desk_bot_slices
set payload = jsonb_set(payload, '{threads}', '[]'::jsonb)
where slice_key = 'sis' and tenant_id = '6558f3c4-6d12-4636-bf53-17423b0eaad3';

