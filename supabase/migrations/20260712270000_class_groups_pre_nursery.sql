-- Class groups: Nursery → XII ladder + group codes
-- (Pre-Nursery is not offered at this school.)

-- Re-number sort_order for standard ladder
with ordered as (
  select cl.id, row_number() over (
    partition by cl.tenant_id
    order by case cl.name
      when 'Nursery' then 1
      when 'LKG' then 2
      when 'UKG' then 3
      when 'I' then 4
      when 'II' then 5
      when 'III' then 6
      when 'IV' then 7
      when 'V' then 8
      when 'VI' then 9
      when 'VII' then 10
      when 'VIII' then 11
      when 'IX' then 12
      when 'X' then 13
      when 'XI' then 14
      when 'XII' then 15
      else 100 + cl.sort_order
    end
  ) as rn
  from public.classes cl
  join public.tenants t on t.id = cl.tenant_id
  where t.slug = 'bhb-international'
)
update public.classes c
set sort_order = o.rn
from ordered o
where c.id = o.id;

alter table public.classes
  add column if not exists group_code text
    check (group_code is null or group_code in (
      'PRE_PRIMARY', 'PRIMARY', 'MIDDLE', 'SECONDARY', 'SENIOR'
    ));

update public.classes
set group_code = case name
  when 'Nursery' then 'PRE_PRIMARY'
  when 'LKG' then 'PRE_PRIMARY'
  when 'UKG' then 'PRE_PRIMARY'
  when 'I' then 'PRIMARY'
  when 'II' then 'PRIMARY'
  when 'III' then 'PRIMARY'
  when 'IV' then 'PRIMARY'
  when 'V' then 'PRIMARY'
  when 'VI' then 'MIDDLE'
  when 'VII' then 'MIDDLE'
  when 'VIII' then 'MIDDLE'
  when 'IX' then 'SECONDARY'
  when 'X' then 'SECONDARY'
  when 'XI' then 'SENIOR'
  when 'XII' then 'SENIOR'
  else group_code
end
where group_code is null
   or name in (
     'Nursery','LKG','UKG',
     'I','II','III','IV','V',
     'VI','VII','VIII','IX','X','XI','XII'
   );

-- Remove Pre-Nursery if present (school does not offer it)
delete from public.sections s
using public.classes cl, public.tenants t
where s.class_id = cl.id
  and cl.tenant_id = t.id
  and t.slug = 'bhb-international'
  and cl.name = 'Pre-Nursery';

delete from public.classes cl
using public.tenants t
where cl.tenant_id = t.id
  and t.slug = 'bhb-international'
  and cl.name = 'Pre-Nursery';

comment on column public.classes.group_code is
  'Stage band: PRE_PRIMARY (Nursery–UKG), PRIMARY (I–V), MIDDLE (VI–VIII), SECONDARY (IX–X), SENIOR (XI–XII)';
