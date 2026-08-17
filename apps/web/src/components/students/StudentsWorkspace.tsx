"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { recordAudit } from "@/lib/auditClient";
import { recordSisDeletion } from "@/lib/sisNormalizedClient";
import {
  BUILT_IN_VIEWS,
  EMPTY_FILTERS,
  MISSING_FIELD_LABELS,
  countActiveFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
  isMissing,
  loadFilters,
  loadSavedViews,
  saveFilters,
  saveSavedViews,
  type MissingField,
  type SavedView,
  type StudentFilterState,
} from "@/lib/studentFilters";
import {
  STUDENT_TYPES,
  currentAcademicYearCode,
  loadMasters,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  BLOOD_GROUPS,
  PEN_STATUSES,
  STUDENT_CATEGORIES,
  checkStudentRemoval,
  countDocsWithFiles,
  householdOf,
  loadSis,
  pendingCurriculumRequests,
  profileCompleteness,
  removeStudent,
  saveSis,
  siblingsOf,
  studentTypeShort,
  type PenStatus,
  type SisState,
  type SisStudent,
  type StudentCategory,
  type StudentStatus,
} from "@/lib/sis";
import { RemoveControl } from "@/components/masters/RemoveControl";
import {
  StudentAvatar,
  StudentNameLabel,
} from "@/components/students/StudentAvatar";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { describeFilters } from "@/lib/reportExport";
import {
  STUDENT_REGISTER_EXPORT_COLUMNS,
  studentToRegisterExportRow,
} from "@/lib/studentRegisterExport";
import { TENANT } from "@/lib/types";
import { CurriculumOfficePanel } from "@/components/students/CurriculumOfficePanel";
import { LegacyAdmissionVerifyPanel } from "@/components/students/LegacyAdmissionVerifyPanel";
import { StudentImportPanel } from "@/components/students/StudentImportPanel";
import { StudentProfileModal } from "@/components/students/StudentProfileModal";
import { UdiseComplianceWorkspace } from "@/components/students/UdiseComplianceWorkspace";
import { StudentStatsDashboard } from "@/components/students/StudentStatsDashboard";
import { SisReportsPanel } from "@/components/students/SisReportsPanel";
import { StudentTagsPanel } from "@/components/students/StudentTagsPanel";
import { StudentSiblingsPanel } from "@/components/students/StudentSiblingsPanel";
import { StudentUpgradePanel } from "@/components/students/StudentUpgradePanel";
import { StudentPromotionPanel } from "@/components/students/StudentPromotionPanel";
import { StudentUpdatePanel } from "@/components/students/StudentUpdatePanel";
import { StudentDuplicatesPanel } from "@/components/students/StudentDuplicatesPanel";
import { DocVerificationQueuePanel } from "@/components/students/DocVerificationQueuePanel";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ErpTableShell } from "@/components/ui/erp-roster";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonModulePage } from "@/components/ui/skeleton";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { useDemoSession } from "@/components/shell/SessionContext";
import { listImportSessions, normalizeSessionCode } from "@/lib/studentImport";
import {
  classNeedsCartEnrollment,
  enrollmentStatusOf,
} from "@/lib/officeCurriculumWorkflow";

type ViewMode = "list" | "card";
type MainTab =
  | "dashboard"
  | "roster"
  | "register"
  | "reports"
  | "tags"
  | "siblings"
  | "upgrade"
  | "update"
  | "duplicates"
  | "udise"
  | "doc_verify";
const VIEW_KEY = "bhb_sis_view";
const TAB_KEY = "bhb_sis_main_tab";

