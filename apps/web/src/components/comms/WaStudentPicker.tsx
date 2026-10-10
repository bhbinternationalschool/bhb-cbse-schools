"use client";

import { useEffect, useMemo, useState } from "react";
import { loadSis, type SisStudent } from "@/lib/sis";
import { ensureSisHydrated } from "@/lib/sisPersistence";
import { loadMasters, currentAcademicYearCode } from "@/lib/masters";
import { field } from "@/components/ui/erp-ui";

/**
 * Tick the students to message.
 *
 * Two things the office needs that a plain filtered list does not give:
 *
 *   1. Ticks SURVIVE the filter. Picking three children from Class V, then
 *      switching to Class VI to pick two more, must not quietly drop the
 *      first three — so the selection is held by id, independent of what is
 *      currently on screen, and shown as a running count with a way to see
 *      and remove each one.
 *   2. It says out loud that siblings collapse. Tick three children of one
 *      family and the send reaches ONE number; without saying so, "3
 *      selected → 1 recipient" on the check step reads like a bug.
 */
export function WaStudentPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [showPicked, setShowPicked] = useState(false);

  useEffect(() => {
    void (async () => {
      await ensureSisHydrated().catch(() => false);
      setReady(true);
    })();
  }, []);

  const masters = useMemo(() => (ready ? loadMasters() : null), [ready]);
  const sis = useMemo(() => (ready ? loadSis() : null), [ready]);
  const ay = useMemo(
    () => (masters ? currentAcademicYearCode(masters) : ""),
    [masters],
  );

  const classOf = useMemo(() => {
    const classes = new Map(
      (masters?.classes ?? []).map((c) => [c.id, c.name]),
    );
    const sections = new Map(
      (masters?.sections ?? []).map((s) => [s.id, s.name]),
    );
    return (s: SisStudent) =>
      [classes.get(s.classId), sections.get(s.sectionId)]
        .filter(Boolean)
        .join("-") || "—";
  }, [masters]);

  const active = useMemo(
    () =>
      (sis?.students ?? []).filter(
        (s) => s.status === "active" && (!ay || s.academicYearCode === ay),
      ),
    [sis, ay],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return active
      .filter((s) => {
        if (classId && s.classId !== classId) return false;
        if (sectionId && s.sectionId !== sectionId) return false;
        if (!needle) return true;
        return (
          s.fullName.toLowerCase().includes(needle) ||
          (s.admissionNo || "").toLowerCase().includes(needle) ||
          (s.fatherName || "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, 300);
  }, [active, q, classId, sectionId]);

  const picked = useMemo(() => {
    const want = new Set(selected);
    return active.filter((s) => want.has(s.id));
  }, [active, selected]);

  // Siblings share one WhatsApp number, so this is the number of messages —
  // not the number of ticks.
  const householdCount = useMemo(
    () => new Set(picked.map((s) => s.householdId || s.id)).size,
    [picked],
  );

  const has = (id: string) => selected.includes(id);
  const toggle = (id: string) =>
    onChange(has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const shownIds = shown.map((s) => s.id);
  const allShownPicked =
    shownIds.length > 0 && shownIds.every((id) => selected.includes(id));

  if (!ready) {
    return (
      <p className="text-[11px] text-[var(--muted)]">Loading the roster…</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Search
          <input
            className={`${field} mt-1`}
            placeholder="Name, admission no, father…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Class
          <select
            className={`${field} mt-1`}
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setSectionId("");
            }}
          >
            <option value="">All classes</option>
            {(masters?.classes ?? [])
              .filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Section
          <select
            className={`${field} mt-1`}
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            disabled={!classId}
          >
            <option value="">All sections</option>
            {(masters?.sections ?? [])
              .filter((s) => s.isActive && s.classId === classId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <button
          type="button"
          className="rounded-md bg-[var(--surface-sunken)] px-2.5 py-1 font-semibold text-[var(--brand-deep)]"
          disabled={!shown.length}
          onClick={() =>
            onChange(
              allShownPicked
                ? selected.filter((id) => !shownIds.includes(id))
                : [...new Set([...selected, ...shownIds])],
            )
          }
        >
          {allShownPicked
            ? `Untick these ${shown.length}`
            : `Tick these ${shown.length}`}
        </button>
        {selected.length ? (
          <>
            <button
              type="button"
              className="rounded-md bg-[var(--surface-sunken)] px-2.5 py-1 font-semibold text-[var(--brand-deep)]"
              onClick={() => setShowPicked((v) => !v)}
            >
              {showPicked ? "Hide picked" : `Show picked (${selected.length})`}
            </button>
            <button
              type="button"
              className="rounded-md border border-rose-300 px-2.5 py-1 font-semibold text-rose-800"
              onClick={() => onChange([])}
            >
              Clear all
            </button>
          </>
        ) : null}
        <span className="text-[var(--muted)]">
          {selected.length} ticked
          {selected.length ? ` · ${householdCount} message${householdCount === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      {selected.length > householdCount ? (
        <p className="rounded-md bg-[rgba(71,85,105,0.08)] px-2 py-1 text-[10px] text-[var(--tone-slate)]">
          {selected.length} children in {householdCount} families — siblings
          share one WhatsApp number, so one message per family.
        </p>
      ) : null}

      {showPicked && picked.length ? (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-2">
          <div className="flex flex-wrap gap-1.5">
            {picked.map((s) => (
              <button
                key={s.id}
                type="button"
                title="Remove"
                onClick={() => toggle(s.id)}
                className="rounded-md bg-[var(--card)] px-2 py-1 text-[10px] font-medium text-[var(--brand-deep)]"
              >
                {s.fullName} · {classOf(s)} ✕
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)]">
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-[var(--muted)]">
            No active student matches that.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {shown.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12px] hover:bg-[var(--surface-sunken)]">
                  <input
                    type="checkbox"
                    checked={has(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                  <span className="font-medium text-[var(--brand-deep)]">
                    {s.fullName}
                  </span>
                  <span className="text-[var(--muted)]">
                    {classOf(s)}
                    {s.admissionNo ? ` · ${s.admissionNo}` : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {active.length > shown.length && !q && !classId ? (
        <p className="text-[10px] text-[var(--muted)]">
          Showing the first {shown.length} of {active.length}. Narrow by class
          or search to see the rest — ticks you have already made are kept.
        </p>
      ) : null}
    </div>
  );
}
