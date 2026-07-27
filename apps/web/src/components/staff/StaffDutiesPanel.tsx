"use client";

import { useEffect, useMemo, useState } from "react";
import {
  STAFF_DUTY_ROLES,
  STAFF_VEHICLE_ROLES,
  newFoundationId,
  staffDutyCapabilities,
  type StaffClassTeacherLink,
  type StaffDutyLink,
  type StaffDutyRole,
  type StaffRecord,
  type StaffSubjectTeachingLink,
  type StaffVehicleLink,
  type StaffVehicleRole,
} from "@/lib/foundationMasters";
import { type MastersState } from "@/lib/masters";
import { loadTransport, type TransportRoute } from "@/lib/transport";
import { useDemoSession } from "@/components/shell/SessionContext";

type Props = {
  draft: StaffRecord;
  masters: MastersState;
  onChange: (patch: Partial<StaffRecord>) => void;
};

export function StaffDutiesPanel({ draft, masters, onChange }: Props) {
  const session = useDemoSession();
  const ay = session.academicYearCode;
  const caps = useMemo(
    () => staffDutyCapabilities(draft, masters),
    [draft, masters],
  );
  const routes = useMemo(() => {
    try {
      return loadTransport().routes.filter((r) => r.isActive);
    } catch {
      return [] as TransportRoute[];
    }
  }, []);

  const classes = masters.classes.filter((c) => c.isActive !== false);
  const subjects = masters.subjects.filter((s) => s.isActive && !s.parentId);

  const showClassTeacher =
    caps.classTeacher || draft.classTeacherLinks.length > 0;
  const showSubjects =
    caps.subjectTeaching || draft.subjectTeachingLinks.length > 0;
  const showVehicle = caps.vehicle || draft.vehicleLinks.length > 0;
  const showOther = caps.otherDuties || draft.dutyLinks.length > 0;

  const des = masters.designations.find((d) => d.id === draft.designationId);

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-[rgba(37,99,235,0.2)] bg-[#eff6ff] px-4 py-3">
        <p className="text-sm font-semibold text-[#1d4ed8]">{caps.label}</p>
        <p className="mt-0.5 text-[11px] text-[#1e3a8a]/80]">
          Based on stream
          {draft.stream === "teaching" ? " (teaching)" : " (non-teaching)"}
          {des ? ` · ${des.name}` : ""}
          {!draft.designationId
            ? " — set designation under Employment for smarter mapping"
            : ""}
          . Only relevant mappings are shown below.
        </p>
      </div>

      {!showClassTeacher &&
      !showSubjects &&
      !showVehicle &&
      !showOther ? (
        <p className="text-sm text-[var(--muted)]">
          Set stream and designation on the Employment tab to unlock duty
          mappings for this role.
        </p>
      ) : null}

      {showClassTeacher ? (
        <ClassTeacherSection
          draft={draft}
          masters={masters}
          classes={classes}
          ay={ay}
          onChange={onChange}
          readOnly={!caps.classTeacher}
        />
      ) : null}
      {showSubjects ? (
        <SubjectTeachingSection
          draft={draft}
          masters={masters}
          classes={classes}
          subjects={subjects}
          ay={ay}
          onChange={onChange}
          readOnly={!caps.subjectTeaching}
        />
      ) : null}
      {showVehicle ? (
        <VehicleSection
          draft={draft}
          routes={routes}
          ay={ay}
          onChange={onChange}
          preferredRole={caps.preferredVehicleRole}
          readOnly={!caps.vehicle}
        />
      ) : null}
      {showOther ? (
        <OtherDutiesSection
          draft={draft}
          ay={ay}
          onChange={onChange}
          readOnly={!caps.otherDuties}
        />
      ) : null}
    </div>
  );
}