export function StudentsWorkspace() {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [state, setState] = useState<SisState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  /** "" = follow header session; "all" = every year */
  const [sessionFilter, setSessionFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [rollSortMode, setRollSortMode] = useState<"name" | "admissionNo">(
    "name",
  );
  const [statusFilter, setStatusFilter] = useState<"all" | StudentStatus>(
    "active",
  );
  const [typeFilter, setTypeFilter] = useState<"" | FeeStudentType>("");
  const [genderFilter, setGenderFilter] = useState<"" | SisStudent["gender"]>(
    "",
  );
  const [categoryFilter, setCategoryFilter] = useState<"" | StudentCategory>(
    "",
  );
  const [feeGroupFilter, setFeeGroupFilter] = useState("");
  const [campusFilter, setCampusFilter] = useState("");
  const [penStatusFilter, setPenStatusFilter] = useState<"" | PenStatus>("");
  const [bloodFilter, setBloodFilter] = useState("");
  const [joinedFrom, setJoinedFrom] = useState("");
  const [joinedTo, setJoinedTo] = useState("");
  const [sortBy, setSortBy] = useState<"rollNo" | "name" | "admissionNo" | "joinedOn">("rollNo");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  /** all = every set filter must match; any = at least one set filter */
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  /** "Show only students missing X" — the completeness work list. */
  const [missingFilter, setMissingFilter] = useState<MissingField>("");
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  /**
   * Gate for the persist effect. Must be state, not a ref: a ref set
   * synchronously during restore lets the persist effect run in the same
   * commit with the still-empty defaults, which overwrites the URL before
   * the restored values land — silently discarding a shared filter link.
   * As state it batches with the restore, so persistence only begins on a
   * render where the filters are actually populated.
   */
  const [filtersReady, setFiltersReady] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [mainTab, setMainTab] = useState<MainTab>("dashboard");
  const [showCurriculumOffice, setShowCurriculumOffice] = useState(false);
  const [panelTick, setPanelTick] = useState(0);

  useEffect(() => {
    const m = loadMasters();
    const s = loadSis();
    setMasters(m);
    setState(s);
    setSelectedId(s.students[0]?.id ?? "");
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "list" || saved === "card") setView(saved);
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get("tab");
      const tab = urlTab || localStorage.getItem(TAB_KEY);
      if (
        tab === "dashboard" ||
        tab === "roster" ||
        tab === "register" ||
        tab === "reports" ||
        tab === "tags" ||
        tab === "siblings" ||
        tab === "upgrade" ||
        tab === "update" ||
        tab === "duplicates" ||
        tab === "udise" ||
        tab === "doc_verify"
      ) {
        setMainTab(tab);
        if (!urlTab && tab !== "dashboard") {
          try {
            const url = new URL(window.location.href);
            url.searchParams.set("tab", tab);
            window.history.replaceState({}, "", url.toString());
          } catch {
            /* ignore */
          }
        }
      }
      const q = params.get("q");
      if (q) {
        setQuery(q);
        if (!urlTab) setMainTab("register");
      }
    } catch {
      /* ignore */
    }

    void (async () => {
      const { ensureSisHydrated } = await import("@/lib/sisPersistence");
      const did = await ensureSisHydrated();
      if (did) setState(loadSis());
    })();
  }, []);

  /** Current filters as one object — for persistence, URL and saved views. */
  const currentFilters: StudentFilterState = {
    query,
    sessionFilter,
    classFilter,
    sectionFilter,
    statusFilter,
    typeFilter,
    genderFilter,
    categoryFilter,
    feeGroupFilter,
    campusFilter,
    penStatusFilter,
    bloodFilter,
    joinedFrom,
    joinedTo,
    missingFilter,
    matchMode,
    sortBy,
    sortOrder,
  };

  const applyFilters = useCallback((f: Partial<StudentFilterState>) => {
    if (f.query !== undefined) setQuery(f.query);
    if (f.sessionFilter !== undefined) setSessionFilter(f.sessionFilter);
    if (f.classFilter !== undefined) setClassFilter(f.classFilter);
    if (f.sectionFilter !== undefined) setSectionFilter(f.sectionFilter);
    if (f.statusFilter !== undefined) {
      setStatusFilter(f.statusFilter as "all" | StudentStatus);
    }
    if (f.typeFilter !== undefined) setTypeFilter(f.typeFilter as "" | FeeStudentType);
    if (f.genderFilter !== undefined) {
      setGenderFilter(f.genderFilter as "" | SisStudent["gender"]);
    }
    if (f.categoryFilter !== undefined) {
      setCategoryFilter(f.categoryFilter as "" | StudentCategory);
    }
    if (f.feeGroupFilter !== undefined) setFeeGroupFilter(f.feeGroupFilter);
    if (f.campusFilter !== undefined) setCampusFilter(f.campusFilter);
    if (f.penStatusFilter !== undefined) {
      setPenStatusFilter(f.penStatusFilter as "" | PenStatus);
    }
    if (f.bloodFilter !== undefined) setBloodFilter(f.bloodFilter);
    if (f.joinedFrom !== undefined) setJoinedFrom(f.joinedFrom);
    if (f.joinedTo !== undefined) setJoinedTo(f.joinedTo);
    if (f.missingFilter !== undefined) setMissingFilter(f.missingFilter);
    if (f.matchMode !== undefined) setMatchMode(f.matchMode);
    if (f.sortBy !== undefined) {
      setSortBy(f.sortBy as "rollNo" | "name" | "admissionNo" | "joinedOn");
    }
    if (f.sortOrder !== undefined) setSortOrder(f.sortOrder);
  }, []);

  // Restore filters on mount: an explicit URL wins (shared link), else the
  // last state this browser was left in. Without this, every filter reset
  // whenever a user opened a student and came back.
  useEffect(() => {
    try {
      const fromUrl = filtersFromSearchParams(
        new URLSearchParams(window.location.search),
      );
      applyFilters(
        Object.keys(fromUrl).length > 0 ? fromUrl : loadFilters(),
      );
      setSavedViews([...BUILT_IN_VIEWS, ...loadSavedViews()]);
    } catch {
      /* ignore */
    } finally {
      // Batched with the applyFilters setters above, so the persist effect
      // first runs on a render that already has the restored values.
      setFiltersReady(true);
    }
  }, [applyFilters]);

  // Persist + reflect in the URL. Guarded so the restore above isn't
  // immediately overwritten by an empty initial render.
  useEffect(() => {
    if (!filtersReady) return;
    saveFilters(currentFilters);
    try {
      const url = new URL(window.location.href);
      const next = filtersToSearchParams(currentFilters);
      const tab = url.searchParams.get("tab");
      url.search = next.toString();
      if (tab) url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filtersReady,
    query, sessionFilter, classFilter, sectionFilter, statusFilter,
    typeFilter, genderFilter, categoryFilter, feeGroupFilter, campusFilter,
    penStatusFilter, bloodFilter, joinedFrom, joinedTo, missingFilter,
    matchMode, sortBy, sortOrder,
  ]);

  const activeFilterCount = countActiveFilters(currentFilters);

  function resetFilters() {
    applyFilters(EMPTY_FILTERS);
  }

  function applySavedView(v: SavedView) {
    applyFilters(v.filters);
    setMainTabPersist("register");
  }

  function saveCurrentAsView() {
    const name = window.prompt("Name this view");
    if (!name?.trim()) return;
    const view: SavedView = {
      id: `view_${Date.now().toString(36)}`,
      name: name.trim().slice(0, 60),
      filters: currentFilters,
    };
    const next = [...savedViews, view];
    setSavedViews(next);
    saveSavedViews(next);
    setNotice(`Saved view “${view.name}”`);
    window.setTimeout(() => setNotice(null), 2500);
  }

  function deleteSavedView(id: string) {
    const next = savedViews.filter((v) => v.id !== id);
    setSavedViews(next);
    saveSavedViews(next);
  }

  function setViewMode(next: ViewMode) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  }

  function setMainTabPersist(next: MainTab) {
    setMainTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
      const url = new URL(window.location.href);
      if (next === "dashboard") {
        url.searchParams.delete("tab");
      } else {
        url.searchParams.set("tab", next);
      }
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  }

  function commit(next: SisState, msg?: string) {
    setState(next);
    saveSis(next);
    if (msg) {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2200);
    }
  }

  /**
   * Number one section at a time, in a single commit. There was no bulk or
   * auto path before this; office typed each roll number by hand, one
   * student at a time.
   *
   * Scoped to exactly one class AND one section deliberately: the button is
   * disabled unless both filters are set, so there is never a question of
   * which students "assign roll numbers" means. It touches only active
   * students in the current session filter, and only the rollNo field —
   * every other field on every other student is untouched, and this is one
   * commit(), not N raced writes.
   */
  function assignRollNumbers(sortBy: "name" | "admissionNo") {
    if (!state || !masters) return;
    if (!classFilter || !sectionFilter) return;
    const cls = masters.classes.find((c) => c.id === classFilter);
    const sec = masters.sections.find((s) => s.id === sectionFilter);
    const label = cls && sec ? `${cls.name}-${sec.name}` : "this section";

    const inSection = state.students.filter(
      (s) =>
        s.sectionId === sectionFilter &&
        s.status === "active" &&
        (!effectiveSession ||
          normalizeSessionCode(s.academicYearCode || "") ===
            normalizeSessionCode(effectiveSession)),
    );
    if (inSection.length === 0) return;

    const byLabel =
      sortBy === "admissionNo" ? "by admission number" : "alphabetically by name";
    const ok = window.confirm(
      `Assign roll numbers 1–${inSection.length} to every active student in ${label}, ${byLabel}?\n\nThis overwrites any roll numbers already set in this section.`,
    );
    if (!ok) return;

    const ordered = [...inSection].sort((a, b) =>
      sortBy === "admissionNo"
        ? a.admissionNo.localeCompare(b.admissionNo, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        : a.fullName.localeCompare(b.fullName),
    );
    const rollById = new Map(ordered.map((s, i) => [s.id, String(i + 1)]));
    const next: SisState = {
      ...state,
      students: state.students.map((s) =>
        rollById.has(s.id) ? { ...s, rollNo: rollById.get(s.id)! } : s,
      ),
    };
    commit(next, `Roll numbers assigned for ${label}`);
  }

  const sectionsForFilter = useMemo(() => {
    if (!masters || !classFilter) return [];
    return masters.sections
      .filter((s) => s.classId === classFilter && s.isActive)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [masters, classFilter]);

  const headerAy =
    session.academicYearCode ||
    (masters ? currentAcademicYearCode(masters) : "");

  const hasStudentsInHeaderAy = useMemo(() => {
    if (!state || !headerAy) return false;
    return state.students.some(
      (s) =>
        normalizeSessionCode(s.academicYearCode || "") ===
        normalizeSessionCode(headerAy),
    );
  }, [state, headerAy]);

  const effectiveSession =
    sessionFilter === "all"
      ? ""
      : sessionFilter
        ? sessionFilter
        : hasStudentsInHeaderAy
          ? headerAy
          : "";

  useEffect(() => {
    setProfileId("");
  }, [headerAy]);

  const sessionOptions = useMemo(() => {
    if (!masters) return [] as string[];
    const codes = new Set<string>(listImportSessions(masters));
    for (const s of state?.students ?? []) {
      if (s.academicYearCode) codes.add(s.academicYearCode);
    }
    return [...codes].sort((a, b) => b.localeCompare(a));
  }, [masters, state]);

  /**
   * Typing stays responsive; the 711-row filter catches up.
   *
   * The roster search had no debounce, so every keystroke re-ran the whole
   * filter — and the filter did per-student work that should have been done
   * once: householdOf() is a linear find over 193 households, called inside
   * the callback for each of 711 students, and matchesClass did the same
   * against 30 sections. That is ~137,000 comparisons and ~8,500 toLowerCase
   * allocations PER CHARACTER, which is why the field appeared to freeze and
   * then dump the letters at once.
   *
   * useDeferredValue lets React paint the keystroke first and run the filter
   * at lower priority, so the input never waits for the list.
   */
  const deferredQuery = useDeferredValue(query);

  /** Built once per state change, not once per student per keystroke. */
  const householdById = useMemo(() => {
    type Hh = NonNullable<typeof state>["households"][number];
    const m = new Map<string, Hh>();
    for (const h of state?.households ?? []) m.set(h.id, h);
    return m;
  }, [state]);

  const sectionById = useMemo(() => {
    const m = new Map<string, { id: string; classId: string }>();
    for (const x of masters?.sections ?? []) m.set(x.id, x);
    return m;
  }, [masters]);

  const filtered = useMemo(() => {
    if (!state || !masters) return [];

    // Hoisted: this was recomputed inside the callback for every student.
    const q = deferredQuery.trim().toLowerCase();

    const inSession = (s: SisStudent) =>
      !effectiveSession ||
      normalizeSessionCode(s.academicYearCode || "") ===
        normalizeSessionCode(effectiveSession);

    const matchesSearch = (s: SisStudent) => {
      if (!q) return true;
      const hh = householdById.get(s.householdId);
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.admissionNo.toLowerCase().includes(q) ||
        s.fatherName.toLowerCase().includes(q) ||
        s.motherName.toLowerCase().includes(q) ||
        s.rollNo.toLowerCase().includes(q) ||
        s.pen.toLowerCase().includes(q) ||
        s.apaarId.toLowerCase().includes(q) ||
        s.srn.toLowerCase().includes(q) ||
        s.aadhaarLast4.includes(q) ||
        (hh?.guardianName ?? "").toLowerCase().includes(q) ||
        (hh?.mobile ?? "").includes(q) ||
        (hh?.whatsappMobile ?? "").includes(q) ||
        (hh?.email ?? "").toLowerCase().includes(q) ||
        (hh?.locality ?? "").toLowerCase().includes(q) ||
        (hh?.pincode ?? "").includes(q)
      );
    };

    const matchesClass = (s: SisStudent) => {
      if (!classFilter) return true;
      if (s.classId === classFilter) return true;
      const sec = sectionById.get(s.sectionId);
      return sec?.classId === classFilter;
    };

    const matchesAdmissionRange = (s: SisStudent) => {
      if (!joinedFrom && !joinedTo) return true;
      if (!s.joinedOn) return false;
      if (joinedFrom && s.joinedOn < joinedFrom) return false;
      if (joinedTo && s.joinedOn > joinedTo) return false;
      return true;
    };

    /** Only filters the user actually set (empty = ignored). */
    type Pred = (s: SisStudent) => boolean;
    const predicates: Pred[] = [];
    if (statusFilter !== "all") {
      predicates.push((s) => s.status === statusFilter);
    }
    if (classFilter) predicates.push(matchesClass);
    if (sectionFilter) {
      predicates.push((s) => s.sectionId === sectionFilter);
    }
    if (typeFilter) {
      predicates.push((s) => s.studentType === typeFilter);
    }
    if (genderFilter) {
      predicates.push((s) => s.gender === genderFilter);
    }
    if (categoryFilter) {
      predicates.push((s) => s.category === categoryFilter);
    }
    if (feeGroupFilter) {
      predicates.push((s) => s.feeGroupId === feeGroupFilter);
    }
    if (campusFilter) {
      predicates.push((s) => s.campusId === campusFilter);
    }
    if (penStatusFilter) {
      predicates.push((s) => s.penStatus === penStatusFilter);
    }
    if (bloodFilter) {
      predicates.push((s) => s.bloodGroup === bloodFilter);
    }
    if (joinedFrom || joinedTo) {
      predicates.push(matchesAdmissionRange);
    }
    if (missingFilter) {
      predicates.push((s) => isMissing(s, missingFilter));
    }
    if (query.trim()) predicates.push(matchesSearch);

    const list = state.students.filter((s) => {
      if (!inSession(s)) return false;
      if (predicates.length === 0) return true;
      if (matchMode === "any") {
        return predicates.some((p) => p(s));
      }
      return predicates.every((p) => p(s));
    });

    return list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "rollNo") {
        const ra = Number(a.rollNo);
        const rb = Number(b.rollNo);
        if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) {
          cmp = ra - rb;
        } else {
          cmp = (a.rollNo || "").localeCompare(b.rollNo || "");
        }
      } else if (sortBy === "name") {
        cmp = a.fullName.localeCompare(b.fullName);
      } else if (sortBy === "admissionNo") {
        cmp = a.admissionNo.localeCompare(b.admissionNo);
      } else if (sortBy === "joinedOn") {
        cmp = (a.joinedOn || "").localeCompare(b.joinedOn || "");
      }
      if (cmp === 0) {
        cmp = a.fullName.localeCompare(b.fullName);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [
    state,
    masters,
    effectiveSession,
    statusFilter,
    classFilter,
    sectionFilter,
    typeFilter,
    genderFilter,
    categoryFilter,
    feeGroupFilter,
    campusFilter,
    penStatusFilter,
    bloodFilter,
    joinedFrom,
    joinedTo,
    missingFilter,
    query,
    matchMode,
    sortBy,
    sortOrder,
  ]);

  function clearFilters() {
    setQuery("");
    setSessionFilter("");
    setClassFilter("");
    setSectionFilter("");
    setStatusFilter("active");
    setTypeFilter("");
    setGenderFilter("");
    setCategoryFilter("");
    setFeeGroupFilter("");
    setCampusFilter("");
    setPenStatusFilter("");
    setBloodFilter("");
    setJoinedFrom("");
    setJoinedTo("");
  }

  const hasExtraFilters =
    !!sessionFilter ||
    !!typeFilter ||
    !!genderFilter ||
    !!categoryFilter ||
    !!feeGroupFilter ||
    !!campusFilter ||
    !!penStatusFilter ||
    !!bloodFilter ||
    !!joinedFrom ||
    !!joinedTo ||
    !!query.trim() ||
    !!classFilter ||
    !!sectionFilter ||
    statusFilter !== "active";

  useEffect(() => {
    if (!classFilter) {
      setSectionFilter("");
      return;
    }
    if (
      sectionFilter &&
      !sectionsForFilter.some((s) => s.id === sectionFilter)
    ) {
      setSectionFilter("");
    }
  }, [classFilter, sectionFilter, sectionsForFilter]);

  useEffect(() => {
    if (!filtered.length) {
      if (selectedId) setSelectedId("");
      return;
    }
    if (filtered.some((s) => s.id === selectedId)) return;
    // Keep focus if student exists (e.g. sibling in another class) so household panel stays open
    if (state?.students.some((s) => s.id === selectedId)) return;
    setSelectedId(filtered[0]!.id);
  }, [filtered, selectedId, state]);

  const exportRows = useMemo(() => {
    if (!masters || !state) return [];
    return filtered.map((s) => studentToRegisterExportRow(s, state, masters));
  }, [filtered, masters, state]);

  const exportFilterNote = useMemo(() => {
    if (!masters) return describeFilters([]);
    const cls = masters.classes.find((c) => c.id === classFilter)?.name;
    const sec = masters.sections.find((s) => s.id === sectionFilter)?.name;
    const fg = masters.feeGroups.find((g) => g.id === feeGroupFilter)?.code;
    const cam = masters.campuses.find((c) => c.id === campusFilter)?.name;
    return describeFilters([
      effectiveSession
        ? `Session ${effectiveSession}`
        : "All sessions",
      cls ? `Class ${cls}` : "",
      sec ? `Sec ${sec}` : "",
      statusFilter !== "all" ? statusFilter : "",
      typeFilter
        ? STUDENT_TYPES.find((t) => t.value === typeFilter)?.label
        : "",
      genderFilter === "M"
        ? "Male"
        : genderFilter === "F"
          ? "Female"
          : genderFilter === "O"
            ? "Other"
            : "",
      categoryFilter || "",
      fg ? `Fee ${fg}` : "",
      cam ? `Campus ${cam}` : "",
      penStatusFilter
        ? PEN_STATUSES.find((p) => p.value === penStatusFilter)?.label
        : "",
      bloodFilter ? `Blood ${bloodFilter}` : "",
      joinedFrom || joinedTo
        ? `Admission ${joinedFrom || "…"} → ${joinedTo || "…"}`
        : "",
      matchMode === "any" ? "Match any filter" : "Match all filters",
      query.trim() ? `Search “${query.trim()}”` : "",
    ]);
  }, [
    masters,
    effectiveSession,
    classFilter,
    sectionFilter,
    statusFilter,
    typeFilter,
    genderFilter,
    categoryFilter,
    feeGroupFilter,
    campusFilter,
    penStatusFilter,
    bloodFilter,
    joinedFrom,
    joinedTo,
    matchMode,
    query,
  ]);

  const selected = useMemo(() => {
    if (!state || !selectedId) return undefined;
    return state.students.find((s) => s.id === selectedId);
  }, [state, selectedId]);

  const householdPanel = useMemo(() => {
    if (!selected || !state) return [];
    const sibs = siblingsOf(state, selected)
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return [selected, ...sibs];
  }, [selected, state]);

  const householdIdSet = useMemo(
    () => new Set(householdPanel.map((s) => s.id)),
    [householdPanel],
  );

  if (!state || !masters) {
    return <SkeletonModulePage />;
  }

  const m = masters;
  const sis = state;
  const inSessionScope = (s: SisStudent) =>
    !effectiveSession ||
    normalizeSessionCode(s.academicYearCode || "") ===
      normalizeSessionCode(effectiveSession);
  const activeCount = sis.students.filter(
    (s) => s.status === "active" && inSessionScope(s),
  ).length;
  const inactiveCount = sis.students.filter(
    (s) => s.status === "inactive" && inSessionScope(s),
  ).length;

  function classSectionOf(s: SisStudent) {
    return `${classNameOf(s.classId)}-${sectionNameOf(s.sectionId)}`;
  }

  function openHousehold(studentId: string) {
    setSelectedId(studentId);
  }

  function openProfile(studentId: string) {
    setSelectedId(studentId);
    setProfileId(studentId);
  }

  function classNameOf(id: string) {
    return m.classes.find((c) => c.id === id)?.name ?? "—";
  }
  function sectionNameOf(id: string) {
    return m.sections.find((s) => s.id === id)?.name ?? "—";
  }
  function feeGroupName(id: string | null) {
    if (!id) return "—";
    return m.feeGroups.find((g) => g.id === id)?.name ?? "—";
  }

  function toggleStatus(s: SisStudent) {
    commit(
      {
        ...sis,
        students: sis.students.map((x) =>
          x.id === s.id
            ? {
                ...x,
                status: x.status === "active" ? "inactive" : "active",
              }
            : x,
        ),
      },
      s.status === "active" ? "Student inactivated" : "Student activated",
    );
    recordAudit({
      module: "students",
      action: "status_change",
      entityType: "student",
      entityId: s.id,
      summary: `${s.status === "active" ? "Inactivated" : "Activated"} ${s.fullName} (${s.admissionNo})`,
      before: { status: s.status },
      after: { status: s.status === "active" ? "inactive" : "active" },
    });
  }

  function onRemove(s: SisStudent) {
    const result = removeStudent(sis, s.id);
    if (!result.ok) {
      commit(sis, result.reason);
      return;
    }
    const nextId =
      result.state.students.find((x) => x.id === selectedId)?.id ??
      result.state.students[0]?.id ??
      "";
    setSelectedId(nextId);

    // State the deletion before committing. removeStudent only filters the
    // local roster, and the push upserts — so without this the row is never
    // deleted in the database and the student returns on the next hydrate.
    // removeStudent also drops the household when its last student goes, so
    // take that from the diff rather than assuming.
    const removedHouseholdIds = sis.households
      .filter((h) => !result.state.households.some((x) => x.id === h.id))
      .map((h) => h.id);
    recordSisDeletion({
      studentIds: [s.id],
      householdIds: removedHouseholdIds,
    });

    commit(result.state, "Student removed");
    // Hard delete with no soft-delete or restore — the audit entry is the
    // only remaining record that this student ever existed.
    recordAudit({
      module: "students",
      action: "delete",
      entityType: "student",
      entityId: s.id,
      summary: `Removed ${s.fullName} (${s.admissionNo}) from ${s.academicYearCode}`,
      before: {
        fullName: s.fullName,
        admissionNo: s.admissionNo,
        academicYearCode: s.academicYearCode,
        classId: s.classId,
        sectionId: s.sectionId,
        status: s.status,
        householdId: s.householdId,
      },
    });
  }

  const anyFilterActive = Boolean(classFilter || sectionFilter || hasExtraFilters);

  const emptyMsg =
    classFilter || sectionFilter
      ? `No students in ${[
          m.classes.find((c) => c.id === classFilter)?.name,
          sectionFilter
            ? m.sections.find((s) => s.id === sectionFilter)?.name
            : null,
        ]
          .filter(Boolean)
          .join("-") || "this selection"} yet.`
      : "No students match filters";

  const emptyStateAction = anyFilterActive ? (
    <button
      type="button"
      onClick={clearFilters}
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
    >
      Clear filters
    </button>
  ) : (
    <Link
      href="/students/new"
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
    >
      Add student
    </Link>
  );

  return (
    <ErpWorkspaceShell
      title="Students"
      subtitle={
        <>
          SIS roster · {effectiveSession || "All sessions"} · {activeCount}{" "}
          active
          {inactiveCount ? ` · ${inactiveCount} inactive` : ""}
        </>
      }
      icon={<GraduationCap className="size-6" aria-hidden />}
      notice={notice}
      actions={
        <>
          {mainTab === "register" ? (
            <div
              className="flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5"
              role="group"
              aria-label="View mode"
            >
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  view === "list"
                    ? "bg-[var(--brand-deep)] text-white"
                    : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
                }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("card")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  view === "card"
                    ? "bg-[var(--brand-deep)] text-white"
                    : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
                }`}
              >
                Cards
              </button>
            </div>
          ) : null}
          <Link
            href="/students/new"
            className="btn-accent rounded-xl px-4 py-2.5 text-sm font-semibold"
          >
            + Add student
          </Link>
        </>
      }
    >
      <ModuleTabs
        aria-label="Students sections"
        value={mainTab}
        onChange={(id) => setMainTabPersist(id as MainTab)}
        items={[
          { id: "dashboard", label: "Dashboard", tone: "navy" },
          { id: "roster", label: "Overview", tone: "navy" },
          { id: "register", label: "Register", tone: "navy" },
          { id: "update", label: "Update", tone: "sky" },
          { id: "duplicates", label: "Duplicates", tone: "coral" },
          { id: "udise", label: "UDISE+", tone: "coral" },
          { id: "doc_verify", label: "Doc verify", tone: "amber" },
          { id: "siblings", label: "Siblings", tone: "violet" },
          { id: "upgrade", label: "Upgrade", tone: "amber" },
          { id: "reports", label: "Reports", tone: "green" },
          { id: "tags", label: "Tags", tone: "slate" },
        ]}
      />

      {mainTab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="students"
          refreshKey={panelTick}
          onNavigateTab={(t) => setMainTabPersist(t as MainTab)}
        />
      ) : null}

      {mainTab === "doc_verify" ? (
        <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(246,245,239,0.6)] p-4">
          <DocVerificationQueuePanel
            mode="student"
            onChanged={() => {
              setState(loadSis());
              setPanelTick((t) => t + 1);
            }}
          />
        </div>
      ) : null}

      {mainTab === "udise" ? (
        <UdiseComplianceWorkspace
          tick={panelTick}
          onChanged={(next, message) => {
            setState(next);
            setPanelTick((t) => t + 1);
            if (message) {
              setNotice(message);
              window.setTimeout(() => setNotice(null), 2800);
            }
          }}
        />
      ) : null}

      {mainTab === "reports" ? (
        <SisReportsPanel
          tick={panelTick}
          onNotice={(msg) => {
            setNotice(msg);
            window.setTimeout(() => setNotice(null), 2800);
          }}
        />
      ) : null}

      {mainTab === "tags" ? (
        <StudentTagsPanel
          tick={panelTick}
          onChanged={() => {
            setState(loadSis());
            setPanelTick((t) => t + 1);
          }}
        />
      ) : null}

      {mainTab === "siblings" ? (
        <StudentSiblingsPanel
          tick={panelTick}
          onChanged={(next) => {
            setState(next);
            setPanelTick((t) => t + 1);
          }}
        />
      ) : null}

      {mainTab === "upgrade" ? (
        <div className="space-y-6">
          <StudentUpgradePanel
            tick={panelTick}
            onChanged={(next) => {
              setState(next);
              setPanelTick((t) => t + 1);
            }}
          />
          <hr className="border-[rgba(32,48,80,0.1)]" />
          <StudentPromotionPanel
            tick={panelTick}
            onChanged={(next) => {
              setState(next);
              setPanelTick((t) => t + 1);
            }}
          />
        </div>
      ) : null}

      {mainTab === "update" ? (
        <StudentUpdatePanel
          tick={panelTick}
          onChanged={(next) => {
            setState(next);
            setPanelTick((t) => t + 1);
          }}
        />
      ) : null}

      {mainTab === "duplicates" ? (
        <StudentDuplicatesPanel
          tick={panelTick}
          onChanged={(next, message) => {
            setState(next);
            setPanelTick((t) => t + 1);
            if (message) {
              setNotice(message);
              window.setTimeout(() => setNotice(null), 2800);
            }
          }}
        />
      ) : null}

      {mainTab === "roster" ? (
        <>
      <StudentStatsDashboard sis={sis} masters={m} />

      <div className="mt-4 space-y-3">
        <LegacyAdmissionVerifyPanel
          tick={panelTick}
          onChanged={(next, message) => commit(next, message)}
        />
        <StudentImportPanel
          masters={m}
          sis={sis}
          onApplied={(next, message) => commit(next, message)}
        />
      </div>
        </>
      ) : null}

      {mainTab === "register" ? (
        <>
      <div className="mt-5 space-y-2">
        {/* Saved views — one click to the work lists staff actually need,
            including the completeness gaps the filters could not express. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Views
          </span>
          {savedViews.map((v) => (
            <span key={v.id} className="inline-flex items-center">
              <button
                type="button"
                onClick={() => applySavedView(v)}
                className={`rounded-l-lg border border-[rgba(32,48,80,0.14)] px-2.5 py-1 text-[11px] font-medium hover:bg-[var(--surface-sunken)] ${
                  v.builtIn ? "bg-[var(--card)]" : "bg-[rgba(197,160,40,0.12)]"
                } ${v.builtIn ? "rounded-r-lg" : ""}`}
                title={v.builtIn ? "Built-in view" : "Saved view"}
              >
                {v.name}
              </button>
              {!v.builtIn ? (
                <button
                  type="button"
                  onClick={() => deleteSavedView(v.id)}
                  aria-label={`Delete saved view ${v.name}`}
                  className="rounded-r-lg border border-l-0 border-[rgba(32,48,80,0.14)] bg-[rgba(197,160,40,0.12)] px-1.5 py-1 text-[11px] text-[var(--muted)] hover:text-[#c0392b]"
                >
                  ✕
                </button>
              ) : null}
            </span>
          ))}
          <button
            type="button"
            onClick={saveCurrentAsView}
            disabled={activeFilterCount === 0}
            className="rounded-lg border border-dashed border-[rgba(32,48,80,0.28)] px-2.5 py-1 text-[11px] font-medium text-[var(--brand-mid)] disabled:opacity-40"
            title={
              activeFilterCount === 0
                ? "Set some filters first"
                : "Save the current filters as a view"
            }
          >
            + Save current
          </button>
          {activeFilterCount > 0 ? (
            <span className="ml-auto flex items-center gap-2">
              <span
                className="rounded-full bg-[rgba(32,48,80,0.08)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-deep)]"
                aria-live="polite"
              >
                {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
              </span>
              <button
                type="button"
                onClick={resetFilters}
                className="text-[11px] font-semibold text-[var(--brand-mid)] underline"
              >
                Clear all
              </button>
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5"
            role="group"
            aria-label="Filter match mode"
          >
            <button
              type="button"
              onClick={() => setMatchMode("all")}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${
                matchMode === "all"
                  ? "bg-[var(--brand-deep)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
              }`}
            >
              Match all
            </button>
            <button
              type="button"
              onClick={() => setMatchMode("any")}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${
                matchMode === "any"
                  ? "bg-[var(--brand-deep)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
              }`}
            >
              Match any
            </button>
          </div>
          <span className="text-[11px] text-[var(--muted)]">
            {matchMode === "all"
              ? "Student must satisfy every selected filter."
              : "Student needs only one selected filter to match."}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            className="field min-w-[12rem] flex-1"
            placeholder="Search name, adm no, roll, parent, PEN, APAAR, mobile, locality…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search students"
          />
          <select
            className="field max-w-[11rem]"
            value={sessionFilter || ""}
            onChange={(e) => setSessionFilter(e.target.value)}
            aria-label="Filter by session"
            title="Roster is per academic year — change header Session or pick here"
          >
            <option value="">
              Session {headerAy || "—"} (header)
            </option>
            {sessionOptions
              .filter((c) => c !== headerAy)
              .map((c) => (
                <option key={c} value={c}>
                  {c} only
                </option>
              ))}
            <option value="all">All sessions</option>
          </select>
          <select
            className="field max-w-[10rem]"
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value);
              setSectionFilter("");
            }}
            aria-label="Filter by class"
          >
            <option value="">All classes</option>
            {m.classes
              .filter((c) => c.isActive)
              .map((c) => {
                const n = sis.students.filter(
                  (s) =>
                    (!effectiveSession ||
                      normalizeSessionCode(s.academicYearCode || "") ===
                        normalizeSessionCode(effectiveSession)) &&
                    (statusFilter === "all" || s.status === statusFilter) &&
                    (s.classId === c.id ||
                      m.sections.find((sec) => sec.id === s.sectionId)
                        ?.classId === c.id),
                ).length;
                return (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {n ? ` (${n})` : ""}
                  </option>
                );
              })}
          </select>
          <select
            className="field max-w-[9rem]"
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            disabled={!classFilter}
            aria-label="Filter by section"
            title={
              classFilter
                ? "Filter by section"
                : "Choose a class first to list sections"
            }
          >
            <option value="">
              {classFilter ? "All sections" : "Section (pick class)"}
            </option>
            {sectionsForFilter.map((s) => {
              const n = sis.students.filter(
                (stu) =>
                  stu.sectionId === s.id &&
                  (!effectiveSession ||
                    normalizeSessionCode(stu.academicYearCode || "") ===
                      normalizeSessionCode(effectiveSession)) &&
                  (statusFilter === "all" || stu.status === statusFilter),
              ).length;
              return (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {n ? ` (${n})` : ""}
                </option>
              );
            })}
          </select>
          <select
            className="field max-w-[9rem] text-xs disabled:opacity-40"
            value={rollSortMode}
            onChange={(e) =>
              setRollSortMode(e.target.value as "name" | "admissionNo")
            }
            disabled={!classFilter || !sectionFilter}
            aria-label="Roll number order"
            title="Order to assign roll numbers in"
          >
            <option value="name">By name (A–Z)</option>
            <option value="admissionNo">By admission no.</option>
          </select>
          <button
            type="button"
            className="field max-w-[11rem] text-xs font-semibold text-[var(--brand-mid)] disabled:opacity-40"
            onClick={() => assignRollNumbers(rollSortMode)}
            disabled={!classFilter || !sectionFilter}
            title={
              classFilter && sectionFilter
                ? "Assign roll numbers 1..N in the order picked on the left"
                : "Pick a class and section first"
            }
          >
            Assign roll numbers
          </button>
          <select
            className="field max-w-[9rem]"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | StudentStatus)
            }
            aria-label="Filter by status"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All status</option>
          </select>
          <div className="flex items-center gap-1">
            <select
              className="field max-w-[9.5rem]"
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as "rollNo" | "name" | "admissionNo" | "joinedOn",
                )
              }
              aria-label="Sort student list"
              title="Sort student list"
            >
              <option value="rollNo">Sort: Roll No</option>
              <option value="name">Sort: Name</option>
              <option value="admissionNo">Sort: Adm No</option>
              <option value="joinedOn">Sort: Joined Date</option>
            </select>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-2 text-xs font-bold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
              onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
              title={`Sorting ${sortOrder === "asc" ? "Ascending (A-Z / 1-9)" : "Descending (Z-A / 9-1)"}`}
            >
              {sortOrder === "asc" ? "↑ Asc" : "↓ Desc"}
            </button>
          </div>
          <FilterExportButtons
            title="Student register (full form)"
            subtitle={`${TENANT.shortName} · ${headerAy}`}
            filterNote={exportFilterNote}
            fileBaseName="students_full_register"
            columns={STUDENT_REGISTER_EXPORT_COLUMNS}
            rows={exportRows}
            onMessage={(msg) => {
              setNotice(msg);
              window.setTimeout(() => setNotice(null), 2200);
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="field max-w-[11rem]"
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as "" | FeeStudentType)
            }
            aria-label="Student type"
          >
            <option value="">All types</option>
            {STUDENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            className="field max-w-[8rem]"
            value={genderFilter}
            onChange={(e) =>
              setGenderFilter(e.target.value as "" | SisStudent["gender"])
            }
            aria-label="Gender"
          >
            <option value="">All genders</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
            <option value="O">Other</option>
          </select>
          <select
            className="field max-w-[8rem]"
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as "" | StudentCategory)
            }
            aria-label="Category"
          >
            <option value="">All categories</option>
            {STUDENT_CATEGORIES.filter((c) => c.value).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className="field max-w-[12rem]"
            value={feeGroupFilter}
            onChange={(e) => setFeeGroupFilter(e.target.value)}
            aria-label="Fee group"
          >
            <option value="">All fee groups</option>
            {m.feeGroups
              .filter((g) => g.isActive)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} · {g.studentType}
                </option>
              ))}
          </select>
          <select
            className="field max-w-[10rem]"
            value={campusFilter}
            onChange={(e) => setCampusFilter(e.target.value)}
            aria-label="Campus"
          >
            <option value="">All campuses</option>
            {m.campuses
              .filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <select
            className="field max-w-[11rem]"
            value={penStatusFilter}
            onChange={(e) =>
              setPenStatusFilter(e.target.value as "" | PenStatus)
            }
            aria-label="PEN status"
          >
            <option value="">All PEN status</option>
            {PEN_STATUSES.filter((p) => p.value).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            className="field max-w-[8rem]"
            value={bloodFilter}
            onChange={(e) => setBloodFilter(e.target.value)}
            aria-label="Blood group"
          >
            <option value="">All blood</option>
            {BLOOD_GROUPS.filter(Boolean).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {/* "Missing X" — the completeness work list. Every other filter
              matches a value; this one matches its absence. */}
          <select
            className="field max-w-[13rem]"
            value={missingFilter}
            onChange={(e) => setMissingFilter(e.target.value as MissingField)}
            aria-label="Show only students missing a field"
            title="Show only students where this field is blank"
          >
            <option value="">Completeness: any</option>
            {(
              Object.keys(MISSING_FIELD_LABELS) as (keyof typeof MISSING_FIELD_LABELS)[]
            ).map((k) => (
              <option key={k} value={k}>
                {MISSING_FIELD_LABELS[k]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <span className="whitespace-nowrap">Admission from</span>
            <input
              type="date"
              className="field !max-w-[10rem] !py-1.5"
              value={joinedFrom}
              onChange={(e) => setJoinedFrom(e.target.value)}
              aria-label="Admission date from"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <span className="whitespace-nowrap">to</span>
            <input
              type="date"
              className="field !max-w-[10rem] !py-1.5"
              value={joinedTo}
              min={joinedFrom || undefined}
              onChange={(e) => setJoinedTo(e.target.value)}
              aria-label="Admission date to"
            />
          </label>
          {hasExtraFilters ? (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[11px] font-semibold text-[var(--muted)]"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Showing <strong className="text-[var(--brand-deep)]">{filtered.length}</strong>{" "}
          student{filtered.length === 1 ? "" : "s"} (full list — no row limit).
          PDF / Excel exports the same full filtered set.
        </p>
        {classFilter &&
        classNeedsCartEnrollment(classFilter, m) ? (
          <div className="mt-2">
            <button
              type="button"
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                showCurriculumOffice
                  ? "bg-[#0f766e] text-white"
                  : "border border-[#0f766e] bg-[var(--card)] text-[#0f766e]"
              }`}
              onClick={() => setShowCurriculumOffice((v) => !v)}
            >
              {showCurriculumOffice
                ? "Hide curriculum office"
                : "Curriculum office · bulk enroll"}
            </button>
          </div>
        ) : null}
      </div>

      {showCurriculumOffice && classFilter ? (
        <div className="mt-4">
          <CurriculumOfficePanel
            masters={m}
            sis={sis}
            classId={classFilter}
            sectionId={sectionFilter}
            students={filtered.filter((s) => s.status === "active")}
            onApplied={(next, msg) => {
              commit(next, msg);
            }}
          />
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <div className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
            Register · {filtered.length} (all matches)
          </div>

          {view === "list" ? (
            <ErpTableShell>
              <ul className="max-h-[620px] divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto">
                {filtered.map((s) => {
                  const on = householdIdSet.has(s.id);
                  const focused = s.id === selectedId;
                  const hh = householdOf(sis, s.householdId);
                  const sibs = siblingsOf(sis, s);
                  return (
                    <li
                      key={s.id}
                      className={`flex items-start gap-2 px-4 py-3 ${
                        focused
                          ? "bg-[rgba(197,160,40,0.14)]"
                          : on
                            ? "bg-[rgba(32,48,80,0.05)]"
                            : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => openProfile(s.id)}
                          className="flex w-full items-start gap-3 text-left"
                        >
                          <StudentAvatar student={s} size={42} />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-[var(--brand-deep)]">
                              <StudentNameLabel student={s} sis={sis}>
                              {s.status !== "active" ? (
                                <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                                  inactive
                                </span>
                              ) : null}
                              </StudentNameLabel>
                              {state &&
                              pendingCurriculumRequests(state, s.id).length >
                                0 ? (
                                <span className="ml-2 rounded bg-[rgba(196,149,58,0.2)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--brand-gold)]">
                                  Subjects pending
                                </span>
                              ) : classNeedsCartEnrollment(s.classId, m) ? (
                                <span
                                  className={`ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                    enrollmentStatusOf(s) === "confirmed"
                                      ? "bg-[rgba(15,118,110,0.12)] text-[#0f766e]"
                                      : enrollmentStatusOf(s) === "draft"
                                        ? "bg-[rgba(196,149,58,0.15)] text-[var(--brand-gold)]"
                                        : "bg-[rgba(32,48,80,0.08)] text-[var(--muted)]"
                                  }`}
                                >
                                  {enrollmentStatusOf(s) === "confirmed"
                                    ? "Cart OK"
                                    : enrollmentStatusOf(s) === "draft"
                                      ? "Cart draft"
                                      : "No cart"}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--muted)]">
                              {s.admissionNo} · {classSectionOf(s)}
                              {s.rollNo ? ` · Roll ${s.rollNo}` : ""}
                            </div>
                            <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                              {hh?.guardianName ?? "—"}
                              {hh?.mobile ? ` · ${hh.mobile}` : ""}
                            </div>
                          </div>
                        </button>
                        {sibs.length > 0 ? (
                          <div className="mt-2 pl-[54px]">
                            <SiblingLinks
                              siblings={sibs}
                              classSectionOf={classSectionOf}
                              onOpen={openHousehold}
                            />
                          </div>
                        ) : null}
                      </div>
                      <RowActions
                        student={s}
                        onToggle={() => toggleStatus(s)}
                        onRemove={() => onRemove(s)}
                      />
                    </li>
                  );
                })}
                {filtered.length === 0 ? (
                  <li>
                    <EmptyState
                      icon={GraduationCap}
                      title={emptyMsg}
                      variant="table"
                      action={emptyStateAction}
                    />
                  </li>
                ) : null}
              </ul>
            </ErpTableShell>
          ) : (
            <div className="grid max-h-[620px] gap-3 overflow-y-auto sm:grid-cols-2">
              {filtered.map((s) => {
                const on = householdIdSet.has(s.id);
                const focused = s.id === selectedId;
                const hh = householdOf(sis, s.householdId);
                const sibs = siblingsOf(sis, s);
                return (
                  <div
                    key={s.id}
                    className={`rounded-xl border bg-[var(--card)] p-4 transition ${
                      focused
                        ? "border-[rgba(197,160,40,0.55)] shadow-[0_0_0_1px_rgba(197,160,40,0.12)]"
                        : on
                          ? "border-[rgba(32,48,80,0.22)]"
                          : "border-[rgba(32,48,80,0.12)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openProfile(s.id)}
                      className="flex w-full flex-col items-center text-center"
                    >
                      <StudentAvatar student={s} size={72} />
                      <div className="mt-3 font-medium text-[var(--brand-deep)]">
                        <StudentNameLabel student={s} sis={sis} />
                      </div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        {s.admissionNo}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--muted)]">
                        {classSectionOf(s)}
                        {s.rollNo ? ` · Roll ${s.rollNo}` : ""}
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--muted)]">
                        {hh?.mobile ?? "—"}
                        {s.status !== "active" ? " · inactive" : ""}
                      </div>
                    </button>
                    {sibs.length > 0 ? (
                      <div className="mt-2 border-t border-[rgba(32,48,80,0.08)] pt-2">
                        <SiblingLinks
                          siblings={sibs}
                          classSectionOf={classSectionOf}
                          onOpen={openHousehold}
                          align="center"
                        />
                      </div>
                    ) : null}
                    <div className="mt-3 flex items-center justify-center gap-3 border-t border-[rgba(32,48,80,0.08)] pt-3">
                      <Link
                        href={`/students/${s.id}/edit`}
                        className="text-xs font-medium text-[var(--brand-mid)]"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--brand-mid)]"
                        onClick={() => toggleStatus(s)}
                      >
                        {s.status === "active" ? "Inactivate" : "Activate"}
                      </button>
                      <RemoveControl
                        check={checkStudentRemoval(s)}
                        onRemove={() => onRemove(s)}
                      />
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 ? (
                <div className="col-span-full">
                  <EmptyState
                    icon={GraduationCap}
                    title={emptyMsg}
                    action={emptyStateAction}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div>
          {householdPanel.length > 0 ? (
            <div className="space-y-3">
              {householdPanel.length > 1 ? (
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Household · {householdPanel.length} students
                </div>
              ) : null}
              {householdPanel.map((s) => (
                <StudentDetail
                  key={s.id}
                  student={s}
                  state={sis}
                  classLabel={classSectionOf(s)}
                  feeGroupLabel={feeGroupName(s.feeGroupId)}
                  highlight={s.id === selectedId}
                  onOpenSibling={openHousehold}
                  classSectionOf={classSectionOf}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
              Select a student to see the snapshot
            </div>
          )}
        </div>
      </div>
        </>
      ) : null}

      {profileId
        ? (() => {
            const ps = sis.students.find((s) => s.id === profileId);
            if (!ps) return null;
            return (
              <StudentProfileModal
                student={ps}
                sis={sis}
                masters={m}
                classLabel={classSectionOf(ps)}
                feeGroupLabel={feeGroupName(ps.feeGroupId)}
                onClose={() => setProfileId("")}
                onOpenStudent={(id) => setProfileId(id)}
              />
            );
          })()
        : null}
    </ErpWorkspaceShell>
  );
}

function RowActions({
  student,
  onToggle,
  onRemove,
}: {
  student: SisStudent;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Link
        href={`/students/${student.id}/edit`}
        className="text-xs font-medium text-[var(--brand-mid)]"
      >
        Edit
      </Link>
      <button
        type="button"
        className="text-xs font-medium text-[var(--brand-mid)]"
        onClick={onToggle}
      >
        {student.status === "active" ? "Inactivate" : "Activate"}
      </button>
      <RemoveControl
        check={checkStudentRemoval(student)}
        onRemove={onRemove}
      />
    </div>
  );
}

function SiblingLinks({
  siblings,
  classSectionOf,
  onOpen,
  align = "start",
}: {
  siblings: SisStudent[];
  classSectionOf: (s: SisStudent) => string;
  onOpen: (id: string) => void;
  align?: "start" | "center";
}) {
  if (siblings.length === 0) return null;
  return (
    <div
      className={`flex flex-wrap gap-1.5 ${
        align === "center" ? "justify-center" : ""
      }`}
    >
      <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Sibling{siblings.length > 1 ? "s" : ""}
      </span>
      {siblings.map((sib) => (
        <button
          key={sib.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(sib.id);
          }}
          className="rounded-md border border-[rgba(32,48,80,0.14)] bg-[rgba(32,48,80,0.04)] px-2 py-1 text-left text-[11px] font-semibold text-[var(--brand-mid)] hover:border-[rgba(197,160,40,0.5)] hover:bg-[rgba(197,160,40,0.12)]"
          title={`Open household with ${sib.fullName}`}
        >
          {sib.fullName}
          <span className="font-normal text-[var(--muted)]">
            {" "}
            · {classSectionOf(sib)}
          </span>
        </button>
      ))}
    </div>
  );
}

function StudentDetail({
  student,
  state,
  classLabel,
  feeGroupLabel,
  highlight,
  onOpenSibling,
  classSectionOf,
}: {
  student: SisStudent;
  state: SisState;
  classLabel: string;
  feeGroupLabel: string;
  highlight?: boolean;
  onOpenSibling: (id: string) => void;
  classSectionOf: (s: SisStudent) => string;
}) {
  const hh = householdOf(state, student.householdId);
  const sibs = siblingsOf(state, student);
  const pct = profileCompleteness(student, hh);

  return (
    <div
      className={`rounded-xl border bg-[var(--card)] p-4 ${
        highlight
          ? "border-[rgba(197,160,40,0.55)] shadow-[0_0_0_1px_rgba(197,160,40,0.12)]"
          : "border-[rgba(32,48,80,0.12)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <StudentAvatar student={student} size={56} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
              <StudentNameLabel student={student} sis={state}>
              {highlight && sibs.length > 0 ? (
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-gold)]">
                  Focus
                </span>
              ) : null}
              </StudentNameLabel>
            </h3>
            {student.udiseInboundTransferPending ? (
              <p className="mt-1 text-[10px] font-semibold text-[#8a5a10]">
                Import from UDISE+ Drop Box or ask previous school to release
                {student.previousSchool
                  ? ` (${student.previousSchool}${student.previousUdise ? ` · ${student.previousUdise}` : ""})`
                  : ""}
              </p>
            ) : null}
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Profile {pct}% complete
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(32,48,80,0.08)]">
              <div
                className="h-full rounded-full bg-[var(--brand-gold)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
        <Link
          href={`/students/${student.id}/edit`}
          className="text-xs font-medium text-[var(--brand-mid)]"
        >
          Complete profile
        </Link>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <Item label="Admission" value={student.admissionNo} />
        <Item label="Class" value={classLabel} />
        <Item label="Category" value={student.category || "—"} />
        <Item label="Fee group" value={feeGroupLabel} />
        <Item label="PEN" value={student.pen || student.penStatus || "Missing"} />
        <Item
          label="Docs on file"
          value={`${countDocsWithFiles(student.docs)}/7`}
        />
        <Item
          label="Guardian"
          value={hh ? `${hh.guardianName} · ${hh.mobile}` : "—"}
        />
        <Item
          label="WhatsApp"
          value={
            hh
              ? hh.whatsappMobile || hh.mobile || "—"
              : "—"
          }
        />
      </dl>
      {sibs.length > 0 ? (
        <div className="mt-3 border-t border-[rgba(32,48,80,0.08)] pt-3">
          <SiblingLinks
            siblings={sibs}
            classSectionOf={classSectionOf}
            onOpen={onOpenSibling}
          />
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-[var(--muted)]">
          No siblings on this household
        </p>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-[var(--brand-deep)]">{value}</dd>
    </div>
  );
}
