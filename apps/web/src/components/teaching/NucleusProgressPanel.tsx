"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { announceReady, readHandoffMessage } from "@/lib/nucleusHandoff";
import { ExternalLink, RefreshCw } from "lucide-react";
import {
  BEHIND_THRESHOLD,
  readingIsStale,
  type NucleusProgressRow,
  type NucleusSummary,
} from "@/lib/nucleusProgress";
import type { AssessmentSummary, NucleusAssessmentRow } from "@/lib/nucleusAssessments";

const NUCLEUS_URL = "https://nucleus.leadgroup.co.in";

type AssessmentSnapshot = {
  id: string;
  capturedOn: string;
  capturedBy: string;
  rows: NucleusAssessmentRow[];
  summary: AssessmentSummary;
};

type Snapshot = {
  id: string;
  capturedOn: string;
  source: "paste" | "token";
  capturedBy: string;
  note: string;
  rows: NucleusProgressRow[];
  summary: NucleusSummary;
};

/**
 * Syllabus progress as LEAD's Nucleus portal reports it.
 *
 * The publisher has no API, so a reading arrives by copy-paste: the principal
 * opens Nucleus → Teacher Timeliness, selects the table, and pastes it here.
 * The screen always says WHEN the numbers were read, and says plainly when
 * that was over a week ago — these are another system's figures on a date,
 * not a live feed.
 */
