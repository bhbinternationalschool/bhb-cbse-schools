/**
 * Library desk — Supabase normalized tables (library_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LibraryCopy,
  LibraryCopyStatus,
  LibraryIssue,
  LibraryState,
  LibraryTitle,
} from "@/lib/library";
import { libraryDualWriteDbEnabled } from "@/lib/libraryDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type LibraryDeskSyncMeta = {
  titleCount: number;
  copyCount: number;
  issueCount: number;
  openIssueCount: number;
  lastIssueAt: string | null;
  updatedAt: string;
};

export type LibraryDeskBundle = {
  titles: LibraryTitle[];
  copies: LibraryCopy[];
  issues: LibraryIssue[];
  settings: LibraryState["settings"];
};

const META_SELECT =
  "title_count, copy_count, issue_count, open_issue_count, last_issue_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  const { data } = await sb.from(table).select("id").eq("tenant_id", tenantId);
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function titleToRow(tenantId: string, t: LibraryTitle): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: t.id,
    tenant_id: tenantId,
    isbn: t.isbn || "",
    title: t.title || "",
    author: t.author || "",
    publisher: t.publisher || "",
    category: t.category || "general",
    shelf: t.shelf || "",
    copies_total: t.copiesTotal ?? 1,
    is_active: t.isActive !== false,
    created_at: now,
    updated_at: now,
  };
}

function rowToTitle(r: Record<string, unknown>): LibraryTitle {
  return {
    id: String(r.id),
    isbn: String(r.isbn || ""),
    title: String(r.title || ""),
    author: String(r.author || ""),
    publisher: String(r.publisher || ""),
    category: String(r.category || "general"),
    shelf: String(r.shelf || ""),
    copiesTotal: Number(r.copies_total ?? 1),
    isActive: r.is_active !== false,
  };
}

function copyToRow(tenantId: string, c: LibraryCopy): Record<string, unknown> {
  const now = new Date().toISOString();
  const status = String(c.status) as LibraryCopyStatus;
  return {
    id: c.id,
    tenant_id: tenantId,
    title_id: c.titleId,
    accession_no: c.accessionNo,
    barcode: c.barcode || c.accessionNo,
    status:
      status === "issued" ||
      status === "lost" ||
      status === "damaged" ||
      status === "reserved"
        ? status
        : "available",
    updated_at: now,
  };
}

function rowToCopy(r: Record<string, unknown>): LibraryCopy {
  const status = String(r.status) as LibraryCopyStatus;
  return {
    id: String(r.id),
    titleId: String(r.title_id),
    accessionNo: String(r.accession_no),
    barcode: String(r.barcode || ""),
    status:
      status === "issued" ||
      status === "lost" ||
      status === "damaged" ||
      status === "reserved"
        ? status
        : "available",
  };
}

function issueToRow(tenantId: string, i: LibraryIssue): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: i.id,
    tenant_id: tenantId,
    copy_id: i.copyId,
    student_id: i.studentId,
    academic_year_code: i.academicYearCode,
    issued_on: i.issuedOn,
    due_on: i.dueOn,
    returned_on: i.returnedOn || null,
    fine_paise: i.finePaise ?? 0,
    issued_by: i.issuedBy || "",
    note: i.note || "",
    created_at: now,
    updated_at: now,
  };
}

function rowToIssue(r: Record<string, unknown>): LibraryIssue {
  return {
    id: String(r.id),
    copyId: String(r.copy_id),
    studentId: String(r.student_id),
    academicYearCode: String(r.academic_year_code),
    issuedOn: String(r.issued_on).slice(0, 10),
    dueOn: String(r.due_on).slice(0, 10),
    returnedOn: r.returned_on ? String(r.returned_on).slice(0, 10) : undefined,
    finePaise: Number(r.fine_paise ?? 0),
    issuedBy: String(r.issued_by || ""),
    note: String(r.note || ""),
  };
}

export async function pushLibraryDeskToDb(
  state: LibraryState,
): Promise<{ ok: boolean; error?: string }> {
  if (!libraryDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const titles = state.titles ?? [];
  const copies = state.copies ?? [];
  const issues = state.issues ?? [];
  const settings = state.settings ?? {
    maxBooksPerStudent: 2,
    loanDays: 14,
    finePaisePerDay: 500,
  };

  await Promise.all([
    deleteStale(sb, tenantId, "library_desk_titles", new Set(titles.map((t) => t.id))),
    deleteStale(sb, tenantId, "library_desk_copies", new Set(copies.map((c) => c.id))),
    deleteStale(sb, tenantId, "library_desk_issues", new Set(issues.map((i) => i.id))),
  ]);

  let r = await upsertChunks(
    sb,
    "library_desk_titles",
    titles.map((t) => titleToRow(tenantId, t)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "library_desk_copies",
    copies.map((c) => copyToRow(tenantId, c)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "library_desk_issues",
    issues.map((i) => issueToRow(tenantId, i)),
  );
  if (!r.ok) return r;

  await sb.from("library_desk_settings").upsert(
    {
      tenant_id: tenantId,
      max_books_per_student: settings.maxBooksPerStudent ?? 2,
      loan_days: settings.loanDays ?? 14,
      fine_paise_per_day: settings.finePaisePerDay ?? 500,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  const openIssues = issues.filter((i) => !i.returnedOn);
  let lastIssueAt: string | null = null;
  for (const i of issues) {
    const at = i.issuedOn;
    if (at && (!lastIssueAt || at > lastIssueAt)) lastIssueAt = at;
  }

  await sb.from("library_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      title_count: titles.length,
      copy_count: copies.length,
      issue_count: issues.length,
      open_issue_count: openIssues.length,
      last_issue_at: lastIssueAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchLibraryDeskFromDb(): Promise<{
  bundle: LibraryDeskBundle;
  meta: LibraryDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: LibraryDeskBundle = {
    titles: [],
    copies: [],
    issues: [],
    settings: { maxBooksPerStudent: 2, loanDays: 14, finePaisePerDay: 500 },
  };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [
    { data: titleRows },
    { data: copyRows },
    { data: issueRows },
    { data: settingsRow },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("library_desk_titles").select("*").eq("tenant_id", tenantId),
    sb.from("library_desk_copies").select("*").eq("tenant_id", tenantId),
    sb.from("library_desk_issues").select("*").eq("tenant_id", tenantId),
    sb
      .from("library_desk_settings")
      .select("max_books_per_student, loan_days, fine_paise_per_day")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb
      .from("library_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const s = settingsRow as {
    max_books_per_student?: number;
    loan_days?: number;
    fine_paise_per_day?: number;
  } | null;

  return {
    bundle: {
      titles: (titleRows ?? []).map((r) => rowToTitle(r as Record<string, unknown>)),
      copies: (copyRows ?? []).map((r) => rowToCopy(r as Record<string, unknown>)),
      issues: (issueRows ?? []).map((r) => rowToIssue(r as Record<string, unknown>)),
      settings: {
        maxBooksPerStudent: s?.max_books_per_student ?? 2,
        loanDays: s?.loan_days ?? 14,
        finePaisePerDay: s?.fine_paise_per_day ?? 500,
      },
    },
    meta: metaRow
      ? {
          titleCount: (metaRow as { title_count: number }).title_count,
          copyCount: (metaRow as { copy_count: number }).copy_count,
          issueCount: (metaRow as { issue_count: number }).issue_count,
          openIssueCount: (metaRow as { open_issue_count: number }).open_issue_count,
          lastIssueAt: (metaRow as { last_issue_at: string | null }).last_issue_at,
          updatedAt: String((metaRow as { updated_at: string }).updated_at),
        }
      : null,
  };
}
