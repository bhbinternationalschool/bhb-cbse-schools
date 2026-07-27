"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SIS_MATCH_KIND_LABELS,
  buildSisMismatchDetails,
  type LeadSisMatchKind,
} from "@/lib/admissionsSisReconcile";
import type { AdmissionLead } from "@/lib/admissions";
import type { MastersState } from "@/lib/masters";
import type { SisState, SisStudent } from "@/lib/sis";
import {
  LeadTagListActions,
  type LeadTagListActionHandlers,
} from "@/components/admissions/LeadTagListActions";

type MatchFilter =
  | "all"
  | `kind:${string}`
  | "status:active"
  | "status:inactive"
  | "mismatch:child"
  | "mismatch:guardian"
  | "mismatch:mobile"
  | "mismatch:year"
  | "mismatch:sibling";

const KIND_ORDER: LeadSisMatchKind[] = [
  "mobile_and_child_name",
  "child_and_guardian_name",
  "family_mobile_only",
  "child_name_only",
];

function classSectionLabel(
  student: SisStudent | undefined,
  masters: MastersState | null,
): string {
  if (!student) return "—";
  const cls =
    masters?.classes.find((c) => c.id === student.classId)?.name || "—";
  const sec =
    masters?.sections.find((s) => s.id === student.sectionId)?.name || "";
  return sec ? `${cls} · ${sec}` : cls;
}

function mismatchLines(
  lead: AdmissionLead,
  student: SisStudent | undefined,
  masters: MastersState | null,
): string[] {
  if (lead.sisMismatchNotes.length) return lead.sisMismatchNotes;
  if (!student) return lead.sisStudentInfo ? [lead.sisStudentInfo] : [];
  const kind = (lead.sisMatchKind || "family_mobile_only") as LeadSisMatchKind;
  return buildSisMismatchDetails(
    lead,
    student,
    kind,
    classSectionLabel(student, masters),
  );
}

/** Only leads whose linked SIS student still exists in the register. */
function leadsWithRealSisStudent(
  leads: AdmissionLead[],
  sis: SisState,
  match: "admitted" | "suspected",
): AdmissionLead[] {
  return leads.filter((l) => {
    if (l.sisMatch !== match) return false;
    const sid = l.sisStudentId || l.studentId;
    if (!sid) return false;
    return sis.students.some((s) => s.id === sid);
  });
}

function leadHasMismatch(lead: AdmissionLead, key: string): boolean {
  const notes = lead.sisMismatchNotes.join(" ").toLowerCase();
  switch (key) {
    case "child":
      return /child name differs/.test(notes);
    case "guardian":
      return /guardian differs|mother differs/.test(notes);
    case "mobile":
      return /mobile differs|no mobile on sis/.test(notes);
    case "year":
      return /year differs/.test(notes);
    case "sibling":
      return /likely sibling|family mobile/.test(notes) ||
        lead.sisMatchKind === "family_mobile_only";
    default:
      return false;
  }
}

function filterLeads(
  leads: AdmissionLead[],
  filter: MatchFilter,
): AdmissionLead[] {
  if (filter === "all") return leads;
  if (filter.startsWith("kind:")) {
    const kind = filter.slice(5);
    return leads.filter((l) => (l.sisMatchKind || "") === kind);
  }
  if (filter === "status:active") {
    return leads.filter((l) => l.sisStudentStatus !== "inactive");
  }
  if (filter === "status:inactive") {
    return leads.filter((l) => l.sisStudentStatus === "inactive");
  }
  if (filter.startsWith("mismatch:")) {
    return leads.filter((l) => leadHasMismatch(l, filter.slice(9)));
  }
  return leads;
}

type FilterChip = {
  id: MatchFilter;
  label: string;
  count: number;
  tone: "neutral" | "green" | "amber" | "slate" | "red";
};