export function NucleusProgressPanel({ academicYearCode }: { academicYearCode: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [assessments, setAssessments] = useState<AssessmentSnapshot | null>(null);
  const [papersPaste, setPapersPaste] = useState("");
  const [loading, setLoading] = useState(true);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/principal/nucleus-progress?academicYearCode=${encodeURIComponent(academicYearCode)}`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        data?: { snapshot?: Snapshot | null; assessments?: AssessmentSnapshot | null };
      };
      setSnapshot(body.data?.snapshot ?? null);
      setAssessments(body.data?.assessments ?? null);
    } finally {
      setLoading(false);
    }
  }, [academicYearCode]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Take a timeliness reading the bookmark posts in, rather than making the
   * office copy it out of Nucleus and paste it here. Same route, same checks
   * as the papers desk: a message is read, not believed.
   */
  const onCaptureRef = useRef<(e: MessageEvent) => void>(() => {});
  useEffect(() => {
    onCaptureRef.current = (e: MessageEvent) => {
      const arriving = readHandoffMessage(e.origin, e.data, "timeliness");
      if (!arriving.ok) {
        if (arriving.speak) setError(`Nucleus sent a reading this screen could not take: ${arriving.why}`);
        return;
      }
      setPaste(arriving.payload);
      void importPaste("timeliness", arriving.payload);
    };
  });

  useEffect(() => {
    announceReady();
    const listener = (e: MessageEvent) => onCaptureRef.current(e);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  async function importPaste(
    kind: "timeliness" | "assessments" = "timeliness",
    /** A capture handed straight over, which no box has been rendered with yet. */
    arriving?: string,
  ) {
    const text = arriving ?? (kind === "assessments" ? papersPaste : paste);
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    setLineErrors([]);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/principal/nucleus-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, academicYearCode, kind }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        // The route's own refusal (a bad paste) arrives as data.ok = false;
        // anything the server threw arrives as error.message. Showing the
        // paste message for a server fault would blame the paste for, say,
        // the local-dev write guard.
        data?: {
          ok?: boolean;
          error?: string;
          lineErrors?: string[];
          snapshot?: Snapshot & AssessmentSnapshot;
        };
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(body.error?.message ?? `The server refused the save (HTTP ${res.status}).`);
        return;
      }
      const result = body.data;
      if (!result?.ok) {
        setError(result?.error ?? "Could not read the paste.");
        setLineErrors(result?.lineErrors ?? []);
        return;
      }
      if (kind === "assessments") {
        setAssessments((result.snapshot as AssessmentSnapshot) ?? null);
        setPapersPaste("");
        setNotice(`Saved ${result.snapshot?.rows.length ?? 0} papers.`);
      } else {
        setSnapshot((result.snapshot as Snapshot) ?? null);
        setPaste("");
        setNotice(`Saved ${result.snapshot?.rows.length ?? 0} rows.`);
      }
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const stale = snapshot ? readingIsStale(snapshot.capturedOn, today) : false;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Syllabus progress in Nucleus
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {snapshot
              ? `Read from Nucleus on ${snapshot.capturedOn}${snapshot.capturedBy ? ` by ${snapshot.capturedBy}` : ""}.`
              : "Nothing read from Nucleus yet."}
          </p>
        </div>
        <a
          href={NUCLEUS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--info)] underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open Nucleus
        </a>
      </div>

      {stale && snapshot ? (
        <div className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            These numbers are from {snapshot.capturedOn}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Over a week old. Teachers will have marked more day plans since;
            paste a fresh reading before acting on them.
          </p>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : snapshot ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="Class-subjects read" value={String(snapshot.summary.rowCount)} />
            <Card label="Ahead of schedule" value={String(snapshot.summary.ahead)} />
            <Card
              label={`Behind by ${BEHIND_THRESHOLD}+ day plans`}
              value={String(snapshot.summary.behind.length)}
              tone="danger"
            />
            <Card label="Within a few plans" value={String(snapshot.summary.onTrack)} />
          </div>

          {snapshot.summary.worst.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-sunken)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 font-bold">Teacher</th>
                    <th className="px-3 py-2 font-bold">Class · subject</th>
                    <th className="px-3 py-2 font-bold">Marked done</th>
                    <th className="px-3 py-2 font-bold">Behind by</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.summary.worst.map((r) => (
                    <tr key={r.position} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">
                        {r.teacherName}
                      </td>
                      <td className="px-3 py-2 text-[var(--muted)]">
                        {r.classLabel} · {r.subjectLabel}
                      </td>
                      <td className="px-3 py-2 text-[var(--muted)]">
                        {r.currentPlans} of {r.requiredPlans} due ({r.totalPlans} in the course)
                      </td>
                      <td className="px-3 py-2 font-semibold text-[var(--danger)]">
                        {Math.abs(r.gapPlans)} day plans
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <p className="text-xs text-[var(--muted)]">
            Nucleus counts a day plan only when the teacher marks it done on the
            Teacher Tab, so a gap can mean unmarked work rather than untaught
            syllabus. Ask before acting.
          </p>
        </>
      ) : null}

      <div className="border-t border-[var(--border)] pt-4">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Exam papers in Nucleus</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {assessments
            ? `Read on ${assessments.capturedOn}. ${assessments.summary.ready} ready, ${assessments.summary.notCreated} not created.`
            : "Nothing read yet — paste the Assessments & Answer key table to see which papers are missing."}
        </p>

        {assessments && assessments.summary.gaps.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-sunken)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2 font-bold">Class</th>
                  <th className="px-3 py-2 font-bold">Subject</th>
                  <th className="px-3 py-2 font-bold">Papers not created</th>
                </tr>
              </thead>
              <tbody>
                {assessments.summary.gaps.slice(0, 15).map((g) => (
                  <tr key={`${g.classLabel}|${g.division}|${g.subject}`} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">
                      {g.classLabel} {g.division}
                    </td>
                    <td className="px-3 py-2 text-[var(--muted)]">{g.subject}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">
                      <span className="font-semibold text-[var(--danger)]">{g.missing.length}</span>
                      {" — "}
                      {g.missing.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <details className="mt-3 rounded-xl border border-[var(--border)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--brand-deep)]">
            Paste the exam-paper list
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--muted)]">
            <li>Open Nucleus → Academics Resources → Assessments &amp; Answer Keys.</li>
            <li>Select the whole table and copy it.</li>
            <li>Paste it below and press Save.</li>
          </ol>
          <textarea
            value={papersPaste}
            onChange={(e) => setPapersPaste(e.target.value)}
            rows={6}
            placeholder="Paste the Assessments & Answer key table here"
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => importPaste("assessments")}
            disabled={busy || !papersPaste.trim()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Saving…" : "Save paper list"}
          </button>
        </details>
      </div>

      <details className="rounded-xl border border-[var(--border)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--brand-deep)]">
          Paste a fresh reading
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--muted)]">
          <li>Open Nucleus → Performance Reports → Teacher Timeliness.</li>
          <li>Select the whole table and copy it.</li>
          <li>Paste it below and press Save.</li>
        </ol>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={6}
          placeholder="Paste the Teacher Timeliness table here"
          className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 font-mono text-xs"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => importPaste("timeliness")}
            disabled={busy || !paste.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Saving…" : "Save reading"}
          </button>
          {notice ? <span className="text-xs font-semibold text-[var(--success)]">{notice}</span> : null}
        </div>
        {error ? (
          <div className="mt-2 rounded-lg border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3 py-2">
            <p className="text-xs font-semibold text-[var(--danger)]">{error}</p>
            {lineErrors.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-[var(--muted)]">
                {lineErrors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </details>
    </section>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${tone === "danger" ? "text-[var(--danger)]" : "text-[var(--brand-deep)]"}`}
      >
        {value}
      </p>
    </div>
  );
}
