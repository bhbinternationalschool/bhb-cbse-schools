
update wa_desk_bot_slices
set payload = payload #- '{threads,general:0000000002}'
where slice_key = 'hub' and tenant_id = '6558f3c4-6d12-4636-bf53-17423b0eaad3';

update wa_desk_bot_slices
set payload = payload
  #- '{sessions,0000000000}'
  #- '{sessions,0000000002}'
  #- '{sessions,0000000097}'
  #- '{sessions,0000000098}'
where slice_key = 'unified' and tenant_id = '6558f3c4-6d12-4636-bf53-17423b0eaad3';

