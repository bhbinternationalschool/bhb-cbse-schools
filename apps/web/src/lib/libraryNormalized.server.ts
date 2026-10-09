/**
 * Library desk — Supabase normalized tables (library_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LibraryCopy,
  LibraryCopyStatus,
  LibraryIssue,
  LibraryItemCondition,
  LibraryProcurementDoc,
  LibraryState,
  LibraryTitle,
} from "@/lib/library";
import {
  issueDbStudentId,
  parseIssueDbStudentId,
  parseIssueNote,
} from "@/lib/library";
import { libraryDualWriteDbEnabled } from "@/lib/libraryDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";
import { fetchAllPages } from "@/lib/supabase/pageAll";

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
  procurementDocs: LibraryProcurementDoc[];
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

function parsePackedPublisher(publisherRaw: string): {
  publisher: string;
  edition: string;
  purchaseDate: string;
  pricePaise: number;
} {
  const parts = publisherRaw.split(" | ");
  return {
    publisher: parts[0] || "",
    edition: parts[1] || "",
    purchaseDate: parts[2] || "",
    pricePaise: Number(parts[3]) || 0,
  };
}

function titleToRow(tenantId: string, t: LibraryTitle): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: t.id,
    tenant_id: tenantId,
    isbn: t.isbn || "",
    title: t.title || "",
    author: t.author || "",
    publisher: (t.publisher || "").slice(0, 500),
    edition: t.edition || "",
    purchase_date: t.purchaseDate || null,
    price_paise: t.pricePaise ?? 0,
    category: t.category || "book",
    shelf: t.shelf || "",
    copies_total: t.copiesTotal ?? 1,
    is_active: t.isActive !== false,
    created_at: now,
    updated_at: now,
  };
}

function rowToTitle(r: Record<string, unknown>): LibraryTitle {
  const packed = parsePackedPublisher(String(r.publisher || ""));
  const editionCol = String(r.edition ?? "");
  const purchaseCol = r.purchase_date ? String(r.purchase_date).slice(0, 10) : "";
  const priceCol = r.price_paise != null ? Number(r.price_paise) : null;

  const publisher = packed.publisher;
  const edition = editionCol || packed.edition;
  const purchaseDate = purchaseCol || packed.purchaseDate;
  const pricePaise = priceCol != null && !Number.isNaN(priceCol) ? priceCol : packed.pricePaise;

  const cat = String(r.category || "book");
  const category =
    cat === "magazine" ||
    cat === "newspaper" ||
    cat === "project" ||
    cat === "other"
      ? cat
      : "book";
  return {
    id: String(r.id),
    isbn: String(r.isbn || ""),
    title: String(r.title || ""),
    author: String(r.author || ""),
    publisher,
    edition,
    category,
    shelf: String(r.shelf || ""),
    purchaseDate,
    pricePaise,
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

function normalizeDbCondition(raw: unknown): LibraryItemCondition {
  const v = String(raw || "").toLowerCase();
  if (v === "fair") return "fair";
  if (v === "damaged") return "damaged";
  if (v === "torn") return "torn";
  return "good";
}

function issueToRow(tenantId: string, i: LibraryIssue): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: i.id,
    tenant_id: tenantId,
    copy_id: i.copyId,
    student_id: issueDbStudentId(i),
    borrower_type: i.borrowerType,
    staff_id: i.borrowerType === "staff" ? i.staffId || "" : "",
    academic_year_code: i.academicYearCode,
    issued_on: i.issuedOn,
    due_on: i.dueOn,
    returned_on: i.returnedOn || null,
    fine_paise: i.finePaise ?? 0,
    issued_by: i.issuedBy || "",
    note: i.note || "",
    issue_condition: i.issueCondition || "good",
    return_condition: i.returnCondition || null,
    damage_note_on_issue: i.damageNoteOnIssue || "",
    damage_note_on_return: i.damageNoteOnReturn || "",
    created_at: now,
    updated_at: now,
  };
}

function rowToIssue(r: Record<string, unknown>): LibraryIssue {
  const borrower = parseIssueDbStudentId(String(r.student_id || ""));
  const meta = parseIssueNote(String(r.note || ""));
  const borrowerTypeCol = String(r.borrower_type || "");
  const borrowerType =
    borrowerTypeCol === "staff" || borrowerTypeCol === "student"
      ? borrowerTypeCol
      : meta.borrowerType || borrower.borrowerType;

  const staffIdCol = String(r.staff_id || "");
  const issueConditionCol = r.issue_condition
    ? normalizeDbCondition(r.issue_condition)
    : undefined;
  const returnConditionCol = r.return_condition
    ? normalizeDbCondition(r.return_condition)
    : undefined;

  return {
    id: String(r.id),
    copyId: String(r.copy_id),
    borrowerType,
    studentId: borrowerType === "student" ? borrower.studentId : "",
    staffId:
      borrowerType === "staff"
        ? staffIdCol || meta.staffId || borrower.staffId
        : "",
    academicYearCode: String(r.academic_year_code),
    issuedOn: String(r.issued_on).slice(0, 10),
    dueOn: String(r.due_on).slice(0, 10),
    returnedOn: r.returned_on ? String(r.returned_on).slice(0, 10) : undefined,
    finePaise: Number(r.fine_paise ?? 0),
    issuedBy: String(r.issued_by || ""),
    note: meta.note || String(r.note || ""),
    issueCondition: issueConditionCol || meta.issueCondition || "good",
    returnCondition: returnConditionCol || meta.returnCondition,
    damageNoteOnIssue:
      String(r.damage_note_on_issue || "") || meta.damageNoteOnIssue || "",
    damageNoteOnReturn:
      String(r.damage_note_on_return || "") || meta.damageNoteOnReturn || "",
  };
}

function procurementToRow(
  tenantId: string,
  d: LibraryProcurementDoc,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const isDataUrl = d.fileUrl.startsWith("data:");
  const ocrJson = {
    ...(d.ocrJson ?? {}),
    _fileName: d.fileName || "",
    _mimeType: d.mimeType || "",
    _size: d.size ?? 0,
  };
  return {
    id: d.id,
    tenant_id: tenantId,
    label: d.label || "",
    vendor: d.vendor || "",
    bill_no: d.billNo || "",
    purchase_date: d.purchaseDate || null,
    amount_paise: d.amountPaise ?? 0,
    file_url: isDataUrl ? "" : d.fileUrl || "",
    file_data_ref: isDataUrl ? d.fileUrl : "",
    note: d.note || "",
    ocr_json: ocrJson,
    created_at: d.uploadedAt || now,
    updated_at: now,
  };
}

function rowToProcurement(r: Record<string, unknown>): LibraryProcurementDoc {
  const fileUrl = String(r.file_url || "");
  const fileDataRef = String(r.file_data_ref || "");
  const resolvedUrl = fileUrl || fileDataRef;
  const ocrRaw = r.ocr_json;
  const ocrMeta =
    ocrRaw && typeof ocrRaw === "object" && !Array.isArray(ocrRaw)
      ? (ocrRaw as Record<string, unknown>)
      : {};
  const { _fileName, _mimeType, _size, ...ocrJson } = ocrMeta;
  const mimeFromData =
    resolvedUrl.startsWith("data:") && resolvedUrl.includes(";")
      ? resolvedUrl.slice(5, resolvedUrl.indexOf(";"))
      : "";
  return {
    id: String(r.id),
    label: String(r.label || ""),
    vendor: String(r.vendor || ""),
    billNo: String(r.bill_no || ""),
    purchaseDate: r.purchase_date ? String(r.purchase_date).slice(0, 10) : "",
    amountPaise: Number(r.amount_paise ?? 0),
    fileName: String(_fileName || r.label || "document"),
    mimeType: String(_mimeType || mimeFromData || ""),
    fileUrl: resolvedUrl,
    size: Number(_size ?? 0),
    uploadedAt: String(r.created_at || new Date().toISOString()),
    note: String(r.note || ""),
    ocrJson: Object.keys(ocrJson).length > 0 ? ocrJson : undefined,
  };
}

/** The library tables a desk save deletes from — by named id only. */
export const LIBRARY_DELETABLE_TABLES = [
  "library_desk_titles",
  "library_desk_copies",
  "library_desk_procurement_docs",
] as const;

