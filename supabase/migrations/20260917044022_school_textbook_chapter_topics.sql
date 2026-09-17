-- What each chapter of the school's own books covers, as short topic names.
--
-- WHY: the director asked for chapter topics (17 Sep 2026). A parent's
-- question rarely quotes a chapter title ("HCF kaise nikale?"); the topic
-- list is what lets the tutor say "Chapter 5, Factors and Multiples". The
-- half-yearly practice papers also draw on it.
--
-- Topic NAMES only — from the contents page or a chapter opener, condensed —
-- never the book's text.

alter table public.school_textbook_chapters
  add column if not exists topics text[] not null default '{}';

-- Same function as 20260916182451, now also writing `topics`. A chapter
-- object without "topics" stores an empty list, so older import files still
-- load unchanged.
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
    (tenant_id, textbook_id, position, name, exam_term_codes, topics, updated_at)
  select
    p_tenant_id, v_id,
    (c->>'position')::smallint,
    trim(c->>'name'),
    coalesce(array(select jsonb_array_elements_text(c->'exam_term_codes')), '{}'),
    coalesce(array(select trim(t) from jsonb_array_elements_text(coalesce(c->'topics', '[]'::jsonb)) t where length(trim(t)) > 0), '{}'),
    now()
  from jsonb_array_elements(p_chapters) c;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- security definer: only the server may call it.
revoke execute on function public.school_replace_textbook(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.school_replace_textbook(uuid, jsonb, jsonb) to service_role;
