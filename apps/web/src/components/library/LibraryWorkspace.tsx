"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccessData } from "@/components/shell/useAccessData";
import { isbnChecksumOk } from "@/lib/openLookups";
import { lookupIsbnApi } from "@/lib/openLookupsClient";
import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Library,
  Loader2,
  Repeat2,
} from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { hasPermission, visibleModuleTabs } from "@/lib/rbac";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import { DeskListActions } from "@/components/ui/desk-list-actions";
import { ExportMenu, RowActionMenu } from "@/components/ui/erp-grid";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import { DOC_ACCEPT, DOC_MAX_BYTES, studentsInSession} from "@/lib/sis";
import { DEFAULT_AY, formatInr, loadMasters, type MastersState, currentAcademicYearCode} from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  availableCountForTitle,
  copyCountForTitle,
  borrowerLabel,
  categoryLabel,
  conditionLabel,
  deleteProcurementDoc,
  deleteTitle,
  LIBRARY_CATEGORIES,
  LIBRARY_REPORT_GROUPS,
  libraryReportNeedsDateRange,
  libraryStats,
  listActiveTitles,
  loadLibrary,
  mergeEbookShelfSeed,
  saveLibrary,
  upsertEbookShelf,
  bookcaseCode,
  overdueIssues,
  runLibraryReport,
  upsertProcurementDoc,
  upsertTitle,
  type LibraryBorrowerType,
  type LibraryCategory,
  type LibraryIssue,
  type LibraryProcurementDoc,
  type LibraryEbook,
  type LibraryReportFormat,
  type LibraryReportId,
  type LibraryTitle,
} from "@/lib/library";
import { ensureLibraryHydrated, reloadLibraryFromServer, scheduleLibrarySync } from "@/lib/libraryPersistence";
import { flushLibraryDeskSync } from "@/lib/libraryNormalizedClient";
import { libraryApi } from "@/lib/libraryCounterClient";
import { LibraryCounterPanel } from "@/components/library/LibraryCounterPanel";
import { LibraryCopiesPanel } from "@/components/library/LibraryCopiesPanel";
import { LibraryCirculationPanel } from "@/components/library/LibraryCirculationPanel";
import { withHydrationSlot } from "@/lib/deskHydrateGuard";
import {
  runLibraryProcurementOcrApi,
  type LibraryProcurementOcrSuggestion,
} from "@/lib/ocrClient";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { RowAction } from "@/components/ui/erp-grid";

type LibTab =
  | "dashboard"
  | "titles"
  | "copies"
  | "issue"
  | "circulation"
  | "history"
  | "procurement"
  | "ebooks"
  | "lib_reports";

/*
 * Tab ids are the library's own: the library shares the store module with
 * the Store screen, and a tab id is how a function (Masters → Roles) opens a
 * tab — "catalogue"/"reports" would also open the Store's tabs of that name.
 * Old links (?tab=catalogue, ?tab=reports) still land on the right tab.
 */
const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "titles", label: "Catalogue", tone: "teal" },
  { id: "copies", label: "Copies & labels", tone: "sky" },
  { id: "issue", label: "Counter", tone: "amber" },
  { id: "circulation", label: "Circulation & fines", tone: "rose" },
  { id: "history", label: "History", tone: "green" },
  { id: "procurement", label: "Procurement", tone: "violet" },
  { id: "ebooks", label: "E-books", tone: "coral" },
  { id: "lib_reports", label: "Reports", tone: "slate" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  return `${todayIso().slice(0, 7)}-01`;
}

const emptyTitleForm = (): Omit<LibraryTitle, "id"> => ({
  title: "",
  author: "",
  isbn: "",
  publisher: "",
  edition: "",
  category: "book",
  shelf: "",
  purchaseDate: "",
  pricePaise: 0,
  copiesTotal: 1,
  isActive: true,
});