function buildFilterChips(leads: AdmissionLead[]): FilterChip[] {
  const chips: FilterChip[] = [];
  if (!leads.length) return chips;

  chips.push({
    id: "all",
    label: `All · ${leads.length}`,
    count: leads.length,
    tone: "neutral",
  });

  for (const kind of KIND_ORDER) {
    const n = leads.filter((l) => l.sisMatchKind === kind).length;
    if (!n) continue;
    chips.push({
      id: `kind:${kind}`,
      label: `${SIS_MATCH_KIND_LABELS[kind]} · ${n}`,
      count: n,
      tone: kind.includes("only") ? "amber" : "green",
    });
  }

  // Any unexpected kind strings still get a chip
  const known = new Set<string>(KIND_ORDER);
  const extraKinds = new Set(
    leads
      .map((l) => l.sisMatchKind)
      .filter((k) => k && !known.has(k)),
  );
  for (const kind of extraKinds) {
    const n = leads.filter((l) => l.sisMatchKind === kind).length;
    if (!n) continue;
    chips.push({
      id: `kind:${kind}`,
      label: `${kind} · ${n}`,
      count: n,
      tone: "amber",
    });
  }

  const activeN = leads.filter((l) => l.sisStudentStatus !== "inactive").length;
  const inactiveN = leads.filter((l) => l.sisStudentStatus === "inactive").length;
  if (activeN) {
    chips.push({
      id: "status:active",
      label: `SIS Active · ${activeN}`,
      count: activeN,
      tone: "green",
    });
  }
  if (inactiveN) {
    chips.push({
      id: "status:inactive",
      label: `SIS Inactive · ${inactiveN}`,
      count: inactiveN,
      tone: "slate",
    });
  }

  const mismatchDefs: { key: string; label: string; tone: FilterChip["tone"] }[] =
    [
      { key: "child", label: "Child name differs", tone: "amber" },
      { key: "guardian", label: "Guardian differs", tone: "amber" },
      { key: "mobile", label: "Mobile differs", tone: "amber" },
      { key: "year", label: "Year differs", tone: "amber" },
      { key: "sibling", label: "Likely sibling", tone: "red" },
    ];
  for (const m of mismatchDefs) {
    const n = leads.filter((l) => leadHasMismatch(l, m.key)).length;
    if (!n) continue;
    chips.push({
      id: `mismatch:${m.key}` as MatchFilter,
      label: `${m.label} · ${n}`,
      count: n,
      tone: m.tone,
    });
  }

  return chips;
}

function chipClass(active: boolean, tone: FilterChip["tone"]): string {
  if (active) {
    switch (tone) {
      case "green":
        return "bg-[#166534] text-white";
      case "amber":
        return "bg-[#9a3412] text-white";
      case "slate":
        return "bg-[#334155] text-white";
      case "red":
        return "bg-[#b42318] text-white";
      default:
        return "bg-[var(--brand-deep)] text-white";
    }
  }
  switch (tone) {
    case "green":
      return "bg-[rgba(21,128,61,0.12)] text-[#166534] hover:brightness-95";
    case "amber":
      return "bg-[rgba(180,83,9,0.12)] text-[#9a3412] hover:brightness-95";
    case "slate":
      return "bg-[rgba(71,85,105,0.12)] text-[#334155] hover:brightness-95";
    case "red":
      return "bg-[rgba(180,35,24,0.1)] text-[#b42318] hover:brightness-95";
    default:
      return "bg-[rgba(32,48,80,0.06)] text-[var(--muted)] hover:brightness-95";
  }
}

