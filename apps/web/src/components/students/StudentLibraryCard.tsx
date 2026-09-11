"use client";

/**
 * What this child has borrowed, what is late, and what came back damaged.
 *
 * The library desk is organised by title and copy; the child-shaped question
 * — "has he returned the book, does he owe a fine, can he borrow another?" —
 * is asked at the counter, at the gate, and on the day a leaving certificate
 * is signed, which is the school's last chance to get a book back.
 *
 * No card at all for a child who has never borrowed anything.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookMarked, TriangleAlert } from "lucide-react";
import { loadLibrary, type LibraryState } from "@/lib/library";
import { formatInr } from "@/lib/masters";
import { loadSis, normalizeStudent, type SisStudent } from "@/lib/sis";
import {
  libraryRecordIsEmpty,
  studentLibraryRecord,
  type StudentBookRow,
} from "@/lib/studentLibrary";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; student: SisStudent; library: LibraryState }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const HISTORY_PREVIEW = 6;

export function StudentLibraryCard({ studentId }: { studentId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { ensureSisHydrated } = await import("@/lib/sisPersistence");
        const { ensureLibraryHydrated } = await import(
          "@/lib/libraryPersistence"
        );
        const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
        await Promise.all([
          withHydrationSlot(() => ensureSisHydrated()),
          withHydrationSlot(() => ensureLibraryHydrated()),
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
          library: loadLibrary(),
        });
      } catch (e) {
        if (!alive) return;
        setLoad({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not read the library",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentId]);

  const record = useMemo(() => {
    if (load.kind !== "ready") return null;
    return studentLibraryRecord(load.library, load.student.id);
  }, [load]);

  if (load.kind === "missing") return null;
  if (load.kind === "loading") return null;
  if (record && libraryRecordIsEmpty(record)) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <BookMarked className="size-4 text-[var(--brand-deep)]" aria-hidden />
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">Library</h2>
        {record ? (
          <span className="text-[10px] text-[var(--muted)]">
            {record.borrowedEver} borrowed in all
            {record.lastBorrowedOn ? ` · last on ${record.lastBorrowedOn}` : ""}
          </span>
        ) : null}
        <Link
          href="/library"
          className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
        >
          Library desk
        </Link>
      </div>

      {load.kind === "error" ? (
        <p className="px-3 py-3 text-xs font-semibold text-[var(--danger)]">
          Library could not be read — {load.message}. Do not tell a parent the
          child has nothing outstanding; check the Library desk.
        </p>
      ) : null}

      {record ? (
        <>
          {record.overdue.length > 0 ? (
            <p className="flex items-center gap-1.5 border-b border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--danger)]">
              <TriangleAlert className="size-3.5" aria-hidden />
              {record.overdue.length} book
              {record.overdue.length === 1 ? "" : "s"} overdue — the oldest by{" "}
              {record.worstDaysLate} days
            </p>
          ) : null}

          <div className="grid grid-cols-2 divide-x divide-[var(--border)] border-b border-[var(--border)] sm:grid-cols-4">
            <Stat
              label="Out now"
              value={String(record.out.length)}
              strong
              tone={record.overdue.length > 0 ? "danger" : undefined}
            />
            <Stat label="Overdue" value={String(record.overdue.length)} />
            <Stat
              label="Fines recorded"
              value={
                record.finePaise > 0 ? formatInr(record.finePaise) : "none"
              }
              hint={record.finePaise > 0 ? "on returns; the desk says if paid" : undefined}
            />
            <Stat
              label="Returned damaged"
              value={String(record.damagedReturns)}
            />
          </div>

          {record.out.length > 0 ? (
            <>
              <p className="bg-[var(--surface-sunken)] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                With the child now — every session, not just this one
              </p>
              <ul className="divide-y divide-[var(--border)]">
                {record.out.map((b) => (
                  <BookLine key={b.issueId} book={b} />
                ))}
              </ul>
            </>
          ) : (
            <p className="px-3 py-2 text-[11px] font-bold text-[var(--success,#16794f)]">
              Nothing outstanding — every book returned.
            </p>
          )}

          {record.returned.length > 0 ? (
            <>
              <p className="border-t border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Returned
              </p>
              <ul className="divide-y divide-[var(--border)]">
                {(showAll
                  ? record.returned
                  : record.returned.slice(0, HISTORY_PREVIEW)
                ).map((b) => (
                  <BookLine key={b.issueId} book={b} returned />
                ))}
              </ul>
              {record.returned.length > HISTORY_PREVIEW ? (
                <button
                  type="button"
                  className="w-full border-t border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-[var(--brand-mid)] hover:bg-[var(--surface-sunken)]"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll
                    ? "Show recent only"
                    : `Show all ${record.returned.length} returns`}
                </button>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function BookLine({
  book,
  returned,
}: {
  book: StudentBookRow;
  returned?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-[11px]">
      <span className="min-w-0 flex-1 truncate font-semibold text-[var(--brand-deep)]">
        {book.title}
        {book.author ? (
          <span className="ml-1.5 font-normal text-[var(--muted)]">
            {book.author}
          </span>
        ) : null}
      </span>
      <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--muted)]">
        {book.accessionNo}
      </span>
      {returned ? (
        <>
          <span className="tabular-nums text-[10px] text-[var(--muted)]">
            {book.issuedOn} → {book.returnedOn}
          </span>
          {book.finePaise > 0 ? (
            <span className="rounded bg-[rgba(197,160,40,0.22)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#7a5c00]">
              fine {formatInr(book.finePaise)}
            </span>
          ) : null}
          {book.damagedOnReturn ? (
            <span
              className="rounded bg-[var(--danger-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--danger)]"
              title={book.damageNote || undefined}
            >
              {book.returnCondition}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className="tabular-nums text-[10px] text-[var(--muted)]">
            due {book.dueOn || "—"}
          </span>
          {book.daysLate > 0 ? (
            <span className="rounded bg-[var(--danger-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--danger)]">
              {book.daysLate} days late
            </span>
          ) : (
            <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--muted)]">
              with child
            </span>
          )}
        </>
      )}
    </li>
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
