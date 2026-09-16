-- The NCERT textbooks a child studies, chapter by chapter, as DIKSHA lists them.
--
-- WHY
--   The parent tutor is told "follow NCERT" and nothing more: it has never
--   seen a chapter list, so it cannot tell a Class VI Ganita Prakash chapter
--   from the old Math-Magic one, or point a parent at the chapter's own PDF.
--   DIKSHA — the government's school platform, run by NCERT — publishes every
--   current (NCF 2023) textbook with its chapters, NCERT's chapter codes, and
--   the videos, audio books and practice sets filed under each chapter.
--
-- WHAT IS STORED
--   Metadata and links only: names, codes, licences, file addresses. No
--   chapter text. The chapter PDFs are © NCERT under CC BY-ND / BY-NC-ND.
--
-- WHICH BOOKS
--   Chosen by lib/dikshaIndex.ts (selectCurrentTextbooks): NCERT's own
--   channel, Classes 1–8, edition year 2023 or later, English and Hindi
--   medium plus the Sanskrit-language textbook. DIKSHA's CBSE channel only
--   carries the pre-2023 editions relabelled "(NEW)", so it is not used.
--
-- HOW IT IS FILLED
--   /api/curriculum/diksha-index/tick (weekly, Cloud Scheduler) fetches each
--   book whose DIKSHA publish date changed and hands it to
--   diksha_replace_textbook(), which rewrites that book's chapters and
--   resources in one transaction — a failed write leaves the book as it was,
--   never with no chapters. A book DIKSHA stops listing is marked retired,
--   not deleted.
--
-- Conventions kept from the rest of the schema: tenant_id on every table,
-- RLS on with no policy (server-only, read through the service role), and an
-- explicit service_role grant on every object.

create table if not exists public.diksha_textbooks (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- DIKSHA's content id, e.g. do_31411913082845593613731
  id text not null,
  grade smallint not null check (grade between 1 and 12),
  medium text not null,
  subjects text[] not null default '{}',
  name text not null,
  edition_year smallint,
  license text not null default '',
  copyright text not null default '',
  -- DIKSHA's lastPublishedOn: an unchanged date means nothing to re-fetch.
  published_at timestamptz,
  chapter_count smallint not null default 0,
  resource_count integer not null default 0,
  synced_at timestamptz not null default now(),
  -- Set when DIKSHA stops listing the book; cleared if it comes back.
  retired_at timestamptz,
  primary key (tenant_id, id)
);

create index if not exists diksha_textbooks_tenant_grade_idx
  on public.diksha_textbooks (tenant_id, grade, medium)
  where retired_at is null;

create table if not exists public.diksha_chapters (
  tenant_id uuid not null,
  id text not null,
  textbook_id text not null,
  -- 1-based order within the book, as DIKSHA orders its units.
  position smallint not null,
  name text not null,
  -- NCERT's chapter code from the book's QR codes, e.g. 0674CH07. Empty when
  -- DIKSHA has none.
  chapter_code text not null default '',
  description text not null default '',
  keywords text[] not null default '{}',
  -- The chapter's own e-textbook PDF on DIKSHA, if it has one.
  textbook_pdf_url text not null default '',
  textbook_pdf_license text not null default '',
  video_count smallint not null default 0,
  audio_count smallint not null default 0,
  practice_count smallint not null default 0,
  primary key (tenant_id, id),
  foreign key (tenant_id, textbook_id)
    references public.diksha_textbooks (tenant_id, id) on delete cascade
);

create index if not exists diksha_chapters_book_idx
  on public.diksha_chapters (tenant_id, textbook_id, position);

create table if not exists public.diksha_chapter_resources (
  tenant_id uuid not null,
  chapter_id text not null,
  -- DIKSHA's content id. The same resource can be filed under more than one
  -- chapter, hence the chapter in the key.
  id text not null,
  position smallint not null,
  -- DIKSHA's folder inside the chapter: "e-Textbook", "Video Content",
  -- "Practice Set", "Teacher Resources", …
  folder text not null default '',
  name text not null,
  -- DIKSHA's primaryCategory: eTextbook, Explanation Content, Practice
  -- Question Set, Learning Resource, Teacher Resource.
  category text not null default '',
  mime_type text not null default '',
  license text not null default '',
  copyright text not null default '',
  url text not null default '',
  size_bytes bigint,
  primary key (tenant_id, chapter_id, id),
  foreign key (tenant_id, chapter_id)
    references public.diksha_chapters (tenant_id, id) on delete cascade
);

alter table public.diksha_textbooks enable row level security;
alter table public.diksha_chapters enable row level security;
alter table public.diksha_chapter_resources enable row level security;

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.diksha_textbooks to service_role;
grant all on public.diksha_chapters to service_role;
grant all on public.diksha_chapter_resources to service_role;

