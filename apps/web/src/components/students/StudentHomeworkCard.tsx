"use client";

/**
 * Has this child been doing the homework?
 *
 * Asked at every PTM and on every fee call, and until now unanswerable from
 * one screen: homework is published to a SECTION and submissions live in a
 * separate list, so the teacher had to remember or scroll the class feed
 * post by post.
 *
 * The figure only counts work that ASKED for something to be handed in —
 * see lib/studentHomework.ts. Reading tasks are listed but never held
 * against the child.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, TriangleAlert } from "lucide-react";
import { loadHomework, subjectLabel, type HomeworkState } from "@/lib/homework";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, normalizeStudent, type SisStudent } from "@/lib/sis";
import {
  homeworkStatusLabel,
  studentHomeworkRecord,
  type StudentHomeworkStatus,
} from "@/lib/studentHomework";

type Load =
  | { kind: "loading" }
  | {
      kind: "ready";
      student: SisStudent;
      homework: HomeworkState;
      masters: MastersState;
    }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const PREVIEW = 8;

const STATUS_TONE: Record<StudentHomeworkStatus, string> = {
  acknowledged:
    "bg-[var(--success-soft,rgba(22,132,80,0.16))] text-[var(--success,#16794f)]",
  submitted:
    "bg-[var(--success-soft,rgba(22,132,80,0.12))] text-[var(--success,#16794f)]",
  pending: "bg-[rgba(197,160,40,0.22)] text-[#7a5c00]",
  overdue: "bg-[var(--danger-soft)] text-[var(--danger)]",
  not_required: "bg-[var(--surface-sunken)] text-[var(--muted)]",
};

export function StudentHomeworkCard({ studentId }: { studentId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { ensureSisHydrated } = await import("@/lib/sisPersistence");
        const { ensureHomeworkHydrated } = await import(
          "@/lib/homeworkPersistence"
        );
        const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
        await Promise.all([
          withHydrationSlot(() => ensureSisHydrated()),
          withHydrationSlot(() => ensureHomeworkHydrated()),
        ]);
        if (!alive) return;
        const raw = loadSis().students.find((s) => s.id === studentId);
        if (!raw) {
          setLoad({ kind: "missing" });
          return;
        }
        setLoad({
          kind: "ready",
          student: normalizeStudent(raw),
          homework: loadHomework(),
          masters: loadMasters(),
        });
      } catch (e) {
        if (!alive) return;
        setLoad({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not read homework",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentId]);

  const record = useMemo(() => {
    if (load.kind !== "ready") return null;
    return studentHomeworkRecord(load.homework, load.student);
  }, [load]);

  // `record` is only built when the load is ready, so masters is there too.
  const masters = load.kind === "ready" ? load.masters : null;

  if (load.kind === "missing") return null;

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <BookOpen className="size-4 text-[var(--brand-deep)]" aria-hidden />
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">Homework</h2>
        {record && record.posts > 0 ? (
          <span className="text-[10px] text-[var(--muted)]">
            {record.posts} posted · last {record.lastPostDate}
          </span>
        ) : null}
        <Link
          href="/homework"
          className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
        >
          Homework desk
        </Link>
      </div>

      {load.kind === "loading" ? (
        <p className="px-3 py-3 text-xs text-[var(--muted)]">
          Reading the class feed…
        </p>
      ) : null}

      {load.kind === "error" ? (
        <p className="px-3 py-3 text-xs font-semibold text-[var(--danger)]">
          Homework could not be read — {load.message}. This is not an empty
          record; check the Homework desk.
        </p>
      ) : null}

      {record && record.posts === 0 ? (
        <p className="px-3 py-3 text-xs text-[var(--muted)]">
          No homework published to this section yet this session.
        </p>
      ) : null}

      {record && record.posts > 0 ? (
        <>
          {record.overdue > 0 ? (
            <p className="flex items-center gap-1.5 border-b border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--danger)]">
              <TriangleAlert className="size-3.5" aria-hidden />
              {record.overdue} homework
              {record.overdue === 1 ? "" : "s"} past due and not submitted
            </p>
          ) : null}

          <div className="grid grid-cols-2 divide-x divide-[var(--border)] border-b border-[var(--border)] sm:grid-cols-4">
            <Stat
              label="Submitted"
              value={
                record.submissionRate === null
                  ? "—"
                  : `${record.submissionRate}%`
              }
              hint={
                record.submissionRate === null
                  ? "nothing needed handing in"
                  : `${record.submitted} of ${record.requiring} that needed it`
              }
              strong
              tone={
                record.submissionRate !== null && record.submissionRate < 60
                  ? "danger"
                  : undefined
              }
            />
            <Stat
              label="Not submitted"
              value={String(record.overdue)}
              tone={record.overdue > 0 ? "danger" : undefined}
            />
            <Stat label="To submit" value={String(record.pending)} />
            <Stat
              label="Opened at home"
              value={record.seenRate === null ? "—" : `${record.seenRate}%`}
              hint="of posts seen in the parent app"
            />
          </div>

          <ul className="divide-y divide-[var(--border)]">
            {(showAll ? record.rows : record.rows.slice(0, PREVIEW)).map(
              (r) => (
                <li
                  key={r.postId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-[11px]"
                >
                  <span className="tabular-nums text-[var(--muted)]">
                    {r.date}
                  </span>
                  <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted)]">
                    {masters ? subjectLabel(masters, r.subjectId) : r.subjectId}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-[var(--brand-deep)]">
                    {r.title || "(untitled)"}
                  </span>
                  {r.dueAt ? (
                    <span className="text-[10px] text-[var(--muted)]">
                      due {r.dueAt.slice(0, 10)}
                    </span>
                  ) : null}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_TONE[r.status]}`}
                  >
                    {homeworkStatusLabel(r.status)}
                  </span>
                </li>
              ),
            )}
          </ul>

          {record.rows.length > PREVIEW ? (
            <button
              type="button"
              className="w-full border-t border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-[var(--brand-mid)] hover:bg-[var(--surface-sunken)]"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll
                ? "Show recent only"
                : `Show all ${record.rows.length} posts`}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger";
  strong?: boolean;
}) {
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`tabular-nums ${strong ? "text-base font-extrabold" : "text-sm font-bold"} ${
          tone === "danger" ? "text-[var(--danger)]" : "text-[var(--brand-deep)]"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="text-[10px] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}