export function LibraryWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useState<LibTab>("dashboard");
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);

  // Catalogue
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogCategory, setCatalogCategory] = useState<LibraryCategory | "all">("all");
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleForm, setTitleForm] = useState(emptyTitleForm());
  const [isbnBusy, setIsbnBusy] = useState(false);
  const [isbnNote, setIsbnNote] = useState<string | null>(null);

  /**
   * Fill the catalogue row from Open Library, without overwriting work.
   *
   * Only empty boxes are touched. The librarian has the physical book in
   * hand and Open Library does not, so whatever they typed wins over
   * whatever a stranger catalogued — this saves typing, it does not
   * correct anybody.
   */
  async function fillFromIsbn() {
    setIsbnNote(null);
    setIsbnBusy(true);
    try {
      const res = await lookupIsbnApi(titleForm.isbn);
      if (!res.ok) {
        setIsbnNote(res.message);
        return;
      }
      const b = res.data;
      const filled: string[] = [];
      setTitleForm((f) => {
        const next = { ...f };
        if (!f.title.trim() && b.title) {
          next.title = b.title;
          filled.push("title");
        }
        if (!f.author.trim() && b.author) {
          next.author = b.author;
          filled.push("author");
        }
        if (!f.publisher.trim() && b.publisher) {
          next.publisher = b.publisher;
          filled.push("publisher");
        }
        if (!f.edition.trim() && b.year) {
          next.edition = b.year;
          filled.push("year");
        }
        return next;
      });
      setIsbnNote(
        filled.length
          ? `Filled ${filled.join(", ")} — check against the book.`
          : `Found "${b.title}" — every box was already filled, so nothing was changed.`,
      );
    } finally {
      setIsbnBusy(false);
    }
  }
  const [showTitleForm, setShowTitleForm] = useState(false);

  // History filters
  const [histBorrowerType, setHistBorrowerType] = useState<LibraryBorrowerType | "all">("all");
  const [histStudentId, setHistStudentId] = useState("");
  const [histStaffId, setHistStaffId] = useState("");
  const [histFrom, setHistFrom] = useState(monthStart());
  const [histTo, setHistTo] = useState(todayIso());
  const [histOpenOnly, setHistOpenOnly] = useState(false);

  // Procurement
  const fileRef = useRef<HTMLInputElement>(null);
  const [procLabel, setProcLabel] = useState("");
  const [procVendor, setProcVendor] = useState("");
  const [procBillNo, setProcBillNo] = useState("");
  const [procDate, setProcDate] = useState(todayIso());
  const [procAmount, setProcAmount] = useState("");
  const [procNote, setProcNote] = useState("");
  const [procFile, setProcFile] = useState<{
    fileName: string;
    mimeType: string;
    fileUrl: string;
    size: number;
    imageBase64?: string;
  } | null>(null);
  const [procOcrBusy, setProcOcrBusy] = useState(false);
  const [procOcr, setProcOcr] = useState<LibraryProcurementOcrSuggestion | null>(null);
  const [procOcrWarning, setProcOcrWarning] = useState<string | null>(null);

  // Reports
  const [reportId, setReportId] = useState<LibraryReportId>("catalog");
  const [reportFormat, setReportFormat] = useState<LibraryReportFormat>("excel");
  const [reportFrom, setReportFrom] = useState(monthStart());
  const [reportTo, setReportTo] = useState(todayIso());

  useEffect(() => {
    void withHydrationSlot(() => ensureLibraryHydrated()).then((changed) => {
      if (changed) refresh();
    });
     
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const asked = new URLSearchParams(window.location.search).get("tab");
    const raw = asked === "catalogue" ? "titles" : asked === "reports" ? "lib_reports" : asked;
    const allowed: LibTab[] = [
      "dashboard",
      "titles",
      "copies",
      "issue",
      "circulation",
      "history",
      "procurement",
      "ebooks",
      "lib_reports",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as LibTab);
  }, []);

  function refresh(msg?: string) {
    setTick((n) => n + 1);
    setMasters(loadMasters());
    setSis(loadSis());
    if (msg) {
      setNotice(msg);
      setError(null);
      window.setTimeout(() => setNotice(null), 2800);
    }
  }

  // The Store grant sees every tab; a library function (Masters → Roles)
  // opens its own tabs only (lib/rbacFeatureCatalog/store.ts).
  // Decided from the loaded roles + roster (assignments count), never before.
  const access = useAccessData();
  const shownTabs = useMemo(
    () =>
      access.ready
        ? visibleModuleTabs(TABS, session, access.masters, "store", access.rbac ?? undefined)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- access.version tracks the copies
    [session, access.ready, access.version],
  );
  const shownIds = useMemo(() => new Set<string>(shownTabs.map((t) => t.id)), [shownTabs]);
  const on = (t: LibTab) => tab === t && shownIds.has(t);
  useEffect(() => {
    if (shownTabs.length > 0 && !shownIds.has(tab)) setTab(shownTabs[0]!.id as LibTab);
  }, [shownTabs, shownIds, tab]);
  // Loan days, limits and the fine rule are the Store grant's, not the
  // counter clerk's (the server refuses a function save of them too).
  const rulesReadOnly =
    readOnly ||
    !access.ready ||
    !hasPermission(session, access.masters, "store", "edit", access.rbac ?? undefined);

  const state = useMemo(() => {
    void tick;
    return loadLibrary();
  }, [tick]);

  const staffRoster = useMemo(
    () => (masters?.staff ?? []).filter((s) => s.status === "active"),
    [masters],
  );

  const stats = libraryStats(state);
  const titles = listActiveTitles(state);
  const overdue = overdueIssues(state);

  /**
   * Overdue loans as a table: what is out, who has it, how late. A list could
   * not be sorted by how overdue a book was, which is the only order this is
   * ever read in.
   *
   * Open loans keep their list — each row opens a return form inside itself,
   * with a date, a condition and damage notes — and the procurement shelf
   * keeps its cards, because each is a photograph of a bill.
   */
  const overdueCols: DataTableColumn<(typeof overdue)[number]>[] = [
    { key: "title", header: "Item", value: (i) => titleForIssue(i), sortable: true },
    {
      key: "borrower", header: "With", sortable: true,
      value: (i) => borrowerLabel(i, { students: sis?.students, staff: staffRoster }),
    },
    { key: "due", header: "Due", value: (i) => i.dueOn, sortable: true },
    {
      key: "remind", header: "",
      render: () => (
        <Link href="/comms" className="text-xs font-semibold text-[var(--brand-deep)] underline">
          Remind on WA
        </Link>
      ),
    },
  ];

  const filteredTitles = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return titles.filter((t) => {
      if (catalogCategory !== "all" && t.category !== catalogCategory) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.author.toLowerCase().includes(q) ||
        t.isbn.toLowerCase().includes(q) ||
        t.shelf.toLowerCase().includes(q)
      );
    });
  }, [titles, catalogSearch, catalogCategory]);

  // "Available" is computed per title rather than stored, so it sorts on the
  // count itself, not on the rendered cell.
  const titleSort = useTableSort(
    filteredTitles,
    {
      title: (t) => t.title,
      category: (t) => categoryLabel(t.category),
      author: (t) => t.author || null,
      shelf: (t) => t.shelf || null,
      copies: (t) => copyCountForTitle(t.id, state),
      available: (t) => availableCountForTitle(t.id, state),
      purchase: (t) => t.purchaseDate || null,
    },
    "title",
  );

  // Borrowers for the counter and the circulation reports: one row per
  // child this session (SIS keeps a row per child per year), active staff.
  const studentPeople = useMemo(
    () =>
      sis
        ? studentsInSession(sis, currentAcademicYearCode(masters)).map((s) => ({
            id: s.id,
            label: s.fullName,
            sub: s.admissionNo,
          }))
        : [],
    [sis, masters],
  );
  const staffPeople = useMemo(
    () => staffRoster.map((s) => ({ id: s.id, label: s.fullName, sub: s.empCode || "" })),
    [staffRoster],
  );

  /**
   * After the server changed loans, copies, fines or rules: take its desk
   * as it now is. If that read fails the screen says so — it does not keep
   * showing the old copy as if it were current.
   */
  async function afterServerChange(msg: string) {
    const ok = await reloadLibraryFromServer();
    if (!ok) {
      flashErr(`${msg} — but the library could not be reloaded; refresh the page to see it.`);
      return;
    }
    refresh(msg);
  }

  const filteredHistory = useMemo(() => {
    return state.issues
      .filter((i) => i.issuedOn >= histFrom && i.issuedOn <= histTo)
      .filter((i) => (histOpenOnly ? !i.returnedOn : true))
      .filter((i) => {
        if (histBorrowerType === "all") return true;
        return i.borrowerType === histBorrowerType;
      })
      .filter((i) => {
        if (histBorrowerType === "student" && histStudentId) {
          return i.studentId === histStudentId;
        }
        if (histBorrowerType === "staff" && histStaffId) {
          return i.staffId === histStaffId;
        }
        return true;
      })
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
  }, [
    state.issues,
    histFrom,
    histTo,
    histOpenOnly,
    histBorrowerType,
    histStudentId,
    histStaffId,
  ]);
  // Newest loan first, as the history always opened.
  const historySort = useTableSort(
    filteredHistory,
    {
      title: (i) => titleForIssue(i),
      accession: (i) => {
        const acc = accessionForIssue(i);
        return acc === "—" ? null : acc;
      },
      borrower: (i) =>
        borrowerLabel(i, { students: sis?.students, staff: staffRoster }),
      issued: (i) => i.issuedOn,
      due: (i) => i.dueOn || null,
      // Still out: no return date yet, so it sorts with the blanks.
      returned: (i) => i.returnedOn || null,
      condition: (i) => conditionLabel(i.issueCondition),
      fine: (i) => i.finePaise || 0,
    },
    "issued",
    "desc",
  );

  function flashErr(msg: string) {
    setError(msg);
    setNotice(null);
  }

  function resetTitleForm() {
    setEditingTitleId(null);
    setTitleForm(emptyTitleForm());
    setShowTitleForm(false);
  }

  function startEditTitle(t: LibraryTitle) {
    setEditingTitleId(t.id);
    setTitleForm({
      title: t.title,
      author: t.author,
      isbn: t.isbn,
      publisher: t.publisher,
      edition: t.edition,
      category: t.category,
      shelf: t.shelf,
      purchaseDate: t.purchaseDate,
      pricePaise: t.pricePaise,
      copiesTotal: t.copiesTotal,
      isActive: t.isActive,
    });
    setShowTitleForm(true);
  }

  async function saveTitle() {
    if (!titleForm.title.trim()) {
      flashErr("Title is required");
      return;
    }
    const isNew = !editingTitleId;
    const wantCopies = isNew ? Math.max(0, Math.floor(titleForm.copiesTotal || 0)) : 0;
    const row = upsertTitle({
      ...titleForm,
      id: editingTitleId || undefined,
      title: titleForm.title.trim(),
    });
    resetTitleForm();
    if (!wantCopies) {
      refresh(isNew ? "Catalogue item added" : "Catalogue item updated");
      return;
    }
    // Copies need the title on the server first (each copy gets its
    // accession number there), so send the title now rather than after the
    // usual pause, then ask for the copies.
    scheduleLibrarySync(loadLibrary());
    await flushLibraryDeskSync();
    const r = await libraryApi.addCopies({ titleId: row.id, count: wantCopies, location: row.shelf, source: "purchase", acquiredOn: row.purchaseDate || undefined });
    if (!r.ok) {
      refresh();
      flashErr(`"${row.title}" added, but its copies were not: ${r.error}. Add them in Copies & labels.`);
      return;
    }
    await afterServerChange(`"${row.title}" added with ${r.copies.length} copy(ies): ${r.copies.map((c) => c.accessionNo).join(", ")}`);
  }

  function handleDeleteTitle(id: string) {
    const result = deleteTitle(id);
    if (!result.ok) {
      flashErr(result.reason);
      return;
    }
    refresh("Catalogue item deleted");
  }

  function acceptProcFile(file: File | null) {
    if (!file) return;
    const okType =
      file.type === "application/pdf" || file.type.startsWith("image/");
    if (!okType) {
      flashErr("Use PDF or image (JPG/PNG/WebP)");
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      flashErr(`File must be under ${Math.round(DOC_MAX_BYTES / 1000)} KB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const dataUrl = reader.result;
      const comma = dataUrl.indexOf(",");
      setProcFile({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileUrl: dataUrl,
        size: file.size,
        imageBase64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
      });
      setProcOcr(null);
      setProcOcrWarning(null);
    };
    reader.onerror = () => flashErr("Could not read file");
    reader.readAsDataURL(file);
  }

  async function runProcurementOcr() {
    if (!procFile?.imageBase64) {
      flashErr("Select an image scan first (PDF not supported for OpenAI OCR)");
      return;
    }
    if (procFile.mimeType === "application/pdf") {
      flashErr("OpenAI OCR needs a JPG/PNG image — PDF is attach-only");
      return;
    }
    setProcOcrBusy(true);
    setProcOcrWarning(null);
    try {
      const r = await runLibraryProcurementOcrApi({
        imageBase64: procFile.imageBase64,
        mimeType: procFile.mimeType,
      });
      if (!r.ok || !r.suggestion) {
        flashErr(
          r.error ||
            (r.openAiConfigured === false
              ? "OPENAI_API_KEY not configured"
              : "OCR failed"),
        );
        return;
      }
      setProcOcr(r.suggestion);
      if (r.suggestion.vendor) setProcVendor(r.suggestion.vendor);
      if (r.suggestion.billNo) setProcBillNo(r.suggestion.billNo);
      if (r.suggestion.billDate) setProcDate(r.suggestion.billDate);
      if (r.suggestion.totalAmount != null && r.suggestion.totalAmount > 0) {
        setProcAmount(String(r.suggestion.totalAmount));
      }
      const noteParts = [r.suggestion.notes, r.suggestion.gst]
        .filter(Boolean)
        .join(" · ");
      if (noteParts) setProcNote(noteParts);
      setProcOcrWarning(r.warning || null);
      refresh(
        r.warning
          ? `OCR applied (${r.suggestion.confidence}) — ${r.warning}`
          : `OCR applied (${r.suggestion.confidence})`,
      );
    } finally {
      setProcOcrBusy(false);
    }
  }

  function saveProcurement() {
    if (!procFile) {
      flashErr("Upload a bill or challan scan");
      return;
    }
    upsertProcurementDoc({
      label: procLabel.trim() || "Procurement bill",
      vendor: procVendor.trim(),
      billNo: procBillNo.trim(),
      purchaseDate: procDate,
      amountPaise: Math.round(Number(procAmount || 0) * 100),
      fileName: procFile.fileName,
      mimeType: procFile.mimeType,
      fileUrl: procFile.fileUrl,
      size: procFile.size,
      note: procNote.trim(),
      ocrJson: procOcr ? (procOcr as unknown as Record<string, unknown>) : undefined,
    });
    setProcLabel("");
    setProcVendor("");
    setProcBillNo("");
    setProcAmount("");
    setProcNote("");
    setProcFile(null);
    setProcOcr(null);
    setProcOcrWarning(null);
    if (fileRef.current) fileRef.current.value = "";
    refresh("Procurement document saved");
  }

  function handleDeleteProc(doc: LibraryProcurementDoc) {
    const result = deleteProcurementDoc(doc.id);
    if (!result.ok) {
      flashErr(result.reason);
      return;
    }
    refresh("Document deleted");
  }

  function exportReport() {
    const students = (sis?.students ?? []).map((s) => ({
      id: s.id,
      fullName: s.fullName,
      admissionNo: s.admissionNo,
    }));
    const staff = staffRoster.map((s) => ({
      id: s.id,
      fullName: s.fullName,
      empCode: s.empCode,
    }));
    const result = runLibraryReport({
      reportId,
      format: reportFormat,
      fromDate: reportFrom,
      toDate: reportTo,
      state,
      students,
      staff,
    });
    if (!result.ok) flashErr(result.error);
    else refresh("Report exported");
  }

  function titleForIssue(issue: LibraryIssue): string {
    const copy = state.copies.find((c) => c.id === issue.copyId);
    const title = copy ? titles.find((t) => t.id === copy.titleId) : undefined;
    return title?.title || "Book";
  }

  function accessionForIssue(issue: LibraryIssue): string {
    const copy = state.copies.find((c) => c.id === issue.copyId);
    return copy?.accessionNo || "—";
  }

  return (
    <ErpWorkspaceShell
      title="Library"
      subtitle={`${stats.titles} titles · ${stats.available} available · ${stats.issued} issued · ${stats.overdue} overdue`}
      icon={<Library className="size-6" aria-hidden />}
      notice={notice}
      error={error}
    >
      <ModuleTabs
        value={tab}
        onChange={(id) => setTab(id as LibTab)}
        items={shownTabs}
      />

      {on("dashboard") ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Titles", value: stats.titles, icon: BookOpen },
              { label: "Total copies", value: stats.copies, icon: Library },
              { label: "Available", value: stats.available, icon: Repeat2 },
              { label: "Issued", value: stats.issued, icon: ClipboardList },
              { label: "Damaged", value: stats.damaged, icon: FileText },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
              >
                <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <c.icon className="size-4" aria-hidden />
                  {c.label}
                </div>
                <p className="mt-1 text-2xl font-bold text-[var(--brand-deep)]">
                  {c.value}
                </p>
              </div>
            ))}
          </div>
          {overdue.length > 0 ? (
            <div className="rounded-xl border border-[rgba(180,35,24,0.2)] bg-[rgba(180,35,24,0.04)] p-4">
              <p className="text-sm font-semibold text-[var(--danger)]">
                {overdue.length} overdue loan(s)
              </p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-[var(--brand-deep)] underline"
                onClick={() => setTab("history")}
              >
                View in history →
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {on("titles") ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[12rem] flex-1 text-xs text-[var(--muted)]">
              Search
              <input
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                className={`${field} mt-1`}
                placeholder="Title, author, ISBN, rack…"
              />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              Category
              <select
                value={catalogCategory}
                onChange={(e) =>
                  setCatalogCategory(e.target.value as LibraryCategory | "all")
                }
                className={`${field} mt-1`}
              >
                <option value="all">All</option>
                {LIBRARY_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {!readOnly ? (
              <button
                type="button"
                className={btn}
                onClick={() => {
                  resetTitleForm();
                  setShowTitleForm(true);
                }}
              >
                + Add item
              </button>
            ) : null}
          </div>

          {showTitleForm ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
                {editingTitleId ? "Edit catalogue item" : "New catalogue item"}
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block text-xs text-[var(--muted)] sm:col-span-2">
                  Title *
                  <input
                    value={titleForm.title}
                    onChange={(e) =>
                      setTitleForm((f) => ({ ...f, title: e.target.value }))
                    }
                    className={`${field} mt-1`}
                  />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Category
                  <select
                    value={titleForm.category}
                    onChange={(e) =>
                      setTitleForm((f) => ({
                        ...f,
                        category: e.target.value as LibraryCategory,
                      }))
                    }
                    className={`${field} mt-1`}
                  >
                    {LIBRARY_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Author
                  <input
                    value={titleForm.author}
                    onChange={(e) =>
                      setTitleForm((f) => ({ ...f, author: e.target.value }))
                    }
                    className={`${field} mt-1`}
                  />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  ISBN / barcode
                  <input
                    value={titleForm.isbn}
                    onChange={(e) =>
                      setTitleForm((f) => ({ ...f, isbn: e.target.value }))
                    }
                    className={`${field} mt-1`}
                  />
                  {/* Free Open Library lookup. It fills ONLY the boxes that
                      are still empty, so a librarian who has already typed
                      the title they can see on the cover never has it
                      replaced by a different edition's wording. */}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isbnBusy || !isbnChecksumOk(titleForm.isbn)}
                      onClick={() => void fillFromIsbn()}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold disabled:opacity-40"
                      title={
                        isbnChecksumOk(titleForm.isbn)
                          ? "Fetch title, author and publisher"
                          : "Enter a full ISBN first"
                      }
                    >
                      {isbnBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <BookOpen className="h-3 w-3" />
                      )}
                      {isbnBusy ? "Looking up…" : "Fetch details"}
                    </button>
                    {isbnNote ? (
                      <span className="text-[11px] text-[var(--muted)]">{isbnNote}</span>
                    ) : null}
                  </div>
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Publisher
                  <input
                    value={titleForm.publisher}
                    onChange={(e) =>
                      setTitleForm((f) => ({ ...f, publisher: e.target.value }))
                    }
                    className={`${field} mt-1`}
                  />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Edition
                  <input
                    value={titleForm.edition}
                    onChange={(e) =>
                      setTitleForm((f) => ({ ...f, edition: e.target.value }))
                    }
                    className={`${field} mt-1`}
                  />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Rack / shelf
                  <input
                    value={titleForm.shelf}
                    onChange={(e) =>
                      setTitleForm((f) => ({ ...f, shelf: e.target.value }))
                    }
                    className={`${field} mt-1`}
                    placeholder="e.g. A-12"
                  />
                </label>
                {/* Copies are added once, here for a new title, and in
                    Copies & labels after that — each gets a server-issued
                    accession number and its own location. */}
                {!editingTitleId ? (
                  <label className="block text-xs text-[var(--muted)]">
                    Copies to add now (accession nos. are given automatically)
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={titleForm.copiesTotal}
                      onChange={(e) =>
                        setTitleForm((f) => ({
                          ...f,
                          copiesTotal: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className={`${field} mt-1`}
                    />
                  </label>
                ) : null}
                <label className="block text-xs text-[var(--muted)]">
                  Purchase date
                  <input
                    type="date"
                    value={titleForm.purchaseDate}
                    onChange={(e) =>
                      setTitleForm((f) => ({ ...f, purchaseDate: e.target.value }))
                    }
                    className={`${field} mt-1`}
                  />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Price (₹)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={titleForm.pricePaise ? titleForm.pricePaise / 100 : ""}
                    onChange={(e) =>
                      setTitleForm((f) => ({
                        ...f,
                        pricePaise: Math.round(Number(e.target.value || 0) * 100),
                      }))
                    }
                    className={`${field} mt-1`}
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {!readOnly ? (
                  <>
                    <button type="button" className={btn} onClick={() => void saveTitle()}>
                      Save
                    </button>
                    <button type="button" className={btnOutline} onClick={resetTitleForm}>
                      Cancel
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex justify-end">
            <ExportMenu
              title="Library catalogue"
              subtitle={`${filteredTitles.length} title(s)`}
              fileBaseName="library_catalogue"
              columns={[
                { key: "title", header: "Title", width: 2 },
                { key: "isbn", header: "ISBN" },
                { key: "category", header: "Category" },
                { key: "author", header: "Author", width: 1.5 },
                { key: "shelf", header: "Rack" },
                { key: "copies", header: "Copies", align: "right" },
                { key: "available", header: "Available", align: "right" },
                { key: "purchase", header: "Purchase" },
              ]}
              rows={() =>
                titleSort.rows.map((t) => ({
                  title: t.title,
                  isbn: t.isbn || "",
                  category: categoryLabel(t.category),
                  author: t.author || "",
                  shelf: t.shelf || "",
                  copies: copyCountForTitle(t.id, state),
                  available: availableCountForTitle(t.id, state),
                  purchase: t.purchaseDate || "",
                }))
              }
              onMessage={(msg) => {
                setNotice(msg);
                window.setTimeout(() => setNotice(null), 2800);
              }}
              compact
            />
          </div>
          <ErpTableShell>
            <div className="overflow-x-auto">
              <ErpTable minWidth="min-w-[56rem]">
                <ErpTableHead>
                  <tr>
                    <ErpSortTh sort={titleSort} field="title">Title</ErpSortTh>
                    <ErpSortTh sort={titleSort} field="category">Category</ErpSortTh>
                    <ErpSortTh sort={titleSort} field="author">Author</ErpSortTh>
                    <ErpSortTh sort={titleSort} field="shelf">Rack</ErpSortTh>
                    <ErpSortTh sort={titleSort} field="copies">Copies</ErpSortTh>
                    <ErpSortTh sort={titleSort} field="available">Available</ErpSortTh>
                    <ErpSortTh sort={titleSort} field="purchase">Purchase</ErpSortTh>
                    <th className="px-4 py-2.5 font-bold" />
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {filteredTitles.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                      >
                        No catalogue items yet. Add books, magazines, newspapers, or
                        project references.
                      </td>
                    </tr>
                  ) : (
                    titleSort.rows.map((t) => (
                      <tr key={t.id} className="hover:bg-[var(--surface-sunken)]">
                        <td className="px-4 py-2">
                          <p className="font-medium">{t.title}</p>
                          {t.isbn ? (
                            <p className="text-[11px] text-[var(--muted)]">{t.isbn}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2">{categoryLabel(t.category)}</td>
                        <td className="px-4 py-2">{t.author || "—"}</td>
                        <td className="px-4 py-2">{t.shelf || "—"}</td>
                        <td className="px-4 py-2">{copyCountForTitle(t.id, state)}</td>
                        <td className="px-4 py-2">
                          {availableCountForTitle(t.id, state)}
                        </td>
                        <td className="px-4 py-2 text-xs">{t.purchaseDate || "—"}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <RowActionMenu
                              row={t}
                              label={`Actions for ${t.title}`}
                              actions={[
                                {
                                  id: "issue",
                                  label: "Issue a copy",
                                  hidden: () => readOnly,
                                  onSelect: () => setTab("issue"),
                                },
                                {
                                  id: "history",
                                  label: "Loan history",
                                  onSelect: () => setTab("history"),
                                },
                                {
                                  id: "copies",
                                  label: "Copies & labels",
                                  onSelect: () => setTab("copies"),
                                },
                                {
                                  id: "edit",
                                  label: "Edit details",
                                  hidden: () => readOnly,
                                  onSelect: (r) => startEditTitle(r),
                                },
                              ]}
                            />
                            <DeskListActions
                              readOnly={readOnly}
                              onDelete={() => handleDeleteTitle(t.id)}
                              deleteConfirm={`Delete "${t.title}" from catalogue?`}
                            />
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </ErpTableBody>
              </ErpTable>
            </div>
          </ErpTableShell>
        </div>
      ) : null}

      {on("issue") ? (
        <LibraryCounterPanel
          state={state}
          students={studentPeople}
          staff={staffPeople}
          ay={ay}
          readOnly={readOnly}
          rulesReadOnly={rulesReadOnly}
          onChanged={afterServerChange}
          onError={flashErr}
        />
      ) : null}

      {on("copies") ? (
        <LibraryCopiesPanel state={state} readOnly={readOnly} onChanged={afterServerChange} onError={flashErr} />
      ) : null}

      {on("circulation") ? (
        <LibraryCirculationPanel
          state={state}
          students={studentPeople}
          staff={staffPeople}
          readOnly={readOnly}
          onChanged={afterServerChange}
          onError={flashErr}
        />
      ) : null}

      {on("history") ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <label className="block text-xs text-[var(--muted)]">
              From
              <input
                type="date"
                value={histFrom}
                onChange={(e) => setHistFrom(e.target.value)}
                className={`${field} mt-1`}
              />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              To
              <input
                type="date"
                value={histTo}
                onChange={(e) => setHistTo(e.target.value)}
                className={`${field} mt-1`}
              />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              Borrower type
              <select
                value={histBorrowerType}
                onChange={(e) =>
                  setHistBorrowerType(e.target.value as LibraryBorrowerType | "all")
                }
                className={`${field} mt-1`}
              >
                <option value="all">All</option>
                <option value="student">Student</option>
                <option value="staff">Staff</option>
              </select>
            </label>
            {histBorrowerType === "student" ? (
              <label className="block min-w-[10rem] text-xs text-[var(--muted)]">
                Student
                <select
                  value={histStudentId}
                  onChange={(e) => setHistStudentId(e.target.value)}
                  className={`${field} mt-1`}
                >
                  <option value="">All students</option>
                  {studentsInSession(sis, currentAcademicYearCode(masters))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {histBorrowerType === "staff" ? (
              <label className="block min-w-[10rem] text-xs text-[var(--muted)]">
                Staff
                <select
                  value={histStaffId}
                  onChange={(e) => setHistStaffId(e.target.value)}
                  className={`${field} mt-1`}
                >
                  <option value="">All staff</option>
                  {staffRoster.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex items-center gap-2 pb-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={histOpenOnly}
                onChange={(e) => setHistOpenOnly(e.target.checked)}
              />
              Open loans only
            </label>
          </div>

          <div className="flex justify-end">
            <ExportMenu
              title="Library transactions"
              subtitle={`${filteredHistory.length} loan(s)${histOpenOnly ? " · open only" : ""}`}
              fileBaseName="library_transactions"
              columns={[
                { key: "title", header: "Title", width: 2 },
                { key: "accession", header: "Accession" },
                { key: "borrower", header: "Borrower", width: 1.6 },
                { key: "type", header: "Type" },
                { key: "issued", header: "Issued" },
                { key: "due", header: "Due" },
                { key: "returned", header: "Returned" },
                { key: "fine", header: "Fine (₹)", align: "right" },
              ]}
              rows={() =>
                filteredHistory.map((issue) => ({
                  title: titleForIssue(issue),
                  accession: accessionForIssue(issue),
                  borrower: borrowerLabel(issue, { students: sis?.students, staff: staffRoster }),
                  type: issue.borrowerType,
                  issued: issue.issuedOn,
                  due: issue.dueOn,
                  returned: issue.returnedOn || "Open",
                  fine: issue.finePaise ? issue.finePaise / 100 : "",
                }))
              }
              onMessage={(msg) => {
                setNotice(msg);
                window.setTimeout(() => setNotice(null), 2800);
              }}
              compact
            />
          </div>
          <ErpTableShell>
            <div className="overflow-x-auto">
              <ErpTable minWidth="min-w-[64rem]">
                <ErpTableHead>
                  <tr>
                    <ErpSortTh sort={historySort} field="title" className="px-4 py-2.5 font-bold">Title</ErpSortTh>
                    <ErpSortTh sort={historySort} field="accession" className="px-4 py-2.5 font-bold">Accession</ErpSortTh>
                    <ErpSortTh sort={historySort} field="borrower" className="px-4 py-2.5 font-bold">Borrower</ErpSortTh>
                    <ErpSortTh sort={historySort} field="issued" className="px-4 py-2.5 font-bold">Issued</ErpSortTh>
                    <ErpSortTh sort={historySort} field="due" className="px-4 py-2.5 font-bold">Due</ErpSortTh>
                    <ErpSortTh sort={historySort} field="returned" className="px-4 py-2.5 font-bold">Returned</ErpSortTh>
                    <ErpSortTh sort={historySort} field="condition" className="px-4 py-2.5 font-bold">Condition</ErpSortTh>
                    <ErpSortTh sort={historySort} field="fine" className="px-4 py-2.5 font-bold">Fine</ErpSortTh>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {filteredHistory.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                      >
                        No transactions in this range
                      </td>
                    </tr>
                  ) : (
                    historySort.rows.map((issue) => (
                      <tr key={issue.id} className="hover:bg-[var(--surface-sunken)]">
                        <td className="px-4 py-2 font-medium">
                          {titleForIssue(issue)}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {accessionForIssue(issue)}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {borrowerLabel(issue, {
                            students: sis?.students,
                            staff: staffRoster,
                          })}
                          <span className="ml-1 text-[var(--muted)]">
                            ({issue.borrowerType})
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs">{issue.issuedOn}</td>
                        <td className="px-4 py-2 text-xs">{issue.dueOn}</td>
                        <td className="px-4 py-2 text-xs">
                          {issue.returnedOn || (
                            <span className="font-semibold text-[#b54708]">Open</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          <span>{conditionLabel(issue.issueCondition)}</span>
                          {issue.returnCondition ? (
                            <span className="text-[var(--muted)]">
                              {" "}
                              → {conditionLabel(issue.returnCondition)}
                            </span>
                          ) : null}
                          {issue.damageNoteOnIssue || issue.damageNoteOnReturn ? (
                            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                              {[issue.damageNoteOnIssue, issue.damageNoteOnReturn]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {issue.finePaise ? formatInr(issue.finePaise) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </ErpTableBody>
              </ErpTable>
            </div>
          </ErpTableShell>

          {overdue.length > 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                Overdue reminders
              </h3>
              <DataTable
                columns={overdueCols}
                rows={overdue}
                rowKey={(i) => i.id}
                minWidth="min-w-[640px]"
                exportFileBaseName="library-overdue"
                exportTitle="Overdue loans"
                emptyTitle="Nothing overdue"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {on("procurement") ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-deep)]">
              <FileText className="size-4" aria-hidden />
              Upload bill / challan
            </h2>
            <div className="mt-3 grid gap-3">
              <label className="block text-xs text-[var(--muted)]">
                Label
                <input
                  value={procLabel}
                  onChange={(e) => setProcLabel(e.target.value)}
                  className={`${field} mt-1`}
                  placeholder="e.g. March book purchase"
                />
              </label>
              <label className="block text-xs text-[var(--muted)]">
                Vendor
                <input
                  value={procVendor}
                  onChange={(e) => setProcVendor(e.target.value)}
                  className={`${field} mt-1`}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-[var(--muted)]">
                  Bill / challan no.
                  <input
                    value={procBillNo}
                    onChange={(e) => setProcBillNo(e.target.value)}
                    className={`${field} mt-1`}
                  />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Date
                  <input
                    type="date"
                    value={procDate}
                    onChange={(e) => setProcDate(e.target.value)}
                    className={`${field} mt-1`}
                  />
                </label>
              </div>
              <label className="block text-xs text-[var(--muted)]">
                Amount (₹)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={procAmount}
                  onChange={(e) => setProcAmount(e.target.value)}
                  className={`${field} mt-1`}
                />
              </label>
              <label className="block text-xs text-[var(--muted)]">
                Scan (PDF or image)
                <input
                  ref={fileRef}
                  type="file"
                  accept={DOC_ACCEPT}
                  className="mt-1 block w-full text-xs"
                  onChange={(e) => acceptProcFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {procFile ? (
                <p className="text-xs text-[var(--muted)]">
                  Attached: {procFile.fileName}
                </p>
              ) : null}
              {procFile && procFile.mimeType.startsWith("image/") && !readOnly ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={btnOutline}
                    disabled={procOcrBusy}
                    onClick={() => void runProcurementOcr()}
                  >
                    {procOcrBusy ? "Reading bill…" : "Run bill OCR (OpenAI)"}
                  </button>
                  {procOcr ? (
                    <span className="text-[11px] text-[var(--muted)]">
                      Confidence: {procOcr.confidence}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {procOcrWarning ? (
                <p className="text-[11px] text-amber-700">{procOcrWarning}</p>
              ) : null}
              <label className="block text-xs text-[var(--muted)]">
                Note
                <textarea
                  value={procNote}
                  onChange={(e) => setProcNote(e.target.value)}
                  className={`${field} mt-1 min-h-[4rem]`}
                />
              </label>
              {!readOnly ? (
                <button type="button" className={btn} onClick={saveProcurement}>
                  Save document
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              Procurement records
            </h2>
            <ul className="mt-3 divide-y divide-[var(--border)] text-sm">
              {state.procurementDocs.length === 0 ? (
                <li className="py-6 text-center text-[var(--muted)]">
                  No procurement documents yet
                </li>
              ) : (
                state.procurementDocs.map((doc) => (
                  <li key={doc.id} className="flex gap-3 py-3">
                    {doc.mimeType.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={doc.fileUrl}
                        alt=""
                        className="h-14 w-14 rounded-lg border object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg border bg-[var(--surface-sunken)] text-[10px] font-bold uppercase">
                        PDF
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{doc.label}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {doc.vendor || "—"}
                        {doc.billNo ? ` · ${doc.billNo}` : ""}
                        {doc.purchaseDate ? ` · ${doc.purchaseDate}` : ""}
                        {doc.amountPaise ? ` · ${formatInr(doc.amountPaise)}` : ""}
                      </p>
                      <a
                        href={doc.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-[var(--brand-deep)] underline"
                      >
                        View file
                      </a>
                      <div className="mt-1">
                        <DeskListActions
                          readOnly={readOnly}
                          onDelete={() => handleDeleteProc(doc)}
                          deleteConfirm="Delete this procurement document?"
                        />
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}

      {on("ebooks") ? (
        <EbooksPanel
          tick={tick}
          readOnly={readOnly}
          onChanged={(msg) => refresh(msg)}
        />
      ) : null}

      {on("lib_reports") ? (
        <div className="max-w-lg space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-deep)]">
            <BarChart3 className="size-4" aria-hidden />
            Export reports
          </h2>
          <label className="block text-xs text-[var(--muted)]">
            Report
            <select
              value={reportId}
              onChange={(e) => setReportId(e.target.value as LibraryReportId)}
              className={`${field} mt-1`}
            >
              {LIBRARY_REPORT_GROUPS.map((g) => (
                <optgroup key={g.category} label={g.category}>
                  {g.reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {libraryReportNeedsDateRange(reportId) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-[var(--muted)]">
                From
                <input
                  type="date"
                  value={reportFrom}
                  onChange={(e) => setReportFrom(e.target.value)}
                  className={`${field} mt-1`}
                />
              </label>
              <label className="block text-xs text-[var(--muted)]">
                To
                <input
                  type="date"
                  value={reportTo}
                  onChange={(e) => setReportTo(e.target.value)}
                  className={`${field} mt-1`}
                />
              </label>
            </div>
          ) : null}
          <label className="block text-xs text-[var(--muted)]">
            Format
            <select
              value={reportFormat}
              onChange={(e) => setReportFormat(e.target.value as LibraryReportFormat)}
              className={`${field} mt-1`}
            >
              <option value="excel">Excel</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <button type="button" className={btn} onClick={exportReport}>
            Export
          </button>
          <p className="text-xs text-[var(--muted)]">
            {LIBRARY_REPORT_GROUPS.flatMap((g) => g.reports).find((r) => r.id === reportId)
              ?.hint}
          </p>
        </div>
      ) : null}
    </ErpWorkspaceShell>
  );
}

/* ─── E-books shelf ─────────────────────────────────────────── */

/**
 * The school's FlipHTML5 shelf, catalogued: which bookcase is which book,
 * for which class and subject. This list feeds two readers — the parent /
 * student shelf API (which attaches the pass key) and the teaching module's
 * "from school shelf" picker on chapter resources. The codes are opaque and
 * the shelf pages unreadable from here, so a person who has the shelf open
 * names each one, once, and it sticks.
 */
function EbooksPanel({
  tick,
  readOnly,
  onChanged,
}: {
  tick: number;
  readOnly: boolean;
  onChanged: (msg: string) => void;
}) {
  const state = useMemo(() => {
    void tick;
    return loadLibrary();
  }, [tick]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [classes, setClasses] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  function beginEdit(b: LibraryEbook) {
    setEditId(b.id);
    setUrl(b.url);
    setTitle(b.title);
    setSubject(b.subject);
    setClasses(b.classLabels.join(", "));
  }

  function submit() {
    const res = upsertEbookShelf(state, {
      url: url.trim(),
      title: title.trim(),
      subject: subject.trim(),
      classLabels: classes
        .split(/[,\s]+/)
        .map((c) => c.trim())
        .filter(Boolean),
    });
    if ("error" in res) {
      onChanged(res.error);
      return;
    }
    saveLibrary(res.state);
    setUrl("");
    setTitle("");
    setSubject("");
    setClasses("");
    setEditId(null);
    onChanged(editId ? "E-book updated" : "E-book added to the shelf");
  }

  function loadSeed() {
    const merged = mergeEbookShelfSeed(state.ebooks);
    if (merged.added === 0) {
      onChanged("Every seeded bookcase is already on the shelf");
      return;
    }
    saveLibrary({ ...state, ebooks: merged.ebooks });
    onChanged(
      `${merged.added} bookcases added — name each one so readers know what it is`,
    );
  }

  const ebookCols: DataTableColumn<LibraryEbook>[] = [
    {
      key: "title", header: "E-book", sortable: true,
      value: (b) => b.title || bookcaseCode(b.url) || "",
      render: (b) => (
        <span className={b.isActive ? undefined : "opacity-50"}>
          <span className="font-medium text-[var(--brand-deep)]">
            {b.title || `Untitled (${bookcaseCode(b.url) || "?"})`}
          </span>
          {!b.title ? (
            <span className="ml-2 rounded-full bg-[rgba(197,160,40,0.18)] px-2 py-0.5 text-[10px] font-bold text-[#8a5a10]">
              needs a name
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "subject", header: "Subject", value: (b) => b.subject || "—", sortable: true },
    {
      key: "classes", header: "Classes",
      value: (b) => (b.classLabels.length ? b.classLabels.join(", ") : "—"),
    },
    {
      key: "visible", header: "On the shelf", sortable: true,
      value: (b) => (b.isActive ? "Visible" : "Hidden"),
      render: (b) =>
        b.isActive ? (
          <span className="text-[var(--ok)]">Visible</span>
        ) : (
          <span className="text-[var(--muted)]">Hidden</span>
        ),
    },
  ];

  const ebookActions: RowAction<LibraryEbook>[] = [
    { id: "open", label: "Open", onSelect: (b) => window.open(b.url, "_blank", "noopener,noreferrer") },
    { id: "edit", label: "Edit", hidden: () => readOnly, onSelect: (b) => beginEdit(b) },
    {
      id: "toggle",
      label: "Hide from readers",
      hidden: () => readOnly,
      onSelect: (b) => toggleActive(b),
    },
  ];

  function toggleActive(b: LibraryEbook) {
    saveLibrary({
      ...state,
      ebooks: state.ebooks.map((e) =>
        e.id === b.id ? { ...e, isActive: !e.isActive } : e,
      ),
    });
    onChanged(b.isActive ? "Hidden from readers" : "Visible to readers again");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              E-book shelf ({state.ebooks.length})
            </h2>
            <p className="text-xs text-[var(--muted)]">
              These feed the parent shelf and the syllabus &ldquo;from school
              shelf&rdquo; picker. Name, subject and classes are what readers
              and teachers see.
            </p>
          </div>
          {!readOnly ? (
            <button
              type="button"
              onClick={loadSeed}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
            >
              Load school bookcases
            </button>
          ) : null}
        </div>

        {!readOnly ? (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2">
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              FlipHTML5 shelf link
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://fliphtml5.com/bookcase/…"
                className="mt-1 block w-72 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              />
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Class VIII Maths"
                className="mt-1 block w-48 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              />
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Subject
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Mathematics"
                className="mt-1 block w-36 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              />
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Classes
              <input
                value={classes}
                onChange={(e) => setClasses(e.target.value)}
                placeholder="VIII or VI, VII"
                className="mt-1 block w-28 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={!url.trim()}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {editId ? "Save" : "Add"}
            </button>
            {editId ? (
              <button
                type="button"
                onClick={() => {
                  setEditId(null);
                  setUrl("");
                  setTitle("");
                  setSubject("");
                  setClasses("");
                }}
                className="px-2 py-1.5 text-xs font-semibold text-[var(--muted)]"
              >
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}

        {state.ebooks.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Nothing on the shelf yet. &ldquo;Load school bookcases&rdquo; adds
            the school&rsquo;s FlipHTML5 cases in one go; then name each one.
          </p>
        ) : (
          <DataTable
            columns={ebookCols}
            rows={state.ebooks}
            rowKey={(b) => b.id}
            rowActions={ebookActions}
            rowActionsLabel="E-book actions"
            minWidth="min-w-[720px]"
            emptyTitle="No e-books on the shelf yet"
          />
        )}
      </div>
    </div>
  );
}
