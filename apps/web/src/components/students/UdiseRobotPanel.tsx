"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { UdiseSchoolAnswersCard } from "@/components/students/UdiseSchoolAnswersCard";
import type { MastersState } from "@/lib/masters";
import { studentsInSession, type SisState } from "@/lib/sis";
import {
  buildUdiseRobotBoard,
  UDISE_ROBOT_TASKS,
  type UdiseRobotOwner,
  type UdiseRobotTaskKind,
} from "@/lib/udiseRobot";

function classOf(masters: MastersState, classId: string, sectionId: string): string {
  const c = masters.classes.find((x) => x.id === classId);
  const s = masters.sections.find((x) => x.id === sectionId);
  return [c?.name || "", s?.name || ""].filter(Boolean).join(" ");
}

/**
 * The UDISE robot's to-do board: every open child's next step, split into
 * what the office does on the portal and what only a family can give.
 * Derived on every render from SIS — a task disappears when the fact that
 * ends it lands (a portal export applied, a WhatsApp document filed).
 */
export function UdiseRobotPanel({
  sis,
  masters,
  academicYearCode,
}: {
  sis: SisState;
  masters: MastersState;
  academicYearCode: string;
}) {
  const [open, setOpen] = useState<UdiseRobotTaskKind | null>(null);
  const board = useMemo(
    () =>
      buildUdiseRobotBoard(
        studentsInSession(sis, academicYearCode).filter((s) => s.status === "active"),
      ),
    [sis, academicYearCode],
  );
  const pct = board.total ? Math.round((board.done / board.total) * 100) : 0;

  const group = (owner: UdiseRobotOwner) => board.byKind.filter((g) => UDISE_ROBOT_TASKS[g.kind].owner === owner);

  const renderGroup = (owner: UdiseRobotOwner, heading: string, sub: string) => {
    const groups = group(owner);
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-xs font-semibold text-[var(--brand-deep)]">{heading}</p>
        <p className="mb-2 text-[11px] text-[var(--muted)]">{sub}</p>
        {!groups.length ? (
          <p className="text-xs text-[var(--success)]">Nothing waiting ✓</p>
        ) : (
          <ul className="space-y-1.5">
            {groups.map((g) => {
              const def = UDISE_ROBOT_TASKS[g.kind];
              const expanded = open === g.kind;
              return (
                <li key={g.kind} className="rounded-md border border-[var(--border)]">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs"
                    onClick={() => setOpen(expanded ? null : g.kind)}
                    aria-expanded={expanded}
                  >
                    <span className="font-medium text-[var(--brand-deep)]">{def.title}</span>
                    <span className="shrink-0 rounded-full bg-[var(--primary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--primary-foreground)]">
                      {g.children.length}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="border-t border-[var(--border)] px-2.5 py-2">
                      <p className="mb-1.5 text-[11px] text-[var(--muted)]">{def.how}</p>
                      <ol className="max-h-72 list-decimal space-y-0.5 overflow-y-auto pl-5 text-xs">
                        {g.children.map(({ student, note }) => (
                          <li key={student.id}>
                            <Link
                              href={`/students/${student.id}/edit`}
                              className="font-medium text-[var(--brand-deep)] underline-offset-2 hover:underline"
                            >
                              {student.fullName}
                            </Link>
                            <span className="text-[var(--muted)]">
                              {" "}
                              — {classOf(masters, student.classId, student.sectionId)}
                              {student.admissionNo ? ` · ${student.admissionNo}` : ""}
                              {note ? ` · ${note}` : ""}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface,var(--card))] p-4" aria-label="UDISE robot">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">🤖 UDISE robot — today&apos;s to-do</h2>
        <p className="text-xs text-[var(--muted)]">
          {board.done} of {board.total} children complete · {board.open} open
        </p>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--border)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-[var(--success)]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        Each child&apos;s next step, worked out from the ERP every time this opens. A step drops off by itself once the
        portal export is imported below or the family&apos;s document arrives on WhatsApp — nothing to tick.
        To refresh from the portal without downloading Excel, log in to UDISE+ in Chrome with the BHB Office Robot
        extension and press <strong>Send portal list to ERP</strong>, then Apply below.
      </p>
      <div className="mt-3 flex flex-col gap-3 md:flex-row">
        {renderGroup("portal", `Office — on the UDISE+ portal (${board.portalTaskCount})`, "Log in to UDISE+ and do these.")}
        {renderGroup("family", `Families (${board.familyTaskCount})`, "Only the parent can give these. WhatsApp asks them weekly.")}
      </div>
      <div className="mt-3">
        <UdiseSchoolAnswersCard />
      </div>
    </section>
  );
}
