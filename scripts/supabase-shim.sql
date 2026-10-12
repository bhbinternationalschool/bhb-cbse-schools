-- Just enough of hosted Supabase for supabase/migrations to apply to a bare
-- Postgres 17, and for PostgREST to serve it the way Supabase does.
--
-- Used by scripts/rehearse-migrations.sh (migrations only) and
-- scripts/e2e-stack.sh (migrations + PostgREST + the app). Kept minimal on
-- purpose: every object here is one the migrations or PostgREST genuinely
-- need, so the list doubles as an inventory of what we depend on the
-- platform for.
--
-- Deliberately NOT here: `alter default privileges ... to service_role`.
-- Production has no such default (memory: erp-supabase-new-table-grant —
-- a table created without an explicit grant answers 42501 through
-- PostgREST). Leaving it out keeps this database at least as strict as
-- production: a missing grant fails here too, it is never papered over.

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
    then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
    then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')
    then create role service_role nologin noinherit bypassrls; end if;
  -- The role PostgREST logs in as; it switches to the JWT's `role` claim
  -- (anon / authenticated / service_role) for every request, as on Supabase.
  if not exists (select 1 from pg_roles where rolname = 'authenticator')
    then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- Supabase's own definitions: PostgREST (v10+) sets only the JSON GUC
-- request.jwt.claims; the per-claim GUC is the pre-v10 form, kept first so
-- a session that sets it by hand still works.
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$fn$;
create or replace function auth.jwt() returns jsonb language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$fn$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  owner uuid,
  file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$ select string_to_array(name, '/') $fn$;

grant usage on schema public, auth, storage, extensions
  to anon, authenticated, service_role;
