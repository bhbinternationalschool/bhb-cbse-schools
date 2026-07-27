"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  GraduationCap,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { loadMasters } from "@/lib/masters";
import { canAccessHref, loadRbac } from "@/lib/rbac";
import { loadSis } from "@/lib/sis";
import { useDemoSession } from "@/components/shell/SessionContext";

type SearchHit = {
  id: string;
  kind: "module" | "student" | "staff";
  title: string;
  subtitle: string;
  href: string;
};

const MODULE_CATALOG: { href: string; label: string; keywords: string }[] = [
  { href: "/home", label: "Home", keywords: "hub dashboard start" },
  { href: "/masters", label: "Masters", keywords: "setup classes sections fee heads roles" },
  { href: "/admissions", label: "Admissions", keywords: "enquiry crm registration rte" },
  { href: "/field", label: "Field app", keywords: "survey capture calling" },
  { href: "/students", label: "Students", keywords: "sis roster udise" },
  { href: "/staff", label: "Staff", keywords: "hr leave appraisal" },
  { href: "/store", label: "Store", keywords: "stock purchase issue inventory" },
  { href: "/transport", label: "Transport", keywords: "bus routes fleet riders" },
  { href: "/accounts", label: "Accounts", keywords: "cashbook ledger daybook pnl" },
  { href: "/trust", label: "Trust", keywords: "projects works capital" },
  { href: "/fees", label: "Fee Take", keywords: "collect receipt dues payment" },
  { href: "/fees/defaulters", label: "Defaulters", keywords: "overdue recovery" },
  { href: "/attendance", label: "Attendance", keywords: "register present leave" },
  { href: "/homework", label: "Homework", keywords: "diary assignment" },
  { href: "/timetable", label: "Timetable", keywords: "periods schedule auto assign bell" },
  { href: "/ptm", label: "PTM", keywords: "parent teacher meeting" },
  { href: "/vault", label: "Vault", keywords: "documents compliance noc" },
  { href: "/modules", label: "Modules", keywords: "feature switches registry" },
  { href: "/payroll", label: "Payroll", keywords: "salary payslip bank" },
  { href: "/exams", label: "Exams", keywords: "marks results promotion" },
  { href: "/certificates", label: "Certificates", keywords: "tc bonafide character" },
  { href: "/comms", label: "Communications", keywords: "notices circulars news gallery" },
  { href: "/comms?tab=channels", label: "Class WhatsApp", keywords: "class channel homework teacher whatsapp" },
  { href: "/comms?tab=notices", label: "Notices", keywords: "circular announcement" },
  { href: "/comms?tab=news", label: "News", keywords: "school news stories" },
  { href: "/comms?tab=gallery", label: "Gallery", keywords: "photos albums events" },
  { href: "/reports", label: "Reports", keywords: "export catalog" },
  { href: "/student-leave", label: "Student leave", keywords: "parent leave request" },
];

function scoreMatch(hay: string, q: string): number {
  const h = hay.toLowerCase();
  const parts = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 0;
  let score = 0;
  for (const p of parts) {
    if (h.startsWith(p)) score += 40;
    else if (h.includes(` ${p}`)) score += 25;
    else if (h.includes(p)) score += 12;
    else return 0;
  }
  return score;
}

