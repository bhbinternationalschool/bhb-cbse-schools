-- The school's OWN textbooks — Propel for Classes 1–8 — chapter by chapter.
--
-- WHY (director's decision, 16 Sep 2026): the AI tutor and AI lesson plans
-- follow the books the children actually hold. Those are Propel ("Class N :
-- Propel - English, EVS, Maths, Hindi"; Classes 6–8 "Propel Middle"; the
-- e-book shelf is "Propel New Prime"), not NCERT. The DIKSHA index
-- (diksha_textbooks) knows NCERT's books; naming those chapters sent parents
-- looking for "Ganita Prakash" in a house that owns Propel Maths.
--
-- Kept apart from diksha_*: those are synced from the government catalogue
-- and retired automatically; these are typed in from the school's own
-- contents pages and change only when the school changes a book.
--
-- `exam_term_codes` marks which exams a chapter is set for (e.g. {"HY"}), so
-- the half-yearly practice papers draw only from examined chapters.
--
-- Grades follow the DIKSHA index's scale so the tutor can swap sources:
-- Nursery -2, LKG -1, UKG 0, Classes 1–8 as 1..8.

create table if not exists public.school_textbooks (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  id text not null,
  grade smallint not null check (grade between -2 and 12),
  subject_key text not null,
  name text not null,
  publisher text not null default '',
  series text not null default '',
  medium text not null default 'English',
  edition text not null default '',
  notes text not null default '',
  retired_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists school_textbooks_grade_subject_idx
  on public.school_textbooks (tenant_id, grade, subject_key)
  where retired_at is null;

create table if not exists public.school_textbook_chapters (
  tenant_id uuid not null,
  textbook_id text not null,
  position smallint not null check (position > 0),
  name text not null check (length(trim(name)) > 0),
  exam_term_codes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, textbook_id, position),
  foreign key (tenant_id, textbook_id)
    references public.school_textbooks (tenant_id, id) on delete cascade
);

alter table public.school_textbooks enable row level security;
alter table public.school_textbook_chapters enable row level security;

grant all on public.school_textbooks to service_role;
grant all on public.school_textbook_chapters to service_role;

-- One book and all its chapters in ONE transaction. Chapters are replaced
-- wholesale, but only for this book, and never half-way: a failure leaves the
-- previous chapter list exactly as it was. (A non-transactional
-- delete-then-insert is what emptied the fee book's lines on 6 Sep 2026.)
create or replace function public.school_replace_textbook(
  p_tenant_id uuid,
  p_book jsonb,
  p_chapters jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id text := p_book->>'id';
  v_count integer;
begin
  if v_id is null or length(trim(v_id)) = 0 then
    raise exception 'book id is required';
  end if;
  if jsonb_typeof(p_chapters) <> 'array' or jsonb_array_length(p_chapters) = 0 then
    -- An empty chapter list is never an instruction to wipe a book.
    raise exception 'refusing to replace % with no chapters', v_id;
  end if;

  insert into public.school_textbooks
    (tenant_id, id, grade, subject_key, name, publisher, series, medium, edition, notes, retired_at, updated_at)
  values (
    p_tenant_id, v_id,
    (p_book->>'grade')::smallint,
    p_book->>'subject_key',
    p_book->>'name',
    coalesce(p_book->>'publisher', ''),
    coalesce(p_book->>'series', ''),
    coalesce(p_book->>'medium', 'English'),
    coalesce(p_book->>'edition', ''),
    coalesce(p_book->>'notes', ''),
    null,
    now()
  )
  on conflict (tenant_id, id) do update set
    grade = excluded.grade,
    subject_key = excluded.subject_key,
    name = excluded.name,
    publisher = excluded.publisher,
    series = excluded.series,
    medium = excluded.medium,
    edition = excluded.edition,
    notes = excluded.notes,
    retired_at = null,
    updated_at = now();

  delete from public.school_textbook_chapters
   where tenant_id = p_tenant_id and textbook_id = v_id;

  insert into public.school_textbook_chapters
    (tenant_id, textbook_id, position, name, exam_term_codes, updated_at)
  select
    p_tenant_id, v_id,
    (c->>'position')::smallint,
    trim(c->>'name'),
    coalesce(array(select jsonb_array_elements_text(c->'exam_term_codes')), '{}'),
    now()
  from jsonb_array_elements(p_chapters) c;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- security definer: only the server may call it.
revoke execute on function public.school_replace_textbook(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.school_replace_textbook(uuid, jsonb, jsonb) to service_role;