export function AdmissionSisMatchLists({
  leads,
  sis,
  masters,
  openPanel,
  onTogglePanel,
  actions,
}: {
  leads: AdmissionLead[];
  sis: SisState;
  masters: MastersState | null;
  openPanel: "" | "admitted" | "suspected";
  onTogglePanel: (panel: "" | "admitted" | "suspected") => void;
  actions: LeadTagListActionHandlers;
}) {
  const admitted = useMemo(
    () => leadsWithRealSisStudent(leads, sis, "admitted"),
    [leads, sis],
  );
  const suspected = useMemo(
    () => leadsWithRealSisStudent(leads, sis, "suspected"),
    [leads, sis],
  );

  const [admittedFilter, setAdmittedFilter] = useState<MatchFilter>("all");
  const [suspectedFilter, setSuspectedFilter] = useState<MatchFilter>("all");

  // Reset / clamp filter when panel opens or available chips change
  useEffect(() => {
    if (openPanel !== "admitted") setAdmittedFilter("all");
  }, [openPanel]);
  useEffect(() => {
    if (openPanel !== "suspected") setSuspectedFilter("all");
  }, [openPanel]);

  const admittedChips = useMemo(() => buildFilterChips(admitted), [admitted]);
  const suspectedChips = useMemo(
    () => buildFilterChips(suspected),
    [suspected],
  );

  useEffect(() => {
    if (
      admittedFilter !== "all" &&
      !admittedChips.some((c) => c.id === admittedFilter)
    ) {
      setAdmittedFilter("all");
    }
  }, [admittedChips, admittedFilter]);
  useEffect(() => {
    if (
      suspectedFilter !== "all" &&
      !suspectedChips.some((c) => c.id === suspectedFilter)
    ) {
      setSuspectedFilter("all");
    }
  }, [suspectedChips, suspectedFilter]);

  if (!admitted.length && !suspected.length) return null;

  const admittedShown = filterLeads(admitted, admittedFilter);
  const suspectedShown = filterLeads(suspected, suspectedFilter);

  return (
    <div className="space-y-2 rounded-xl border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.05)] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          SIS match tags
        </span>
        {admitted.length ? (
          <button
            type="button"
            onClick={() =>
              onTogglePanel(openPanel === "admitted" ? "" : "admitted")
            }
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              openPanel === "admitted"
                ? "bg-[#166534] text-white"
                : "bg-[rgba(21,128,61,0.15)] text-[#166534] hover:brightness-95"
            }`}
          >
            Admitted in SIS · {admitted.length}
            <span className="ml-1 opacity-80">
              {openPanel === "admitted" ? "▴" : "▾"}
            </span>
          </button>
        ) : null}
        {suspected.length ? (
          <button
            type="button"
            onClick={() =>
              onTogglePanel(openPanel === "suspected" ? "" : "suspected")
            }
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              openPanel === "suspected"
                ? "bg-[#9a3412] text-white"
                : "bg-[rgba(180,83,9,0.14)] text-[#9a3412] hover:brightness-95"
            }`}
          >
            Suspected in SIS · {suspected.length}
            <span className="ml-1 opacity-80">
              {openPanel === "suspected" ? "▴" : "▾"}
            </span>
          </button>
        ) : null}
      </div>

      {openPanel === "admitted" && admitted.length ? (
        <MatchListBody
          title="Leads confirmed in student register — full actions on each row"
          empty="No admitted SIS matches for this filter."
          leads={admittedShown}
          chips={admittedChips}
          filter={admittedFilter}
          onFilter={setAdmittedFilter}
          sis={sis}
          masters={masters}
          mode="admitted"
          actions={actions}
        />
      ) : null}

      {openPanel === "suspected" && suspected.length ? (
        <MatchListBody
          title="Possible SIS matches — tap a tag to filter; every row has all actions"
          empty="No suspected SIS matches for this filter."
          leads={suspectedShown}
          chips={suspectedChips}
          filter={suspectedFilter}
          onFilter={setSuspectedFilter}
          sis={sis}
          masters={masters}
          mode="suspected"
          actions={actions}
        />
      ) : null}
    </div>
  );
}