export function UniversalSearchBar() {
  const session = useDemoSession();
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const hits = useMemo(() => {
    if (!ready) return [] as SearchHit[];
    const q = query.trim();
    if (q.length < 1) {
      // Show quick module shortcuts when focused with empty query
      const masters = loadMasters();
      const rbac = loadRbac();
      return MODULE_CATALOG.filter((m) =>
        canAccessHref(session, masters, m.href, rbac),
      )
        .slice(0, 8)
        .map((m) => ({
          id: `mod-${m.href}`,
          kind: "module" as const,
          title: m.label,
          subtitle: "Module",
          href: m.href,
        }));
    }

    const masters = loadMasters();
    const rbac = loadRbac();
    const out: (SearchHit & { score: number })[] = [];

    for (const m of MODULE_CATALOG) {
      if (!canAccessHref(session, masters, m.href, rbac)) continue;
      const s = scoreMatch(`${m.label} ${m.keywords}`, q);
      if (s > 0) {
        out.push({
          id: `mod-${m.href}`,
          kind: "module",
          title: m.label,
          subtitle: "Module",
          href: m.href,
          score: s + 20,
        });
      }
    }

    try {
      const sis = loadSis();
      for (const st of sis.students) {
        if (st.academicYearCode !== session.academicYearCode) continue;
        const hay = `${st.fullName} ${st.admissionNo} ${st.srn || ""}`;
        const s = scoreMatch(hay, q);
        if (s > 0) {
          out.push({
            id: `stu-${st.id}`,
            kind: "student",
            title: st.fullName,
            subtitle: `Student · ${st.admissionNo || "No admission no"} · ${session.academicYearCode}`,
            href: `/students?tab=roster&q=${encodeURIComponent(st.admissionNo || st.fullName)}`,
            score: s,
          });
        }
      }
    } catch {
      /* ignore */
    }

    for (const st of masters.staff ?? []) {
      const hay = `${st.fullName} ${st.empCode || ""} ${st.mobile || ""}`;
      const s = scoreMatch(hay, q);
      if (s > 0) {
        out.push({
          id: `staff-${st.id}`,
          kind: "staff",
          title: st.fullName,
          subtitle: `Staff · ${st.empCode || "No code"}`,
          href: `/staff/${st.id}/edit`,
          score: s,
        });
      }
    }

    return out
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 12)
      .map(({ score: _s, ...hit }) => hit);
  }, [query, ready, session]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      setQuery("");
      router.push(hit.href);
    },
    [router],
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  }

  const kindIcon = (kind: SearchHit["kind"]) => {
    if (kind === "student") return <GraduationCap className="h-4 w-4" />;
    if (kind === "staff") return <UserRound className="h-4 w-4" />;
    return <BookOpen className="h-4 w-4" />;
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <label className="sr-only" htmlFor="universal-search">
        Universal search
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
          aria-hidden
        />
        <input
          ref={inputRef}
          id="universal-search"
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && hits[active] ? `${listId}-${hits[active].id}` : undefined
          }
          placeholder="Search modules, students, staff…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-11 w-full rounded-xl border border-[rgba(32,48,80,0.14)] bg-white pl-10 pr-20 text-[15px] text-[var(--brand-deep)] shadow-[0_2px_10px_rgba(32,48,80,0.04)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--brand-gold)] focus:ring-2 focus:ring-[rgba(197,160,40,0.35)]"
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[rgba(32,48,80,0.06)] hover:text-[var(--brand-deep)]"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden rounded-md border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.04)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)] sm:inline">
              ⌘K
            </kbd>
          )}
        </div>
      </div>

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-[min(70vh,28rem)] overflow-auto rounded-xl border border-[rgba(32,48,80,0.12)] bg-white py-1 shadow-[0_18px_40px_rgba(32,48,80,0.16)]"
        >
          {hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">
              No matches for “{query}”
            </p>
          ) : (
            hits.map((hit, i) => {
              const selected = i === active;
              return (
                <button
                  key={hit.id}
                  id={`${listId}-${hit.id}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(hit)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
                    selected
                      ? "bg-[rgba(32,48,80,0.08)]"
                      : "hover:bg-[rgba(32,48,80,0.04)]"
                  }`}
                >
                  <span
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      hit.kind === "module"
                        ? "bg-[rgba(32,48,80,0.1)] text-[var(--brand-deep)]"
                        : hit.kind === "student"
                          ? "bg-[rgba(2,132,199,0.12)] text-[#0369a1]"
                          : "bg-[rgba(15,118,110,0.12)] text-[#0f766e]"
                    }`}
                  >
                    {kindIcon(hit.kind)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-[var(--brand-deep)]">
                      {hit.title}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {hit.subtitle}
                    </span>
                  </span>
                </button>
              );
            })
          )}
          <p className="border-t border-[rgba(32,48,80,0.08)] px-3 py-2 text-[11px] text-[var(--muted)]">
            ↑↓ navigate · Enter open · Esc close · modules · students · staff
          </p>
        </div>
      ) : null}
    </div>
  );
}
