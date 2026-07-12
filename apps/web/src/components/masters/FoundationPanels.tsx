"use client";

import { useMemo, useState } from "react";
import {
  BOARD_MODES,
  HOLIDAY_KINDS,
  STAFF_CATEGORIES,
  STAFF_STREAMS,
  mastersCompleteness,
  newFoundationId,
  isSubjectGroup,
  normalizeSubject,
  subjectChildren,
  subjectsInDisplayOrder,
  type AcademicTerm,
  type AcademicYearMaster,
  type AyStatus,
  type BoardMode,
  type ClassSubjectLink,
  type Department,
  type Designation,
  type Holiday,
  type HolidayKind,
  type NumberSeries,
  type StaffCategory,
  type StaffRecord,
  type StaffStream,
  type Subject,
  type SubjectCategory,
} from "@/lib/foundationMasters";
import {
  NCF_SUBJECT_TAGS,
  cbseGroupForSubject,
  groupSubjectsByCbse,
  languageSubtypeOf,
  type LanguageSubtype,
  type NcfTagId,
} from "@/lib/cbseSubjectGroups";

/** Alias — Masters still iterates the same A/B/C/D tag list */
const CBSE_SUBJECT_GROUPS = NCF_SUBJECT_TAGS;
type CbseGroupId = NcfTagId;
import { DEFAULT_AY, type MastersState } from "@/lib/masters";
import {
  CLASS_GROUPS,
  classesInGroup,
  type ClassGroupCode,
} from "@/lib/masters";
import { EditControl } from "@/components/masters/EditControl";
import { RemoveControl } from "@/components/masters/RemoveControl";
import {
  MastersEmptyRow,
  MastersTabStack,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import {
  NEP_STAGE_PACKS,
  analyseNepPack,
  applyNepSuggestions,
  applySeniorStreamPackages,
  periodsForSuggestion,
  suggestedPeriodsPerWeek,
  suggestedWeeklyLoad,
  type NepStage,
} from "@/lib/nepSubjectSuggestions";
import {
  ncfCartOfferingsReady,
  seedNcfCartOfferings,
} from "@/lib/ncfCartSeed";

type Commit = (s: MastersState, msg?: string) => void;

export function CompletenessDashboard({
  state,
  onGo,
}: {
  state: MastersState;
  onGo: (tab: string) => void;
}) {
  const { percent, items, okCount, total } = useMemo(
    () => mastersCompleteness(state),
    [state],
  );

  function downloadCsv() {
    const lines = [
      "id,label,ok,detail",
      ...items.map(
        (i) =>
          `${i.id},"${i.label.replace(/"/g, '""')}",${i.ok ? "yes" : "no"},"${i.detail.replace(/"/g, '""')}"`,
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `masters_completeness_${percent}pct.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Masters completeness
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Foundation checklist before go-live — {okCount}/{total} ready
          </p>
        </div>
        <div className="flex items-end gap-3">
          <button
            type="button"
            className="text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
            onClick={downloadCsv}
          >
            Export CSV
          </button>
          <div className="text-right">
            <div className="text-2xl font-semibold text-[var(--brand-deep)]">
              {percent}%
            </div>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[rgba(32,48,80,0.08)]">
              <div
                className="h-full rounded-full bg-[var(--brand-gold)]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-[rgba(32,48,80,0.08)]">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2.5"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    item.ok ? "bg-[var(--ok)]" : "bg-[#dc2626]"
                  }`}
                />
                <span className="text-sm font-medium text-[var(--brand-deep)]">
                  {item.label}
                </span>
              </div>
              <p className="ml-4 mt-0.5 text-[11px] text-[var(--muted)]">
                {item.detail}
              </p>
            </div>
            {item.tab && !item.ok ? (
              <button
                type="button"
                className="text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                onClick={() => onGo(item.tab!)}
              >
                Fix →
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SchoolProfilePanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const p = state.schoolProfile;
  const [draft, setDraft] = useState(p);

  function set<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function Field({
    label,
    fieldKey,
    placeholder,
    type = "text",
    className = "",
  }: {
    label: string;
    fieldKey: keyof typeof draft;
    placeholder?: string;
    type?: string;
    className?: string;
  }) {
    if (fieldKey === "boardMode") return null;
    return (
      <label className={`block text-sm ${className}`}>
        <span className="mb-1 block text-[11px] text-[var(--muted)]">
          {label}
        </span>
        <input
          className="field !py-1.5"
          type={type}
          placeholder={placeholder}
          value={String(draft[fieldKey] ?? "")}
          onChange={(e) => set(fieldKey, e.target.value as never)}
        />
      </label>
    );
  }

  return (
    <MastersTabStack
      intro="Legal identity, contact numbers, and social links — used on certificates, receipts, and parent communications."
      tables={
        <MastersTablesRow>
          <MastersTableCard title="Identity & address">
            <dl className="divide-y divide-[rgba(32,48,80,0.08)] text-sm">
              {(
                [
                  ["Legal name", draft.legalName],
                  ["Display", draft.displayName],
                  ["UDISE", draft.udiseCode || "—"],
                  ["Board", draft.boardMode],
                  ["Affiliation", draft.affiliationNo || "—"],
                  ["Address", [draft.address, draft.city, draft.state, draft.pincode].filter(Boolean).join(", ") || "—"],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-3 px-4 py-2.5"
                >
                  <dt className="text-[11px] text-[var(--muted)]">{k}</dt>
                  <dd className="text-right font-medium text-[var(--brand-deep)]">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </MastersTableCard>
          <MastersTableCard title="Contact & social">
            <dl className="divide-y divide-[rgba(32,48,80,0.08)] text-sm">
              {(
                [
                  ["Office phone", draft.phone || "—"],
                  ["Mobile", draft.mobile || "—"],
                  ["WhatsApp", draft.whatsapp || "—"],
                  ["Email", draft.email || "—"],
                  ["Website", draft.website || "—"],
                  ["Facebook", draft.facebook || "—"],
                  ["Instagram", draft.instagram || "—"],
                  ["Google", draft.google || "—"],
                  ["YouTube", draft.youtube || "—"],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-3 px-4 py-2.5"
                >
                  <dt className="shrink-0 text-[11px] text-[var(--muted)]">
                    {k}
                  </dt>
                  <dd className="truncate text-right font-medium text-[var(--brand-deep)]">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <MastersWorkCard title="Edit school profile" hint="Working form — save to update tables above">
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Identity
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Legal name" fieldKey="legalName" />
                <Field label="Display name" fieldKey="displayName" />
                <Field label="Short name" fieldKey="shortName" />
                <Field label="Tagline" fieldKey="tagline" />
                <Field label="UDISE code" fieldKey="udiseCode" />
                <Field label="Affiliation no." fieldKey="affiliationNo" />
                <Field label="School code" fieldKey="schoolCode" />
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Board mode
                  </span>
                  <select
                    className="field !py-1.5"
                    value={draft.boardMode}
                    onChange={(e) =>
                      set("boardMode", e.target.value as BoardMode)
                    }
                  >
                    {BOARD_MODES.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Address
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Address"
                  fieldKey="address"
                  className="sm:col-span-2"
                />
                <Field label="City" fieldKey="city" />
                <Field label="State" fieldKey="state" />
                <Field label="PIN" fieldKey="pincode" />
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Contact
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Office phone"
                  fieldKey="phone"
                  placeholder="Landline"
                  type="tel"
                />
                <Field
                  label="Mobile number"
                  fieldKey="mobile"
                  placeholder="10-digit mobile"
                  type="tel"
                />
                <Field
                  label="WhatsApp number"
                  fieldKey="whatsapp"
                  placeholder="WhatsApp number"
                  type="tel"
                />
                <Field
                  label="Email"
                  fieldKey="email"
                  type="email"
                />
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Website & social
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Website"
                  fieldKey="website"
                  placeholder="https://…"
                  className="sm:col-span-2"
                />
                <Field
                  label="Facebook"
                  fieldKey="facebook"
                  placeholder="https://facebook.com/…"
                />
                <Field
                  label="Instagram"
                  fieldKey="instagram"
                  placeholder="https://instagram.com/…"
                />
                <Field
                  label="Google (Business / Maps)"
                  fieldKey="google"
                  placeholder="https://maps.google.com/…"
                />
                <Field
                  label="YouTube"
                  fieldKey="youtube"
                  placeholder="https://youtube.com/@…"
                />
              </div>
            </section>

            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-sm font-semibold text-white"
              onClick={() =>
                commit(
                  { ...state, schoolProfile: draft },
                  "School profile saved",
                )
              }
            >
              Save profile
            </button>
          </div>
        </MastersWorkCard>
      }
    />
  );
}

export function AcademicPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [status, setStatus] = useState<AyStatus>("upcoming");
  const [termAy, setTermAy] = useState(DEFAULT_AY);
  const [termCode, setTermCode] = useState("");
  const [termLabel, setTermLabel] = useState("");
  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");

  function addYear() {
    if (!code.trim() || !startsOn || !endsOn) return;
    const row: AcademicYearMaster = {
      id: newFoundationId("ay"),
      code: code.trim(),
      label: label.trim() || code.trim(),
      startsOn,
      endsOn,
      status,
      isActive: true,
    };
    let years = [...state.academicYears, row];
    if (status === "current") {
      years = years.map((y) =>
        y.id === row.id ? y : { ...y, status: y.status === "current" ? "closed" : y.status },
      );
    }
    commit({ ...state, academicYears: years }, `Added AY ${row.code}`);
    setCode("");
    setLabel("");
  }

  function setCurrent(id: string) {
    commit(
      {
        ...state,
        academicYears: state.academicYears.map((y) => ({
          ...y,
          status: y.id === id ? "current" : y.status === "current" ? "closed" : y.status,
        })),
      },
      "Current academic year updated",
    );
  }

  function addTerm() {
    if (!termCode.trim() || !termStart || !termEnd) return;
    const row: AcademicTerm = {
      id: newFoundationId("trm"),
      academicYearCode: termAy,
      code: termCode.trim(),
      label: termLabel.trim() || termCode.trim(),
      startsOn: termStart,
      endsOn: termEnd,
      sortOrder: state.academicTerms.filter((t) => t.academicYearCode === termAy)
        .length + 1,
    };
    commit(
      { ...state, academicTerms: [...state.academicTerms, row] },
      `Added term ${row.code}`,
    );
    setTermCode("");
    setTermLabel("");
  }

  return (
    <MastersTabStack
      tables={
        <MastersTablesRow>
          <MastersTableCard title="Academic years">
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {state.academicYears.map((y) => (
                <li
                  key={y.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {y.label}{" "}
                      <span className="text-[11px] font-medium text-[var(--muted)]">
                        {y.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      {y.startsOn} → {y.endsOn}
                    </p>
                  </div>
                  {y.status !== "current" ? (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[var(--brand-deep)]"
                      onClick={() => setCurrent(y.id)}
                    >
                      Set current
                    </button>
                  ) : (
                    <span className="rounded bg-[rgba(197,160,40,0.2)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-deep)]">
                      CURRENT
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </MastersTableCard>
          <MastersTableCard title="Terms">
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {state.academicTerms
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((t) => (
                  <li key={t.id} className="px-4 py-3 text-sm">
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {t.academicYearCode} · {t.code}
                    </span>{" "}
                    {t.label}
                    <span className="ml-2 text-[11px] text-[var(--muted)]">
                      {t.startsOn} → {t.endsOn}
                    </span>
                  </li>
                ))}
              {state.academicTerms.length === 0 ? (
                <MastersEmptyRow />
              ) : null}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersWorkCard title="Add academic year">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="field !py-1.5"
                placeholder="Code e.g. 2026-27"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <input
                className="field !py-1.5"
                placeholder="Label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <input
                className="field !py-1.5"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
              <input
                className="field !py-1.5"
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
              <select
                className="field !py-1.5 sm:col-span-2"
                value={status}
                onChange={(e) => setStatus(e.target.value as AyStatus)}
              >
                <option value="upcoming">Upcoming</option>
                <option value="current">Current</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
              onClick={addYear}
            >
              Add academic year
            </button>
          </MastersWorkCard>
          <MastersWorkCard title="Add term">
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className="field !py-1.5"
                value={termAy}
                onChange={(e) => setTermAy(e.target.value)}
              >
                {state.academicYears.map((y) => (
                  <option key={y.id} value={y.code}>
                    {y.code}
                  </option>
                ))}
              </select>
              <input
                className="field !py-1.5"
                placeholder="Code T1"
                value={termCode}
                onChange={(e) => setTermCode(e.target.value)}
              />
              <input
                className="field !py-1.5 sm:col-span-2"
                placeholder="Label"
                value={termLabel}
                onChange={(e) => setTermLabel(e.target.value)}
              />
              <input
                className="field !py-1.5"
                type="date"
                value={termStart}
                onChange={(e) => setTermStart(e.target.value)}
              />
              <input
                className="field !py-1.5"
                type="date"
                value={termEnd}
                onChange={(e) => setTermEnd(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
              onClick={addTerm}
            >
              Add term
            </button>
          </MastersWorkCard>
        </div>
      }
    />
  );
}

const CLASS_GROUP_TO_NEP: Record<ClassGroupCode, NepStage> = {
  PRE_PRIMARY: "foundational",
  PRIMARY: "preparatory",
  MIDDLE: "middle",
  SECONDARY: "secondary_9_10",
  SENIOR: "secondary_11_12",
};

export function SubjectsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState<SubjectCategory>("scholastic");
  const [area, setArea] = useState("");
  const [parentId, setParentId] = useState("");
  const [cbseGroupId, setCbseGroupId] = useState<CbseGroupId | "">("");
  const [languageSubtype, setLanguageSubtype] =
    useState<LanguageSubtype>("");
  const [mapClassId, setMapClassId] = useState("");
  const [mapSubjectIds, setMapSubjectIds] = useState<string[]>([]);
  const [periods, setPeriods] = useState(0);
  const [linkAsOptional, setLinkAsOptional] = useState(false);
  const [classGroup, setClassGroup] = useState<ClassGroupCode | null>(null);

  const nepStage: NepStage = classGroup
    ? CLASS_GROUP_TO_NEP[classGroup]
    : "middle";

  const nepPack =
    NEP_STAGE_PACKS.find((p) => p.id === nepStage) ?? NEP_STAGE_PACKS[2]!;
  const nepAnalysis = useMemo(
    () => analyseNepPack(nepPack, state.subjects),
    [nepPack, state.subjects],
  );
  const weeklyLoad = useMemo(
    () => suggestedWeeklyLoad(nepPack),
    [nepPack],
  );

  const activeGroupDef = CLASS_GROUPS.find((g) => g.code === classGroup);
  const groupClasses = useMemo(
    () => (classGroup ? classesInGroup(state.classes, classGroup) : []),
    [state.classes, classGroup],
  );
  const groupClassIds = useMemo(
    () => new Set(groupClasses.map((c) => c.id)),
    [groupClasses],
  );
  const groupLinks = useMemo(
    () =>
      state.classSubjects.filter(
        (l) => l.isActive && groupClassIds.has(l.classId),
      ),
    [state.classSubjects, groupClassIds],
  );

  /** Subjects & parent groups relevant to the open class group. */
  const groupRelatedSubjects = useMemo(() => {
    if (!classGroup) return [];
    const nepCodes = new Set(
      nepPack.subjects.map((s) => s.code.toUpperCase()),
    );
    // Also include underCode parents from NEP pack
    for (const s of nepPack.subjects) {
      if (s.underCode) nepCodes.add(s.underCode.toUpperCase());
    }
    const linkedIds = new Set(groupLinks.map((l) => l.subjectId));
    // Expand: parents of linked components, children of linked groups
    for (const id of [...linkedIds]) {
      const sub = state.subjects.find((s) => s.id === id);
      if (sub?.parentId) linkedIds.add(sub.parentId);
    }
    for (const s of state.subjects) {
      if (s.parentId && linkedIds.has(s.parentId)) linkedIds.add(s.id);
    }

    const related = state.subjects.filter((s) => {
      if (linkedIds.has(s.id)) return true;
      if (nepCodes.has(s.code.toUpperCase())) return true;
      // Parent group if any child matches NEP / linked
      if (
        !s.parentId &&
        state.subjects.some(
          (c) =>
            c.parentId === s.id &&
            (linkedIds.has(c.id) || nepCodes.has(c.code.toUpperCase())),
        )
      ) {
        return true;
      }
      return false;
    });
    return subjectsInDisplayOrder(related);
  }, [classGroup, nepPack, groupLinks, state.subjects]);

  const groupParents = groupRelatedSubjects.filter(
    (s) => s.isActive && !s.parentId,
  );

  const subjectsByCbse = useMemo(
    () => groupSubjectsByCbse(groupRelatedSubjects),
    [groupRelatedSubjects],
  );

  const linksByCbse = useMemo(() => {
    const enriched = groupLinks
      .map((l) => {
        const subject = state.subjects.find((s) => s.id === l.subjectId);
        return subject ? { link: l, subject } : null;
      })
      .filter((x): x is { link: ClassSubjectLink; subject: Subject } => !!x);

    const buckets = new Map<
      CbseGroupId,
      { link: ClassSubjectLink; subject: Subject }[]
    >();
    for (const g of CBSE_SUBJECT_GROUPS) buckets.set(g.id, []);
    for (const row of enriched) {
      const gid = cbseGroupForSubject(row.subject);
      buckets.get(gid)!.push(row);
    }
    return CBSE_SUBJECT_GROUPS.map((group) => ({
      group,
      rows: buckets.get(group.id) ?? [],
    })).filter((b) => b.rows.length > 0);
  }, [groupLinks, state.subjects]);

  const nepCodeSet = useMemo(() => {
    const codes = new Set(nepPack.subjects.map((s) => s.code.toUpperCase()));
    for (const s of nepPack.subjects) {
      if (s.underCode) codes.add(s.underCode.toUpperCase());
    }
    return codes;
  }, [nepPack]);

  function openClassGroup(code: ClassGroupCode) {
    setClassGroup(code);
    setMapSubjectIds([]);
    const first = classesInGroup(state.classes, code).find((c) => c.isActive);
    setMapClassId(first?.id ?? "");
  }

  function applyNepPack() {
    const { subjects, added } = applyNepSuggestions(
      state.subjects,
      nepPack,
    );
    if (added === 0) {
      commit(state, "All NEP suggestions for this stage are already present");
      return;
    }
    commit(
      { ...state, subjects },
      `Added ${added} NEP/NCF subject${added === 1 ? "" : "s"} · ${nepPack.label}`,
    );
  }

  function seedCartOfferings() {
    const seeded = seedNcfCartOfferings({
      classes: state.classes,
      subjects: state.subjects,
      classSubjects: state.classSubjects ?? [],
    });
    commit(
      {
        ...state,
        subjects: seeded.subjects,
        classSubjects: seeded.classSubjects,
      },
      seeded.alreadySeeded
        ? "IX–X / XI–XII cart offerings already complete · tags refreshed"
        : `Seeded cart · +${seeded.subjectsAdded} subjects · +${seeded.linksAdded} class links`,
    );
  }

  function applyStreams() {
    const result = applySeniorStreamPackages(
      state.subjects,
      state.seniorStreams ?? [],
    );
    commit(
      {
        ...state,
        subjects: result.subjects,
        seniorStreams: result.seniorStreams,
      },
      result.subjectsAdded > 0
        ? `Streams ready · ${result.subjectsAdded} subjects added · ${result.streamsUpserted} pathways`
        : `XI–XII streams refreshed · ${result.streamsUpserted} pathways`,
    );
  }

  const streams = (state.seniorStreams ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  function addSubject() {
    if (!code.trim() || !nameEn.trim()) return;
    const parent = parentId
      ? state.subjects.find((s) => s.id === parentId)
      : null;
    const row = normalizeSubject({
      id: newFoundationId("sub"),
      code: code.trim().toUpperCase(),
      nameEn: nameEn.trim(),
      category: parent?.category ?? category,
      coScholasticArea:
        (parent?.category ?? category) === "co_scholastic" ? area : "",
      parentId: parentId || null,
      isElective: false,
      isActive: true,
      sortOrder: parentId
        ? subjectChildren(state.subjects, parentId).length + 1
        : state.subjects.filter((s) => !s.parentId).length + 1,
      ncfTagId: (cbseGroupId as CbseGroupId) || undefined,
      cbseGroupId:
        (cbseGroupId as CbseGroupId) ||
        parent?.ncfTagId ||
        parent?.cbseGroupId ||
        null,
      languageSubtype:
        languageSubtype || parent?.languageSubtype || undefined,
    });
    commit(
      { ...state, subjects: [...state.subjects, row] },
      parent
        ? `Added ${row.code} under ${parent.code}`
        : `Added ${row.code}`,
    );
    setCode("");
    setNameEn("");
    setCbseGroupId("");
    setLanguageSubtype("");
  }

  function setSubjectCbseGroup(id: string, next: CbseGroupId) {
    commit(
      {
        ...state,
        subjects: state.subjects.map((s) =>
          s.id === id
            ? normalizeSubject({ ...s, ncfTagId: next, cbseGroupId: next })
            : s,
        ),
      },
      `NCF tag → ${next}`,
    );
  }

  function setSubjectLanguageSubtype(id: string, next: LanguageSubtype) {
    commit(
      {
        ...state,
        subjects: state.subjects.map((s) =>
          s.id === id
            ? normalizeSubject({ ...s, languageSubtype: next })
            : s,
        ),
      },
      next ? `Language subtype → ${next}` : "Language subtype cleared",
    );
  }

  function toggleSubject(id: string) {
    commit({
      ...state,
      subjects: state.subjects.map((s) =>
        s.id === id ? { ...s, isActive: !s.isActive } : s,
      ),
    });
  }

  function toggleMapSubject(id: string) {
    const kids = subjectChildren(state.subjects, id).map((s) => s.id);
    setMapSubjectIds((prev) => {
      const on = prev.includes(id);
      if (kids.length > 0) {
        // Group head: select/deselect all components
        if (on || kids.every((k) => prev.includes(k))) {
          return prev.filter((x) => x !== id && !kids.includes(x));
        }
        return [...new Set([...prev, id, ...kids])];
      }
      return on ? prev.filter((x) => x !== id) : [...prev, id];
    });
  }

  function selectAllMapSubjects() {
    const ids = groupRelatedSubjects
      .filter((s) => s.isActive)
      .map((s) => s.id);
    setMapSubjectIds(ids);
  }

  function clearMapSubjects() {
    setMapSubjectIds([]);
  }

  function addMap() {
    if (!mapClassId || mapSubjectIds.length === 0) return;
    const existing = new Set(
      state.classSubjects
        .filter((l) => l.classId === mapClassId && l.isActive)
        .map((l) => l.subjectId),
    );
    const toAdd = mapSubjectIds.filter((id) => !existing.has(id));
    if (toAdd.length === 0) {
      commit(state, "Those subjects are already linked to this class");
      return;
    }
    const useSuggested = periods <= 0;
    const rows: ClassSubjectLink[] = toAdd.map((subjectId) => {
      const sub = state.subjects.find((s) => s.id === subjectId);
      const suggested = sub
        ? suggestedPeriodsPerWeek(nepStage, sub.code, sub.category)
        : 5;
      return {
        id: newFoundationId("csub"),
        classId: mapClassId,
        subjectId,
        periodsPerWeek: useSuggested ? suggested : periods,
        isActive: true,
        isOptional: linkAsOptional || !!sub?.isElective,
      };
    });
    commit(
      { ...state, classSubjects: [...state.classSubjects, ...rows] },
      `Linked ${rows.length} subject${rows.length === 1 ? "" : "s"} to class`,
    );
    setMapSubjectIds([]);
    setLinkAsOptional(false);
  }

  function applySuggestedPeriodsToClass() {
    if (!mapClassId) return;
    let changed = 0;
    const next = state.classSubjects.map((l) => {
      if (l.classId !== mapClassId || !l.isActive) return l;
      const sub = state.subjects.find((s) => s.id === l.subjectId);
      if (!sub) return l;
      const p = suggestedPeriodsPerWeek(nepStage, sub.code, sub.category);
      if (l.periodsPerWeek === p) return l;
      changed += 1;
      return { ...l, periodsPerWeek: p };
    });
    if (changed === 0) {
      commit(state, "Periods already match NEP suggestions for this class");
      return;
    }
    commit(
      { ...state, classSubjects: next },
      `Updated periods/week on ${changed} link(s) · ${nepPack.label}`,
    );
  }

  function removeMap(id: string) {
    commit({
      ...state,
      classSubjects: state.classSubjects.filter((l) => l.id !== id),
    });
  }

  return (
    <MastersTabStack
      intro="Pick a class group to open only that stage’s subject configuration (NEP pack, map, linking). Other groups stay closed."
      tables={
        <>
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                  Class group
                </h2>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                  Click a group to configure subjects for those classes only.
                </p>
              </div>
              {classGroup ? (
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                  onClick={() => {
                    setClassGroup(null);
                    setMapClassId("");
                    setMapSubjectIds([]);
                  }}
                >
                  Close · back to groups
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {CLASS_GROUPS.map((g) => {
                const n = classesInGroup(state.classes, g.code).filter(
                  (c) => c.isActive,
                ).length;
                const on = classGroup === g.code;
                return (
                  <button
                    key={g.code}
                    type="button"
                    onClick={() => openClassGroup(g.code)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      on
                        ? "border-[var(--brand-deep)] bg-[var(--brand-deep)] text-white shadow-md ring-2 ring-[var(--brand-gold)] ring-offset-2"
                        : "border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] text-[var(--brand-deep)] hover:border-[rgba(197,160,40,0.5)]"
                    }`}
                  >
                    <div className="text-sm font-bold">{g.label}</div>
                    <div
                      className={`mt-0.5 text-[11px] font-semibold ${
                        on ? "text-white/80" : "text-[var(--muted)]"
                      }`}
                    >
                      {g.shortLabel} · {n} classes
                    </div>
                    <div
                      className={`mt-1 text-[10px] leading-snug ${
                        on ? "text-white/70" : "text-[var(--muted)]"
                      }`}
                    >
                      {g.nepHint}
                    </div>
                    {on ? (
                      <span className="mt-2 inline-block rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide">
                        Open
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {!classGroup ? (
            <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
              Select a class group above to open its NEP suggestions, class–subject
              map, and linking form.
            </p>
          ) : (
            <>
          <div className="rounded-xl border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.06)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-[#0f766e]">
                  {activeGroupDef?.label} · NEP / NCF suggestions
                </h2>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
                  {activeGroupDef?.shortLabel} · {nepPack.label} (ages{" "}
                  {nepPack.ages}). Suggestions apply to this class group’s stage
                  only.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {(classGroup === "SECONDARY" || classGroup === "SENIOR") && (
                  <button
                    type="button"
                    className="rounded-lg border border-[#0f766e] bg-white px-3 py-2 text-xs font-bold text-[#0f766e]"
                    onClick={seedCartOfferings}
                  >
                    {ncfCartOfferingsReady(state)
                      ? "Refresh cart seed"
                      : "Seed cart for IX–XII"}
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-lg bg-[#0f766e] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                  disabled={nepAnalysis.missingCount === 0}
                  onClick={applyNepPack}
                >
                  {nepAnalysis.missingCount === 0
                    ? "Stage complete"
                    : `Add ${nepAnalysis.missingCount} missing`}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-lg bg-white/80 p-3">
                <p className="text-xs font-semibold text-[var(--brand-deep)]">
                  {nepPack.label} · ages {nepPack.ages}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                  {nepPack.summary}
                </p>
                <ul className="mt-2 space-y-1">
                  {nepPack.tips.map((t) => (
                    <li
                      key={t}
                      className="text-[11px] leading-snug text-[var(--brand-deep)]"
                    >
                      <span className="mr-1 text-[#0f766e]">▸</span>
                      {t}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] font-semibold text-[var(--brand-deep)]">
                  Classes in this group
                </p>
                <p className="text-[11px] text-[var(--muted)]">
                  {groupClasses.map((c) => c.name).join(" · ") || "—"}
                </p>
              </div>
              <div className="rounded-lg bg-white/80 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--brand-deep)]">
                    Checklist · periods / week
                  </p>
                  <p className="text-[10px] font-semibold text-[var(--muted)]">
                    {nepAnalysis.presentCount}/{nepAnalysis.gaps.length} · ~
                    {weeklyLoad.total} p/wk
                  </p>
                </div>
                <ul className="max-h-44 space-y-1 overflow-y-auto">
                  {nepAnalysis.gaps.map(({ item, status }) => {
                    const p = periodsForSuggestion(nepStage, item);
                    return (
                      <li
                        key={item.code}
                        className="flex items-start justify-between gap-2 text-[11px]"
                      >
                        <span className="min-w-0">
                          <span className="font-semibold text-[var(--brand-deep)]">
                            {item.code}
                          </span>{" "}
                          <span className="text-[var(--muted)]">
                            {item.nameEn}
                            {item.underCode ? ` · under ${item.underCode}` : ""}
                          </span>
                          {item.note ? (
                            <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                              {item.note}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="rounded bg-[rgba(15,118,110,0.12)] px-1.5 py-0.5 text-[9px] font-bold text-[#0f766e]">
                            {p}/wk
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              status === "present"
                                ? "bg-[rgba(22,163,74,0.15)] text-[#15803d]"
                                : "bg-[rgba(220,38,38,0.1)] text-[#b91c1c]"
                            }`}
                          >
                            {status === "present" ? "Have" : "Add"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[10px] leading-snug text-[var(--muted)]">
                  Indicative CBSE-style load (~{weeklyLoad.total} periods/week for
                  listed cores). Typical school week is 40–48 periods — trim
                  electives to fit your bell schedule.
                </p>
              </div>
            </div>
          </div>

          {classGroup === "SENIOR" ? (
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                  XI–XII streams / pathways
                </h2>
                <p className="mt-0.5 max-w-2xl text-[11px] leading-snug text-[var(--muted)]">
                  Offer the usual packages parents expect —{" "}
                  <strong className="text-[var(--brand-deep)]">
                    Science (PCM / PCB), Commerce, Humanities
                  </strong>
                  . Activate only the streams your school runs. Multidisciplinary
                  is optional (NEP flexible choice) and off by default.
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-bold text-white"
                onClick={applyStreams}
              >
                Sync streams + XI–XII subjects
              </button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {streams.map((st) => (
                <div
                  key={st.id}
                  className={`rounded-xl border px-3 py-3 ${
                    st.isActive
                      ? "border-[rgba(32,48,80,0.18)] bg-white"
                      : "border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.02)] opacity-70"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[var(--brand-deep)]">
                      {st.nameEn}
                    </span>
                    <span className="rounded bg-[rgba(32,48,80,0.08)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--muted)]">
                      {st.traditionalLabel}
                    </span>
                    {st.code === "MULTI" ? (
                      <span className="rounded bg-[rgba(196,149,58,0.15)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--brand-gold)]">
                        Optional
                      </span>
                    ) : null}
                    {!st.isActive ? (
                      <span className="text-[10px] text-[var(--muted)]">
                        inactive
                      </span>
                    ) : (
                      <span className="rounded bg-[rgba(15,118,110,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#0f766e]">
                        Offered
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-[var(--muted)]">
                    {st.nepNote}
                  </p>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Core · suggested /wk
                  </p>
                  <p className="text-[11px] font-medium text-[var(--brand-deep)]">
                    {st.coreCodes
                      .map(
                        (c) =>
                          `${c} (${suggestedPeriodsPerWeek("secondary_11_12", c)}/wk)`,
                      )
                      .join(" · ") || "—"}
                  </p>
                  <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Electives / open
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {st.electiveCodes
                      .map(
                        (c) =>
                          `${c} (${suggestedPeriodsPerWeek("secondary_11_12", c)}/wk)`,
                      )
                      .join(" · ") || "—"}
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-[11px] font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                    onClick={() => {
                      commit(
                        {
                          ...state,
                          seniorStreams: state.seniorStreams.map((x) =>
                            x.id === st.id
                              ? { ...x, isActive: !x.isActive }
                              : x,
                          ),
                        },
                        st.isActive
                          ? `${st.nameEn} inactivated`
                          : `${st.nameEn} activated`,
                      );
                    }}
                  >
                    {st.isActive ? "Inactivate" : "Activate"}
                  </button>
                </div>
              ))}
              {streams.length === 0 ? (
                <p className="text-sm text-[var(--muted)] md:col-span-2">
                  No streams yet — click Sync to load Science / Commerce /
                  Humanities packages (Multidisciplinary optional).
                </p>
              ) : null}
            </div>
          </div>
          ) : null}

          <MastersTablesRow>
          <MastersTableCard
            title={`CBSE groups · ${activeGroupDef?.shortLabel ?? ""}`}
          >
            <p className="border-b border-[rgba(32,48,80,0.08)] px-4 py-2 text-[11px] leading-snug text-[var(--muted)]">
              Same CBSE / NCF groups for every class. Nur–VIII use this as the
              common curriculum (no student choice). IX–XII optional picks use
              the same groups. Change a subject’s group anytime.
            </p>
            {groupRelatedSubjects.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                No subjects for this stage yet — apply the NEP pack below or
                add a subject.
              </p>
            ) : null}
            {subjectsByCbse.map(({ group, subjects }) => (
              <div key={group.id}>
                <div className="sticky top-0 z-[1] border-b border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.05)] px-4 py-2">
                  <div className="text-xs font-bold text-[var(--brand-deep)]">
                    {group.label}
                  </div>
                  <p className="text-[10px] text-[var(--muted)]">{group.hint}</p>
                </div>
                <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                  {subjects.map((s) => {
                    const isChild = !!s.parentId;
                    const isGroup = isSubjectGroup(state.subjects, s.id);
                    const inNep = nepCodeSet.has(s.code.toUpperCase());
                    const linked = groupLinks.some((l) => l.subjectId === s.id);
                    const gId = cbseGroupForSubject(s);
                    return (
                      <li
                        key={s.id}
                        className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${
                          isChild ? "bg-[rgba(32,48,80,0.02)]" : ""
                        }`}
                      >
                        <div className={isChild ? "pl-5" : ""}>
                          <span className="text-sm font-semibold text-[var(--brand-deep)]">
                            {isChild ? "↳ " : ""}
                            {s.code}
                          </span>{" "}
                          <span className="text-sm">{s.nameEn}</span>
                          {isGroup ? (
                            <span className="ml-2 rounded bg-[rgba(15,118,110,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#0f766e]">
                              Head
                            </span>
                          ) : null}
                          {isChild ? (
                            <span className="ml-2 rounded bg-[rgba(32,48,80,0.08)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--muted)]">
                              Component
                            </span>
                          ) : null}
                          {inNep ? (
                            <span className="ml-2 rounded bg-[rgba(196,149,58,0.15)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--brand-gold)]">
                              NEP
                            </span>
                          ) : null}
                          {linked ? (
                            <span className="ml-2 rounded bg-[rgba(32,48,80,0.1)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--brand-mid)]">
                              Linked
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="field !w-auto !py-1 text-[11px]"
                            value={gId}
                            title="NCF tag"
                            onChange={(e) =>
                              setSubjectCbseGroup(
                                s.id,
                                e.target.value as CbseGroupId,
                              )
                            }
                          >
                            {CBSE_SUBJECT_GROUPS.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.id} · {g.shortLabel}
                              </option>
                            ))}
                          </select>
                          {gId === "A" ? (
                            <select
                              className="field !w-auto !py-1 text-[11px]"
                              value={languageSubtypeOf(s) || ""}
                              title="Language subtype"
                              onChange={(e) =>
                                setSubjectLanguageSubtype(
                                  s.id,
                                  e.target.value as LanguageSubtype,
                                )
                              }
                            >
                              <option value="native">Native</option>
                              <option value="regional">Regional</option>
                              <option value="foreign">Foreign</option>
                            </select>
                          ) : null}
                          <button
                            type="button"
                            className="text-[11px] font-semibold"
                            onClick={() => toggleSubject(s.id)}
                          >
                            {s.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </MastersTableCard>
          <MastersTableCard
            title={`Class–subject map · ${activeGroupDef?.shortLabel ?? ""}`}
          >
            {groupLinks.length === 0 ? (
              <MastersEmptyRow label="No links for this class group yet" />
            ) : null}
            {linksByCbse.map(({ group, rows }) => (
              <div key={group.id}>
                <div className="sticky top-0 z-[1] border-b border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.05)] px-4 py-2 text-xs font-bold text-[var(--brand-deep)]">
                  {group.shortLabel}
                </div>
                <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                  {rows.map(({ link: l, subject: sub }) => {
                    const cls = state.classes.find((c) => c.id === l.classId);
                    const parent = sub.parentId
                      ? state.subjects.find((s) => s.id === sub.parentId)
                      : null;
                    return (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                      >
                        <span>
                          {cls?.name ?? "?"} ·{" "}
                          {parent ? (
                            <span className="text-[var(--muted)]">
                              {parent.code}/
                            </span>
                          ) : null}
                          {sub.code} ({l.periodsPerWeek}/wk)
                          {l.isOptional || sub.isElective ? (
                            <span className="ml-1 rounded bg-[rgba(196,149,58,0.15)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--brand-gold)]">
                              Optional
                            </span>
                          ) : null}
                          <span className="ml-1 text-[10px] text-[var(--muted)]">
                            · NEP{" "}
                            {suggestedPeriodsPerWeek(
                              nepStage,
                              sub.code,
                              sub.category,
                            )}
                            /wk
                          </span>
                        </span>
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[var(--danger)]"
                          onClick={() => removeMap(l.id)}
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </MastersTableCard>
        </MastersTablesRow>
        </>
          )}
        </>
      }
      work={
        !classGroup ? null : (
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersWorkCard
            title="Add subject / component"
            hint="Leave group empty for a top-level subject. Choose a group to add Oral, Written, etc."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Under group (optional)
                </span>
                <select
                  className="field !py-1.5"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">— Top-level / new group —</option>
                  {groupParents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  NCF tag (A / B / C / D)
                </span>
                <select
                  className="field !py-1.5"
                  value={cbseGroupId}
                  onChange={(e) =>
                    setCbseGroupId(e.target.value as CbseGroupId | "")
                  }
                >
                  <option value="">— Auto from code —</option>
                  {CBSE_SUBJECT_GROUPS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              {(cbseGroupId === "A" ||
                (!cbseGroupId &&
                  code &&
                  ["ENG", "HIN", "SKT", "URDU", "L1", "L2", "L3"].includes(
                    code.trim().toUpperCase(),
                  ))) ? (
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Language subtype
                  </span>
                  <select
                    className="field !py-1.5"
                    value={languageSubtype}
                    onChange={(e) =>
                      setLanguageSubtype(e.target.value as LanguageSubtype)
                    }
                  >
                    <option value="">— Auto from code —</option>
                    <option value="native">Native</option>
                    <option value="regional">Regional</option>
                    <option value="foreign">Foreign</option>
                  </select>
                </label>
              ) : null}
              <input
                className="field !py-1.5"
                placeholder={parentId ? "Code e.g. ENG-ORAL" : "Code e.g. ENG"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <input
                className="field !py-1.5"
                placeholder={
                  parentId ? "Name e.g. English — Oral" : "Name e.g. English"
                }
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
              />
              {!parentId ? (
                <>
                  <select
                    className="field !py-1.5"
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as SubjectCategory)
                    }
                  >
                    <option value="scholastic">Scholastic</option>
                    <option value="co_scholastic">Co-scholastic</option>
                  </select>
                  <input
                    className="field !py-1.5"
                    placeholder="Co-scholastic area"
                    value={area}
                    disabled={category !== "co_scholastic"}
                    onChange={(e) => setArea(e.target.value)}
                  />
                </>
              ) : null}
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
              onClick={addSubject}
            >
              {parentId ? "Add component" : "Add subject"}
            </button>
          </MastersWorkCard>
          <MastersWorkCard
            title={`Link · ${activeGroupDef?.label ?? "class group"}`}
          >
            <div className="space-y-3">
              <select
                className="field !py-1.5"
                value={mapClassId}
                onChange={(e) => setMapClassId(e.target.value)}
              >
                <option value="">Class in {activeGroupDef?.shortLabel}…</option>
                {groupClasses
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>

              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--muted)]">
                    Subjects (tap a group to select all components)
                  </span>
                  <span className="flex gap-2 text-[11px]">
                    <button
                      type="button"
                      className="font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                      onClick={selectAllMapSubjects}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                      onClick={clearMapSubjects}
                    >
                      Clear
                    </button>
                  </span>
                </div>
                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-[rgba(32,48,80,0.12)] p-2">
                  {groupRelatedSubjects
                    .filter((s) => s.isActive)
                    .map((s) => {
                      const on = mapSubjectIds.includes(s.id);
                      const kids = subjectChildren(state.subjects, s.id);
                      const isGroup = kids.length > 0;
                      const already =
                        !!mapClassId &&
                        state.classSubjects.some(
                          (l) =>
                            l.classId === mapClassId &&
                            l.subjectId === s.id &&
                            l.isActive,
                        );
                      return (
                        <button
                          key={s.id}
                          type="button"
                          title={s.nameEn}
                          onClick={() => toggleMapSubject(s.id)}
                          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                            s.parentId ? "ml-2" : ""
                          } ${
                            on
                              ? "bg-[var(--brand-deep)] text-white"
                              : already
                                ? "bg-[rgba(32,48,80,0.06)] text-[var(--muted)] ring-1 ring-[rgba(32,48,80,0.12)]"
                                : isGroup
                                  ? "bg-[rgba(15,118,110,0.12)] text-[#0f766e]"
                                  : "bg-[var(--surface)] text-[var(--brand-deep)]"
                          }`}
                        >
                          {isGroup ? "▣ " : s.parentId ? "· " : ""}
                          {s.code}
                          {already && !on ? " ✓" : ""}
                        </button>
                      );
                    })}
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                  {mapSubjectIds.length} selected
                  {mapClassId
                    ? ` · will link to ${
                        state.classes.find((c) => c.id === mapClassId)?.name ??
                        "class"
                      }`
                    : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Override periods / week
                  </span>
                  <input
                    className="field !py-1.5 w-28"
                    type="number"
                    min={0}
                    max={12}
                    value={periods}
                    onChange={(e) => setPeriods(Number(e.target.value) || 0)}
                    title="0 = use NEP suggested periods per subject"
                  />
                  <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                    0 = NEP suggest each
                  </span>
                </label>
                <label className="flex items-center gap-2 pb-2 text-xs font-semibold text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={linkAsOptional}
                    onChange={(e) => setLinkAsOptional(e.target.checked)}
                  />
                  Mark as optional (student choice)
                </label>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                  disabled={!mapClassId || mapSubjectIds.length === 0}
                  onClick={addMap}
                >
                  Link {mapSubjectIds.length || ""} subject
                  {mapSubjectIds.length === 1 ? "" : "s"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(15,118,110,0.35)] px-3 py-2 text-xs font-semibold text-[#0f766e] disabled:opacity-40"
                  disabled={!mapClassId}
                  onClick={applySuggestedPeriodsToClass}
                >
                  Apply NEP periods to class
                </button>
              </div>
            </div>
          </MastersWorkCard>
        </div>
        )
      }
    />
  );
}

export function NumberSeriesPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [nextNumber, setNextNumber] = useState(1);
  const [padWidth, setPadWidth] = useState(4);

  function startEdit(s: NumberSeries) {
    setEditingId(s.id);
    setPrefix(s.prefix);
    setNextNumber(s.nextNumber);
    setPadWidth(s.padWidth);
  }

  function saveEdit() {
    if (!editingId) return;
    commit(
      {
        ...state,
        numberSeries: state.numberSeries.map((s) =>
          s.id === editingId
            ? { ...s, prefix, nextNumber, padWidth }
            : s,
        ),
      },
      "Number series updated",
    );
    setEditingId(null);
  }

  return (
    <MastersTabStack
      intro="Prefix + next number for admission, receipts, SRN, TC. Demo only — live numbering locks on Supabase."
      tables={
        <MastersTablesRow cols={1}>
          <MastersTableCard title="Numbering series">
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {state.numberSeries.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {s.label}
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      Next: {s.prefix}
                      {String(s.nextNumber).padStart(s.padWidth, "0")}
                      {s.resetOnAy ? " · resets each AY" : ""}
                    </p>
                  </div>
                  <EditControl
                    active={editingId === s.id}
                    onEdit={() => startEdit(s)}
                  />
                </li>
              ))}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <MastersWorkCard
          title={
            editingId
              ? `Edit · ${state.numberSeries.find((s) => s.id === editingId)?.label ?? ""}`
              : "Select a series to edit"
          }
          hint="Working form"
        >
          {editingId ? (
            <div className="flex max-w-xl flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Prefix
                </span>
                <input
                  className="field !py-1.5"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Next #
                </span>
                <input
                  className="field !py-1.5 w-24"
                  type="number"
                  value={nextNumber}
                  onChange={(e) => setNextNumber(Number(e.target.value) || 1)}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Pad
                </span>
                <input
                  className="field !py-1.5 w-20"
                  type="number"
                  value={padWidth}
                  onChange={(e) => setPadWidth(Number(e.target.value) || 4)}
                />
              </label>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                onClick={saveEdit}
              >
                Save
              </button>
              <button
                type="button"
                className="text-xs text-[var(--muted)]"
                onClick={() => setEditingId(null)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Click Edit on a series above.
            </p>
          )}
        </MastersWorkCard>
      }
    />
  );
}

export function HolidaysPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [title, setTitle] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [kind, setKind] = useState<HolidayKind>("school");
  const [ay, setAy] = useState(DEFAULT_AY);

  function add() {
    if (!title.trim() || !startsOn) return;
    const row: Holiday = {
      id: newFoundationId("hol"),
      academicYearCode: ay,
      title: title.trim(),
      startsOn,
      endsOn: endsOn || startsOn,
      kind,
      isPublished: false,
      publishedAt: null,
      publishedBy: "",
      note: "",
    };
    commit(
      { ...state, holidays: [...state.holidays, row] },
      "Holiday draft added",
    );
    setTitle("");
  }

  function publish(id: string) {
    commit(
      {
        ...state,
        holidays: state.holidays.map((h) =>
          h.id === id
            ? {
                ...h,
                isPublished: true,
                publishedAt: new Date().toISOString(),
                publishedBy: "Principal",
              }
            : h,
        ),
      },
      "Holiday published — attendance will skip this date",
    );
  }

  function unpublish(id: string) {
    commit({
      ...state,
      holidays: state.holidays.map((h) =>
        h.id === id
          ? { ...h, isPublished: false, publishedAt: null, publishedBy: "" }
          : h,
      ),
    });
  }

  function remove(id: string) {
    commit({
      ...state,
      holidays: state.holidays.filter((h) => h.id !== id),
    });
  }

  const published = state.holidays.filter((h) => h.isPublished);
  const drafts = state.holidays.filter((h) => !h.isPublished);

  return (
    <MastersTabStack
      intro="Draft holidays, then publish. Published dates block class attendance marking."
      tables={
        <MastersTablesRow>
          <MastersTableCard title={`Published (${published.length})`}>
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {published.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {h.title}{" "}
                      <span className="text-[10px] font-medium uppercase text-[var(--muted)]">
                        {h.kind}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      {h.startsOn}
                      {h.endsOn !== h.startsOn ? ` → ${h.endsOn}` : ""} ·{" "}
                      {h.academicYearCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] font-semibold"
                    onClick={() => unpublish(h.id)}
                  >
                    Unpublish
                  </button>
                </li>
              ))}
              {published.length === 0 ? (
                <MastersEmptyRow label="No published holidays" />
              ) : null}
            </ul>
          </MastersTableCard>
          <MastersTableCard title={`Drafts (${drafts.length})`}>
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {drafts.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {h.title}{" "}
                      <span className="text-[10px] font-medium uppercase text-[var(--muted)]">
                        {h.kind}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      {h.startsOn}
                      {h.endsOn !== h.startsOn ? ` → ${h.endsOn}` : ""} ·{" "}
                      {h.academicYearCode}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1 text-[11px] font-semibold text-white"
                      onClick={() => publish(h.id)}
                    >
                      Publish
                    </button>
                    <RemoveControl
                      check={{
                        canRemove: true,
                        blockers: [],
                        confirmMessage: "Remove this holiday?",
                        suggestion: "",
                      }}
                      onRemove={() => remove(h.id)}
                    />
                  </div>
                </li>
              ))}
              {drafts.length === 0 ? (
                <MastersEmptyRow label="No drafts" />
              ) : null}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <MastersWorkCard title="Add draft holiday" hint="Working form">
          <div className="grid max-w-3xl gap-2 sm:grid-cols-5">
            <select
              className="field !py-1.5"
              value={ay}
              onChange={(e) => setAy(e.target.value)}
            >
              {state.academicYears.map((y) => (
                <option key={y.id} value={y.code}>
                  {y.code}
                </option>
              ))}
            </select>
            <input
              className="field !py-1.5"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="field !py-1.5"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
            <input
              className="field !py-1.5"
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
            <select
              className="field !py-1.5"
              value={kind}
              onChange={(e) => setKind(e.target.value as HolidayKind)}
            >
              {HOLIDAY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
            onClick={add}
          >
            Add draft holiday
          </button>
        </MastersWorkCard>
      }
    />
  );
}

export function StaffMastersPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [depCode, setDepCode] = useState("");
  const [depName, setDepName] = useState("");
  const [desCode, setDesCode] = useState("");
  const [desName, setDesName] = useState("");
  const [desDep, setDesDep] = useState("");
  const [empCode, setEmpCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [stream, setStream] = useState<StaffStream>("teaching");
  const [category, setCategory] = useState<StaffCategory>("permanent");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [mobile, setMobile] = useState("");

  function addDept() {
    if (!depCode.trim() || !depName.trim()) return;
    const row: Department = {
      id: newFoundationId("dep"),
      code: depCode.trim().toUpperCase(),
      name: depName.trim(),
      isActive: true,
    };
    commit(
      { ...state, departments: [...state.departments, row] },
      `Department ${row.code}`,
    );
    setDepCode("");
    setDepName("");
  }

  function addDes() {
    if (!desCode.trim() || !desName.trim()) return;
    const row: Designation = {
      id: newFoundationId("des"),
      code: desCode.trim().toUpperCase(),
      name: desName.trim(),
      departmentId: desDep || null,
      isActive: true,
    };
    commit(
      { ...state, designations: [...state.designations, row] },
      `Designation ${row.code}`,
    );
    setDesCode("");
    setDesName("");
  }

  function addStaff() {
    if (!empCode.trim() || !fullName.trim()) return;
    const row: StaffRecord = {
      id: newFoundationId("stf"),
      empCode: empCode.trim().toUpperCase(),
      fullName: fullName.trim(),
      stream,
      category,
      departmentId: departmentId || null,
      designationId: designationId || null,
      mobile: mobile.trim(),
      status: "active",
    };
    commit({ ...state, staff: [...state.staff, row] }, `Staff ${row.empCode}`);
    setEmpCode("");
    setFullName("");
    setMobile("");
  }

  return (
    <MastersTabStack
      tables={
        <MastersTablesRow cols={3}>
          <MastersTableCard title="Departments">
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {state.departments
                .filter((d) => d.isActive)
                .map((d) => (
                  <li key={d.id} className="px-4 py-2.5 text-sm">
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {d.code}
                    </span>{" "}
                    {d.name}
                  </li>
                ))}
              {state.departments.filter((d) => d.isActive).length === 0 ? (
                <MastersEmptyRow />
              ) : null}
            </ul>
          </MastersTableCard>
          <MastersTableCard title="Designations">
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {state.designations
                .filter((d) => d.isActive)
                .map((d) => {
                  const dep = state.departments.find(
                    (x) => x.id === d.departmentId,
                  );
                  return (
                    <li key={d.id} className="px-4 py-2 text-sm">
                      <span className="font-semibold">{d.code}</span> {d.name}
                      {dep ? (
                        <span className="ml-2 text-[11px] text-[var(--muted)]">
                          {dep.name}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </MastersTableCard>
          <MastersTableCard title="Staff roster">
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {state.staff.map((s) => {
                const dep = state.departments.find(
                  (d) => d.id === s.departmentId,
                );
                const des = state.designations.find(
                  (d) => d.id === s.designationId,
                );
                return (
                  <li key={s.id} className="px-4 py-2.5 text-sm">
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {s.empCode}
                    </span>{" "}
                    {s.fullName}
                    <span className="ml-2 text-[10px] uppercase text-[var(--muted)]">
                      {s.stream.replace("_", " ")}
                    </span>
                    <p className="text-[11px] text-[var(--muted)]">
                      {[des?.name, dep?.name, s.mobile]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </li>
                );
              })}
              {state.staff.length === 0 ? <MastersEmptyRow /> : null}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <div className="grid gap-4 lg:grid-cols-3">
          <MastersWorkCard title="Add department">
            <div className="flex flex-wrap gap-2">
              <input
                className="field !py-1.5 w-28"
                placeholder="Code"
                value={depCode}
                onChange={(e) => setDepCode(e.target.value)}
              />
              <input
                className="field !py-1.5 min-w-[8rem] flex-1"
                placeholder="Name"
                value={depName}
                onChange={(e) => setDepName(e.target.value)}
              />
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                onClick={addDept}
              >
                Add
              </button>
            </div>
          </MastersWorkCard>
          <MastersWorkCard title="Add designation">
            <div className="flex flex-wrap gap-2">
              <input
                className="field !py-1.5 w-28"
                placeholder="Code"
                value={desCode}
                onChange={(e) => setDesCode(e.target.value)}
              />
              <input
                className="field !py-1.5 min-w-[6rem] flex-1"
                placeholder="Name"
                value={desName}
                onChange={(e) => setDesName(e.target.value)}
              />
              <select
                className="field !py-1.5"
                value={desDep}
                onChange={(e) => setDesDep(e.target.value)}
              >
                <option value="">Dept…</option>
                {state.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                onClick={addDes}
              >
                Add
              </button>
            </div>
          </MastersWorkCard>
          <MastersWorkCard title="Add staff">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="field !py-1.5"
                placeholder="Emp code"
                value={empCode}
                onChange={(e) => setEmpCode(e.target.value)}
              />
              <input
                className="field !py-1.5"
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
              <input
                className="field !py-1.5"
                placeholder="Mobile"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
              <select
                className="field !py-1.5"
                value={stream}
                onChange={(e) => setStream(e.target.value as StaffStream)}
              >
                {STAFF_STREAMS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                className="field !py-1.5"
                value={category}
                onChange={(e) => setCategory(e.target.value as StaffCategory)}
              >
                {STAFF_CATEGORIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                className="field !py-1.5"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">Department…</option>
                {state.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                className="field !py-1.5 sm:col-span-2"
                value={designationId}
                onChange={(e) => setDesignationId(e.target.value)}
              >
                <option value="">Designation…</option>
                {state.designations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
              onClick={addStaff}
            >
              Add staff
            </button>
          </MastersWorkCard>
        </div>
      }
    />
  );
}