function ClassTeacherSection({
  draft,
  masters,
  classes,
  ay,
  onChange,
  readOnly,
}: {
  draft: StaffRecord;
  masters: MastersState;
  classes: MastersState["classes"];
  ay: string;
  onChange: (patch: Partial<StaffRecord>) => void;
  readOnly?: boolean;
}) {
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [isPrimary, setIsPrimary] = useState(true);

  const sections = masters.sections.filter(
    (s) => s.classId === classId && s.isActive !== false,
  );

  function add() {
    if (readOnly || !classId || !sectionId) return;
    const row: StaffClassTeacherLink = {
      id: newFoundationId("sct"),
      classId,
      sectionId,
      academicYearCode: ay,
      isPrimary,
    };
    onChange({
      classTeacherLinks: [...draft.classTeacherLinks, row],
    });
    setSectionId("");
  }

  function remove(id: string) {
    onChange({
      classTeacherLinks: draft.classTeacherLinks.filter((x) => x.id !== id),
    });
  }

  return (
    <section>
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">
        Class teacher mapping
      </h3>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        {readOnly
          ? "Existing links (this role no longer uses class-teacher mapping)"
          : `Assign as class teacher / co-class teacher · ${ay}`}
      </p>
      {!readOnly ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Class
            <select
              className="field mt-1 !py-2"
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSectionId("");
              }}
            >
              <option value="">Select…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Section
            <select
              className="field mt-1 !py-2"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              <option value="">Select…</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs font-semibold text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            Primary class teacher
          </label>
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
            onClick={add}
          >
            Add
          </button>
        </div>
      ) : null}
      <ul className="mt-3 divide-y divide-[rgba(32,48,80,0.08)] rounded-xl border border-[rgba(32,48,80,0.1)]">
        {draft.classTeacherLinks.length === 0 ? (
          <li className="px-3 py-3 text-sm text-[var(--muted)]">
            No class-teacher links yet
          </li>
        ) : (
          draft.classTeacherLinks.map((link) => {
            const cls = masters.classes.find((c) => c.id === link.classId);
            const sec = masters.sections.find((s) => s.id === link.sectionId);
            return (
              <li
                key={link.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {cls?.name ?? "?"}–{sec?.name ?? "?"}
                  </span>
                  <span className="ml-2 text-[11px] text-[var(--muted)]">
                    {link.academicYearCode}
                    {link.isPrimary ? " · Primary" : " · Co-teacher"}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--danger)]"
                  onClick={() => remove(link.id)}
                >
                  Remove
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

function SubjectTeachingSection({
  draft,
  masters,
  classes,
  subjects,
  ay,
  onChange,
  readOnly,
}: {
  draft: StaffRecord;
  masters: MastersState;
  classes: MastersState["classes"];
  subjects: MastersState["subjects"];
  ay: string;
  onChange: (patch: Partial<StaffRecord>) => void;
  readOnly?: boolean;
}) {
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [periods, setPeriods] = useState("5");

  const sections = masters.sections.filter(
    (s) => s.classId === classId && s.isActive !== false,
  );

  const subjectOptions = useMemo(() => {
    const linked = new Set(
      (masters.classSubjects ?? [])
        .filter((l) => l.classId === classId && l.isActive)
        .map((l) => l.subjectId),
    );
    if (linked.size === 0) return subjects;
    return subjects.filter((s) => linked.has(s.id));
  }, [masters.classSubjects, classId, subjects]);

  function add() {
    if (readOnly || !classId || !subjectId) return;
    const row: StaffSubjectTeachingLink = {
      id: newFoundationId("sst"),
      classId,
      sectionId: sectionId || null,
      subjectId,
      academicYearCode: ay,
      periodsPerWeek: Math.max(0, Number(periods) || 0),
    };
    onChange({
      subjectTeachingLinks: [...draft.subjectTeachingLinks, row],
    });
  }

  function remove(id: string) {
    onChange({
      subjectTeachingLinks: draft.subjectTeachingLinks.filter(
        (x) => x.id !== id,
      ),
    });
  }

  return (
    <section>
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">
        Class–subject teaching
      </h3>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        {readOnly
          ? "Existing links (this role no longer uses subject teaching)"
          : `Map class / section / subject this teacher takes · ${ay}`}
      </p>
      {!readOnly ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Class
            <select
              className="field mt-1 !py-2"
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSectionId("");
                setSubjectId("");
              }}
            >
              <option value="">Select…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Section (optional)
            <select
              className="field mt-1 !py-2"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              <option value="">All sections</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Subject
            <select
              className="field mt-1 !py-2"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">Select…</option>
              {subjectOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Periods / week
            <input
              className="field mt-1 w-20 !py-2"
              value={periods}
              onChange={(e) => setPeriods(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
            onClick={add}
          >
            Add
          </button>
        </div>
      ) : null}
      <ul className="mt-3 divide-y divide-[rgba(32,48,80,0.08)] rounded-xl border border-[rgba(32,48,80,0.1)]">
        {draft.subjectTeachingLinks.length === 0 ? (
          <li className="px-3 py-3 text-sm text-[var(--muted)]">
            No subject teaching links yet
          </li>
        ) : (
          draft.subjectTeachingLinks.map((link) => {
            const cls = masters.classes.find((c) => c.id === link.classId);
            const sec = link.sectionId
              ? masters.sections.find((s) => s.id === link.sectionId)
              : null;
            const sub = masters.subjects.find((s) => s.id === link.subjectId);
            return (
              <li
                key={link.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {sub?.nameEn ?? "Subject"}
                  </span>
                  <span className="ml-2 text-[11px] text-[var(--muted)]">
                    {cls?.name ?? "?"}
                    {sec ? `–${sec.name}` : " (all sections)"} ·{" "}
                    {link.periodsPerWeek} ppw · {link.academicYearCode}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--danger)]"
                  onClick={() => remove(link.id)}
                >
                  Remove
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

function VehicleSection({
  draft,
  routes,
  ay,
  onChange,
  preferredRole,
  readOnly,
}: {
  draft: StaffRecord;
  routes: TransportRoute[];
  ay: string;
  onChange: (patch: Partial<StaffRecord>) => void;
  preferredRole: StaffVehicleRole;
  readOnly?: boolean;
}) {
  const [routeId, setRouteId] = useState("");
  const [role, setRole] = useState<StaffVehicleRole>(preferredRole);
  const [from, setFrom] = useState("");

  useEffect(() => {
    setRole(preferredRole);
  }, [preferredRole]);

  function add() {
    if (readOnly || !routeId) return;
    const row: StaffVehicleLink = {
      id: newFoundationId("svh"),
      routeId,
      role,
      academicYearCode: ay,
      effectiveFrom: from,
      effectiveTo: null,
    };
    onChange({ vehicleLinks: [...draft.vehicleLinks, row] });
  }

  function remove(id: string) {
    onChange({
      vehicleLinks: draft.vehicleLinks.filter((x) => x.id !== id),
    });
  }

  const roleOptions =
    preferredRole === "driver"
      ? STAFF_VEHICLE_ROLES.filter((r) => r.value === "driver")
      : preferredRole === "attendant"
        ? STAFF_VEHICLE_ROLES.filter(
            (r) =>
              r.value === "attendant" ||
              r.value === "helper" ||
              r.value === "conductor",
          )
        : STAFF_VEHICLE_ROLES;

  return (
    <section>
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">
        {preferredRole === "driver"
          ? "Vehicle mapping (driver)"
          : preferredRole === "attendant"
            ? "Vehicle mapping (attendant)"
            : "Vehicle mapping"}
      </h3>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        {readOnly
          ? "Existing links (this role no longer uses vehicle mapping)"
          : "Link to a transport route / bus · set up routes under Transport first"}
      </p>
      {!readOnly ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Route / bus
            <select
              className="field mt-1 !py-2"
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
            >
              <option value="">Select…</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.name}
                  {r.busNo ? ` · Bus ${r.busNo}` : ""}
                  {r.vehicleReg ? ` · ${r.vehicleReg}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Role
            <select
              className="field mt-1 !py-2"
              value={role}
              onChange={(e) => setRole(e.target.value as StaffVehicleRole)}
            >
              {roleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            From
            <input
              type="date"
              className="field mt-1 !py-2"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            disabled={routes.length === 0}
            onClick={add}
          >
            Add
          </button>
        </div>
      ) : null}
      {routes.length === 0 && !readOnly ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          No active transport routes yet. Add buses under Transport, then map
          here.
        </p>
      ) : null}
      <ul className="mt-3 divide-y divide-[rgba(32,48,80,0.08)] rounded-xl border border-[rgba(32,48,80,0.1)]">
        {draft.vehicleLinks.length === 0 ? (
          <li className="px-3 py-3 text-sm text-[var(--muted)]">
            No vehicle links yet
          </li>
        ) : (
          draft.vehicleLinks.map((link) => {
            const route = routes.find((r) => r.id === link.routeId);
            const roleLabel =
              STAFF_VEHICLE_ROLES.find((r) => r.value === link.role)?.label ??
              link.role;
            return (
              <li
                key={link.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {roleLabel}
                  </span>
                  <span className="ml-2 text-[11px] text-[var(--muted)]">
                    {route
                      ? `${route.code} · ${route.name}${route.busNo ? ` · Bus ${route.busNo}` : ""}`
                      : "Route removed"}
                    {link.effectiveFrom ? ` · from ${link.effectiveFrom}` : ""}
                    · {link.academicYearCode}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--danger)]"
                  onClick={() => remove(link.id)}
                >
                  Remove
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

function OtherDutiesSection({
  draft,
  ay,
  onChange,
  readOnly,
}: {
  draft: StaffRecord;
  ay: string;
  onChange: (patch: Partial<StaffRecord>) => void;
  readOnly?: boolean;
}) {
  const [role, setRole] = useState<StaffDutyRole>("lab_incharge");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");

  function add() {
    if (readOnly) return;
    const row: StaffDutyLink = {
      id: newFoundationId("sdy"),
      role,
      label:
        role === "other"
          ? label.trim() || "Other duty"
          : STAFF_DUTY_ROLES.find((r) => r.value === role)?.label ?? role,
      academicYearCode: ay,
      notes: notes.trim(),
    };
    onChange({ dutyLinks: [...draft.dutyLinks, row] });
    setNotes("");
    setLabel("");
  }

  function remove(id: string) {
    onChange({
      dutyLinks: draft.dutyLinks.filter((x) => x.id !== id),
    });
  }

  return (
    <section>
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">
        Other school duties
      </h3>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        {readOnly
          ? "Existing links"
          : "Lab, library, hostel, exams, sports, discipline, and custom roles"}
      </p>
      {!readOnly ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Duty
            <select
              className="field mt-1 !py-2"
              value={role}
              onChange={(e) => setRole(e.target.value as StaffDutyRole)}
            >
              {STAFF_DUTY_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {role === "other" ? (
            <label className="text-xs font-semibold text-[var(--muted)]">
              Label
              <input
                className="field mt-1 !py-2"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
          ) : null}
          <label className="min-w-[12rem] flex-1 text-xs font-semibold text-[var(--muted)]">
            Notes
            <input
              className="field mt-1 w-full !py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
            onClick={add}
          >
            Add
          </button>
        </div>
      ) : null}
      <ul className="mt-3 divide-y divide-[rgba(32,48,80,0.08)] rounded-xl border border-[rgba(32,48,80,0.1)]">
        {draft.dutyLinks.length === 0 ? (
          <li className="px-3 py-3 text-sm text-[var(--muted)]">
            No extra duties yet
          </li>
        ) : (
          draft.dutyLinks.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span>
                <span className="font-semibold text-[var(--brand-deep)]">
                  {link.label}
                </span>
                <span className="ml-2 text-[11px] text-[var(--muted)]">
                  {link.academicYearCode}
                  {link.notes ? ` · ${link.notes}` : ""}
                </span>
              </span>
              <button
                type="button"
                className="text-xs font-semibold text-[var(--danger)]"
                onClick={() => remove(link.id)}
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