export async function pushLibraryDeskToDb(
  state: LibraryState,
  deletes: NamedDeletes = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!libraryDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const gone = (t: string) => new Set(deletes[t] ?? []);
  const goneTitles = gone("library_desk_titles");
  const goneCopies = gone("library_desk_copies");
  const goneDocs = gone("library_desk_procurement_docs");
  const titles = (state.titles ?? []).filter((t) => !goneTitles.has(t.id));
  const copies = (state.copies ?? []).filter((c) => !goneCopies.has(c.id) && !goneTitles.has(c.titleId));
  const issues = state.issues ?? [];
  const procurementDocs = (state.procurementDocs ?? []).filter((d) => !goneDocs.has(d.id));
  const settings = state.settings ?? {
    maxBooksPerStudent: 2,
    maxBooksPerStaff: 3,
    loanDays: 14,
    finePaisePerDay: 500,
  };

  // No prune by absence. Issues (the loan history) are never deleted —
  // a return sets returnedOn. A title, a copy or a procurement document goes
  // only when the user deleted it, and the deletion arrives named. Deleting
  // a title or copy cascades to its loans in the database, so only named ids
  // may ever reach that delete.
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

  r = await upsertChunks(
    sb,
    "library_desk_procurement_docs",
    procurementDocs.map((d) => procurementToRow(tenantId, d)),
  );
  if (!r.ok) return r;

  for (const table of LIBRARY_DELETABLE_TABLES) {
    const del = await deleteNamedIds(sb, tenantId, table, deletes[table]);
    if (!del.ok) return del;
  }

  await sb.from("library_desk_settings").upsert(
    {
      tenant_id: tenantId,
      max_books_per_student: settings.maxBooksPerStudent ?? 2,
      max_books_per_staff: settings.maxBooksPerStaff ?? 3,
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
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: LibraryDeskBundle = {
    titles: [],
    copies: [],
    issues: [],
    procurementDocs: [],
    settings: {
      maxBooksPerStudent: 2,
      maxBooksPerStaff: 3,
      loanDays: 14,
      finePaisePerDay: 500,
    },
  };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  // Paged: PostgREST stops at 1,000 rows and calls it success. Copies and
  // loans pass that; a browser handed the first thousand would not see the rest.
  const page = (table: string) =>
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from(table).select("*").eq("tenant_id", tenantId).order("id").range(from, to),
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null }));
  const [
    { data: titleRows, error: titleErr },
    { data: copyRows, error: copyErr },
    { data: issueRows, error: issueErr },
    { data: procurementRows, error: procurementErr },
    { data: settingsRow, error: settingsErr },
    { data: metaRow },
  ] = await Promise.all([
    page("library_desk_titles"),
    page("library_desk_copies"),
    page("library_desk_issues"),
    page("library_desk_procurement_docs"),
    sb
      .from("library_desk_settings")
      .select(
        "max_books_per_student, max_books_per_staff, loan_days, fine_paise_per_day",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb
      .from("library_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (titleErr || copyErr || issueErr || procurementErr || settingsErr) {
    console.warn(
      "[library-db] fetch failed",
      titleErr?.message,
      copyErr?.message,
      issueErr?.message,
      procurementErr?.message,
      settingsErr?.message,
    );
    return { bundle: empty, meta: null, ok: false };
  }

  const s = settingsRow as {
    max_books_per_student?: number;
    max_books_per_staff?: number;
    loan_days?: number;
    fine_paise_per_day?: number;
  } | null;

  return {
    bundle: {
      titles: (titleRows ?? []).map((r) => rowToTitle(r as Record<string, unknown>)),
      copies: (copyRows ?? []).map((r) => rowToCopy(r as Record<string, unknown>)),
      issues: (issueRows ?? []).map((r) => rowToIssue(r as Record<string, unknown>)),
      procurementDocs: (procurementRows ?? []).map((r) =>
        rowToProcurement(r as Record<string, unknown>),
      ),
      settings: {
        maxBooksPerStudent: s?.max_books_per_student ?? 2,
        maxBooksPerStaff: s?.max_books_per_staff ?? 3,
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
    ok: true,
  };
}
