-- The send-once lock table (20260910190000) was created with RLS and a
-- tenant policy but no privileges for service_role, so every claim from
-- the server returned 42501 "permission denied". The lock is deliberately
-- fail-closed — a claim that cannot be taken sends nothing — so with this
-- grant missing, no approval card and no automation tick could send at
-- all. Same gotcha as every new table here: RLS says WHO, grants say IF.

grant select, insert, update, delete on public.wa_send_claims to service_role;
