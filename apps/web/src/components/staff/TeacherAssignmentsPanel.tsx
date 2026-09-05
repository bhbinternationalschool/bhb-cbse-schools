"use client";
// ratchet-allow: grids_without_row_menu — assignment summary rows carry no teacher id; edited on the Teaching allocation screen

import { useMemo, useState } from "react";
import type { MastersState } from "@/lib/masters";
import { listTeachingAssignments } from "@/lib/staffResolve";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { field } from "@/components/ui/erp-ui";

/**
 * "Who teaches this class/subject?" lookup — the assignment data has always
 * existed (StaffRecord.classTeacherLinks / subjectTeachingLinks) but only
 * ever showed one class-section or one staff member at a time. This
 * flattens all of it into one searchable table.
 *
 * Takes `masters` from the parent rather than calling loadMasters() itself
 * — staff records hydrate from Supabase asynchronously after first mount
 * (see StaffWorkspace's ensureStaffHydrated effect), and a local
 * loadMasters() call here would race ahead of that and read stale/empty
 * data on a fresh page load.
 */
export function TeacherAssignmentsPanel({
  masters,
  ay,
}: {
  masters: MastersState;
  ay: string;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "class_teacher" | "subject_teacher">(
    "all",
  );

  const rows = useMemo(
    () => listTeachingAssignments(masters, ay),
    [masters, ay],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (!q) return true;
      return (
        r.className.toLowerCase().includes(q) ||
        r.sectionName.toLowerCase().includes(q) ||
        (r.subjectName ?? "").toLowerCase().includes(q) ||
        r.teacherName.toLowerCase().includes(q)
      );
    });
  }, [rows, query, kind]);

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[var(--muted)]">
        Search by class, section, subject, or teacher name — e.g. type
        &ldquo;XI&rdquo; or &ldquo;Physics&rdquo; to see who&apos;s assigned.
        {rows.length === 0
          ? " No class-teacher or subject-teacher links exist yet — assign them from Masters → Classes & sections → Teachers, or from a staff profile → Duties."
          : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${field} max-w-xs`}
          placeholder="Search class, subject, or teacher…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex gap-1">
          {(
            [
              { id: "all", label: "All" },
              { id: "class_teacher", label: "Class teachers" },
              { id: "subject_teacher", label: "Subject teachers" },
            ] as const
          ).map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                kind === k.id
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border border-[var(--border)] bg-[var(--card)]"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--muted)]">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {filtered.length === 0 && rows.length > 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          No assignments match &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <ErpTableShell exportAs="teacher_assignments" exportTitle="Teacher assignments">
          <ErpTable minWidth="min-w-[560px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 font-semibold">Class</th>
                <th className="px-3 py-2 font-semibold">Section</th>
                <th className="px-3 py-2 font-semibold">Subject</th>
                <th className="px-3 py-2 font-semibold">Teacher</th>
                <th className="px-3 py-2 font-semibold">Role</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">
                    {r.className}
                  </td>
                  <td className="px-3 py-2">{r.sectionName}</td>
                  <td className="px-3 py-2">{r.subjectName ?? "—"}</td>
                  <td className="px-3 py-2">{r.teacherName}</td>
                  <td className="px-3 py-2 text-[var(--muted)]">
                    {r.kind === "class_teacher"
                      ? r.isPrimary
                        ? "Class teacher"
                        : "Class teacher (co)"
                      : `Subject teacher${
                          r.periodsPerWeek ? ` · ${r.periodsPerWeek}/wk` : ""
                        }`}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}
    </div>
  );
}