function MatchListBody({
  title,
  empty,
  leads,
  chips,
  filter,
  onFilter,
  sis,
  masters,
  mode,
  actions,
}: {
  title: string;
  empty: string;
  leads: AdmissionLead[];
  chips: FilterChip[];
  filter: MatchFilter;
  onFilter: (f: MatchFilter) => void;
  sis: SisState;
  masters: MastersState | null;
  mode: "admitted" | "suspected";
  actions: LeadTagListActionHandlers;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-[rgba(32,48,80,0.1)] bg-white p-2">
      <p className="px-1 text-[11px] font-semibold text-[var(--brand-deep)]">
        {title}
      </p>

      {chips.length > 1 ? (
        <div className="flex flex-wrap gap-1.5 px-1">
          <span className="w-full text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Matching tags (only conditions with students)
          </span>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => onFilter(chip.id)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${chipClass(
                filter === chip.id,
                chip.tone,
              )}`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      {!leads.length ? (
        <p className="px-1 text-[11px] text-[var(--muted)]">{empty}</p>
      ) : (
        <ul className="max-h-[24rem] space-y-2 overflow-y-auto">
          {leads.map((lead) => {
            const sid = lead.sisStudentId || lead.studentId;
            const student = sis.students.find((s) => s.id === sid);
            if (!student) return null;
            const classLabel = classSectionLabel(student, masters);
            const kindLabel =
              SIS_MATCH_KIND_LABELS[
                (lead.sisMatchKind || "") as LeadSisMatchKind
              ] ||
              lead.sisMatchKind ||
              "—";
            const notes = mismatchLines(lead, student, masters);
            const studentName = student.fullName || lead.childName;

            return (
              <li
                key={lead.id}
                className="rounded-lg border border-[rgba(32,48,80,0.1)] px-2.5 py-2 text-[12px]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <button
                        type="button"
                        className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                        onClick={() => actions.onOpenLead(lead.id)}
                      >
                        {lead.childName}
                      </button>
                      <span className="font-mono text-[10px] text-[var(--muted)]">
                        {lead.enquiryNo}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                          lead.sisStudentStatus === "inactive"
                            ? "bg-[rgba(71,85,105,0.15)] text-[#334155]"
                            : "bg-[rgba(21,128,61,0.12)] text-[#166534]"
                        }`}
                      >
                        {lead.sisStudentStatus === "inactive"
                          ? "Inactive"
                          : "Active"}
                      </span>
                      {kindLabel !== "—" ? (
                        <span className="rounded-full bg-[rgba(180,83,9,0.1)] px-1.5 py-0.5 text-[9px] font-semibold text-[#9a3412]">
                          {kindLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                      Lead AY {lead.academicYearCode || "—"} ·{" "}
                      {(lead.leadDate || "").slice(0, 10) || "no date"} ·{" "}
                      {lead.guardianName || "—"} · {lead.mobile || "—"}
                    </div>
                  </div>
                </div>

                <div className="mt-2 rounded-md bg-[rgba(15,118,110,0.06)] px-2 py-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#0f766e]">
                      SIS student
                    </span>
                    {actions.onOpenStudent ? (
                      <button
                        type="button"
                        className="font-semibold text-[#0f766e] underline-offset-2 hover:underline"
                        onClick={() => actions.onOpenStudent!(sid)}
                        title="Open student details"
                      >
                        {studentName}
                      </button>
                    ) : (
                      <span className="font-semibold">{studentName}</span>
                    )}
                    <span className="font-mono text-[10px] text-[var(--muted)]">
                      Adm {student.admissionNo || lead.admissionNo || "—"}
                    </span>
                  </div>
                  <div className="mt-0.5 grid gap-0.5 text-[11px] text-[var(--brand-deep)] sm:grid-cols-3">
                    <div>
                      Session{" "}
                      <strong>{student.academicYearCode || "—"}</strong>
                    </div>
                    <div>
                      Class <strong>{classLabel}</strong>
                    </div>
                    <div>
                      Reason <strong>{kindLabel}</strong>
                    </div>
                  </div>
                </div>

                {mode === "suspected" ||
                notes.some((n) => /differ/i.test(n)) ? (
                  <div className="mt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9a3412]">
                      {mode === "suspected"
                        ? "Mismatch / compare details"
                        : "Match details"}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--brand-deep)]">
                      {notes.map((n) => (
                        <li
                          key={n}
                          className={
                            /differ|collision|Likely sibling|confirm mobile/i.test(
                              n,
                            )
                              ? "text-[#9a3412]"
                              : ""
                          }
                        >
                          · {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <LeadTagListActions lead={lead} handlers={actions} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Inline card for a single lead's SIS suspect / admitted details. */
export function LeadSisMatchDetailCard({
  lead,
  sis,
  masters,
  actions,
}: {
  lead: AdmissionLead;
  sis: SisState;
  masters: MastersState | null;
  actions: LeadTagListActionHandlers;
}) {
  if (!lead.sisMatch) return null;
  const sid = lead.sisStudentId || lead.studentId;
  const student = sis.students.find((s) => s.id === sid);
  // Hide card if tagged but SIS student no longer exists
  if (!student) return null;
  const classLabel = classSectionLabel(student, masters);
  const notes = mismatchLines(lead, student, masters);
  const studentName = student.fullName || "SIS student";
  const kindLabel =
    SIS_MATCH_KIND_LABELS[(lead.sisMatchKind || "") as LeadSisMatchKind] ||
    lead.sisMatchKind ||
    "—";

  const border =
    lead.sisMatch === "admitted"
      ? "border-[rgba(21,128,61,0.35)] bg-[rgba(21,128,61,0.08)]"
      : "border-[rgba(180,83,9,0.35)] bg-[rgba(180,83,9,0.08)]";

  return (
    <div className={`mt-3 rounded-xl border px-3 py-2.5 text-[12px] ${border}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={`font-semibold ${
            lead.sisMatch === "admitted" ? "text-[#166534]" : "text-[#9a3412]"
          }`}
        >
          {lead.sisMatch === "admitted"
            ? "Matched in SIS — Admitted"
            : "Suspected in SIS — review before admitting"}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            lead.sisStudentStatus === "inactive"
              ? "bg-[rgba(71,85,105,0.15)] text-[#334155]"
              : "bg-[rgba(21,128,61,0.15)] text-[#166534]"
          }`}
        >
          {lead.sisStudentStatus === "inactive" ? "Inactive" : "Active"}
        </span>
      </div>

      <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-[10px] text-[var(--muted)]">SIS student</div>
          {actions.onOpenStudent ? (
            <button
              type="button"
              className="font-semibold text-[#0f766e] underline-offset-2 hover:underline"
              onClick={() => actions.onOpenStudent!(sid)}
            >
              {studentName}
            </button>
          ) : (
            <div className="font-semibold">{studentName}</div>
          )}
        </div>
        <div>
          <div className="text-[10px] text-[var(--muted)]">Admission no.</div>
          <div className="font-mono font-medium">
            {student.admissionNo || lead.admissionNo || "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[var(--muted)]">
            Admission / session year
          </div>
          <div className="font-medium">
            {student.academicYearCode || lead.academicYearCode || "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[var(--muted)]">Current class</div>
          <div className="font-medium">{classLabel}</div>
        </div>
      </div>

      <div className="mt-1 text-[11px] text-[var(--muted)]">
        Match reason: {kindLabel}
        {student.joinedOn
          ? ` · Joined ${(student.joinedOn || "").slice(0, 10)}`
          : ""}
      </div>

      {notes.length ? (
        <div className="mt-2 border-t border-[rgba(32,48,80,0.1)] pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {lead.sisMatch === "suspected"
              ? "Mismatching / compare details"
              : "Match details"}
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {notes.map((n) => (
              <li
                key={n}
                className={
                  /differ|collision|Likely sibling|confirm mobile/i.test(n)
                    ? "text-[#9a3412]"
                    : "text-[var(--brand-deep)]"
                }
              >
                · {n}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <LeadTagListActions lead={lead} handlers={actions} />
    </div>
  );
}