-- One book, rewritten in one transaction. p_textbook is a diksha_textbooks
-- row without tenant_id; p_chapters and p_resources are arrays of rows for
-- that book. Chapters of the book that are not in p_chapters go (their
-- resources with them); every resource row of the book is written afresh.
create or replace function public.diksha_replace_textbook(
  p_tenant_id uuid,
  p_textbook jsonb,
  p_chapters jsonb,
  p_resources jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book text := p_textbook->>'id';
  v_chapters integer;
  v_resources integer;
begin
  if p_tenant_id is null or coalesce(v_book, '') = '' then
    raise exception 'diksha_replace_textbook: tenant and textbook id are required';
  end if;
  if jsonb_typeof(p_chapters) <> 'array' or jsonb_typeof(p_resources) <> 'array' then
    raise exception 'diksha_replace_textbook: chapters and resources must be arrays';
  end if;

  insert into public.diksha_textbooks as t (
    tenant_id, id, grade, medium, subjects, name, edition_year, license,
    copyright, published_at, chapter_count, resource_count, synced_at, retired_at
  ) values (
    p_tenant_id,
    v_book,
    (p_textbook->>'grade')::smallint,
    p_textbook->>'medium',
    coalesce(array(select jsonb_array_elements_text(p_textbook->'subjects')), '{}'),
    p_textbook->>'name',
    nullif(p_textbook->>'edition_year', '')::smallint,
    coalesce(p_textbook->>'license', ''),
    coalesce(p_textbook->>'copyright', ''),
    nullif(p_textbook->>'published_at', '')::timestamptz,
    jsonb_array_length(p_chapters),
    jsonb_array_length(p_resources),
    now(),
    null
  )
  on conflict (tenant_id, id) do update set
    grade = excluded.grade,
    medium = excluded.medium,
    subjects = excluded.subjects,
    name = excluded.name,
    edition_year = excluded.edition_year,
    license = excluded.license,
    copyright = excluded.copyright,
    published_at = excluded.published_at,
    chapter_count = excluded.chapter_count,
    resource_count = excluded.resource_count,
    synced_at = excluded.synced_at,
    retired_at = null;

  -- Resources first (they hang off chapters), then chapters no longer in
  -- the book. Everything below runs in this function's transaction: if an
  -- insert fails, these deletes roll back with it.
  delete from public.diksha_chapter_resources r
   using public.diksha_chapters c
   where r.tenant_id = p_tenant_id
     and c.tenant_id = p_tenant_id
     and r.chapter_id = c.id
     and c.textbook_id = v_book;

  delete from public.diksha_chapters c
   where c.tenant_id = p_tenant_id
     and c.textbook_id = v_book
     and c.id not in (select x->>'id' from jsonb_array_elements(p_chapters) x);

  insert into public.diksha_chapters as c (
    tenant_id, id, textbook_id, position, name, chapter_code, description,
    keywords, textbook_pdf_url, textbook_pdf_license, video_count,
    audio_count, practice_count
  )
  select
    p_tenant_id,
    x->>'id',
    v_book,
    (x->>'position')::smallint,
    x->>'name',
    coalesce(x->>'chapter_code', ''),
    coalesce(x->>'description', ''),
    coalesce(array(select jsonb_array_elements_text(x->'keywords')), '{}'),
    coalesce(x->>'textbook_pdf_url', ''),
    coalesce(x->>'textbook_pdf_license', ''),
    coalesce((x->>'video_count')::smallint, 0),
    coalesce((x->>'audio_count')::smallint, 0),
    coalesce((x->>'practice_count')::smallint, 0)
  from jsonb_array_elements(p_chapters) x
  on conflict (tenant_id, id) do update set
    textbook_id = excluded.textbook_id,
    position = excluded.position,
    name = excluded.name,
    chapter_code = excluded.chapter_code,
    description = excluded.description,
    keywords = excluded.keywords,
    textbook_pdf_url = excluded.textbook_pdf_url,
    textbook_pdf_license = excluded.textbook_pdf_license,
    video_count = excluded.video_count,
    audio_count = excluded.audio_count,
    practice_count = excluded.practice_count;
  get diagnostics v_chapters = row_count;

  insert into public.diksha_chapter_resources (
    tenant_id, chapter_id, id, position, folder, name, category, mime_type,
    license, copyright, url, size_bytes
  )
  select
    p_tenant_id,
    x->>'chapter_id',
    x->>'id',
    (x->>'position')::smallint,
    coalesce(x->>'folder', ''),
    x->>'name',
    coalesce(x->>'category', ''),
    coalesce(x->>'mime_type', ''),
    coalesce(x->>'license', ''),
    coalesce(x->>'copyright', ''),
    coalesce(x->>'url', ''),
    nullif(x->>'size_bytes', '')::bigint
  from jsonb_array_elements(p_resources) x;
  get diagnostics v_resources = row_count;

  return jsonb_build_object('chapters', v_chapters, 'resources', v_resources);
end;
$$;

revoke all on function public.diksha_replace_textbook(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.diksha_replace_textbook(uuid, jsonb, jsonb, jsonb) to service_role;
