"use client";

/**
 * Job applications, as the office works them.
 *
 * The list is ordered so the ones that need a person come first: an
 * application whose CV could not be read sits at the top regardless of
 * age, because it is the one that otherwise looks empty rather than
 * urgent and is never opened.
 *
 * Everything the OCR guessed is shown as a guess. Where it matched the
 * school's own subjects the chip is solid; where it only has the
 * applicant's words the chip is outlined and says so. Nobody should have
 * to open the CV to find out whether the row above it is trustworthy.
 */

import { useCallback, useEffect, useState } from "react";
import type { JobApplication, JobApplicationStatus } from "@/lib/jobApplications";

type Row = JobApplication & {
  subjectLabels: string[];
  classLabels: string[];
};

const STATUS_LABEL: Record<JobApplicationStatus, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  interviewed: "Interviewed",
  rejected: "Not proceeding",
  hired: "Hired",
};

const NEXT_STATUS: JobApplicationStatus[] = [
  "shortlisted",
  "interviewed",
  "rejected",
  "hired",
];

export function JobApplicationsInbox({
  initialRows,
  canEdit,
}: {
  initialRows: Row[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setRows(initialRows), [initialRows]);

  const setStatus = useCallback(
    async (id: string, status: JobApplicationStatus) => {
      setBusyId(id);
      setError("");
      try {
        const res = await fetch("/api/v1/job-applications", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, status }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(json.error || "Could not update that application.");
          return;
        }
        setRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status } : r)),
        );
      } catch {
        setError("Could not update that application.");
      } finally {
        setBusyId("");
      }
    },
    [],
  );

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-600">
          No job applications yet. They arrive from the public careers page and
          from WhatsApp job enquiries.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {rows.map((r) => (
        <article
          key={r.id}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900">
                {r.applicantName || "Unnamed applicant"}
              </h3>
              <p className="mt-0.5 text-sm text-slate-600">
                <a className="underline" href={`tel:${r.mobile}`}>
                  {r.mobile}
                </a>
                {r.email ? ` · ${r.email}` : ""}
                {r.experienceYears ? ` · ${r.experienceYears} yr experience` : ""}
              </p>
              {r.qualification ? (
                <p className="mt-0.5 text-sm text-slate-500">{r.qualification}</p>
              ) : null}
              {r.currentEmployer ? (
                <p className="text-sm text-slate-500">
                  Currently: {r.currentEmployer}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  r.status === "new"
                    ? "bg-blue-100 text-blue-800"
                    : r.status === "hired"
                      ? "bg-emerald-100 text-emerald-800"
                      : r.status === "rejected"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-amber-100 text-amber-800"
                }`}
              >
                {STATUS_LABEL[r.status]}
              </span>
              {r.cvPath ? (
                <a
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
                  href={`/api/file/${r.cvPath}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open CV
                </a>
              ) : (
                <span className="text-xs text-slate-400">No CV file</span>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {r.subjectLabels.map((s) => (
              <span
                key={s}
                className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-medium text-white"
              >
                {s}
              </span>
            ))}
            {/* Words the CV used that match no subject this school teaches.
                Shown, not hidden: "Robotics" from someone worth hiring must
                not disappear because there is no master row for it. */}
            {r.subjectWords
              .filter(
                (w) =>
                  !r.subjectLabels.some(
                    (s) => s.toLowerCase() === w.toLowerCase(),
                  ),
              )
              .map((w) => (
                <span
                  key={`w-${w}`}
                  className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-500"
                  title="As written on the CV — no matching subject in Masters"
                >
                  {w}
                </span>
              ))}
            {r.classLabels.length ? (
              <span className="ml-1 text-xs text-slate-600">
                Classes: {r.classLabels.join(", ")}
              </span>
            ) : r.classWords.length ? (
              <span className="ml-1 text-xs text-slate-500">
                Classes (as written): {r.classWords.join(", ")}
              </span>
            ) : null}
          </div>

          {r.ocrStatus !== "ok" ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {r.ocrStatus === "unreadable"
                ? "The CV was read but gave no subject or number — open it and check."
                : "The CV could not be read automatically. Open it to see what it says."}
              {r.ocrNotes ? ` (${r.ocrNotes})` : ""}
            </p>
          ) : r.ocrNotes ? (
            <p className="mt-2 text-xs text-slate-500">Note: {r.ocrNotes}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>
              {r.source === "whatsapp"
                ? "via WhatsApp"
                : r.source === "office"
                  ? "added by the office"
                  : "via careers page"}
              {" · "}
              {new Date(r.createdAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })}
            </span>
            {r.reviewedBy ? <span>· last moved by {r.reviewedBy}</span> : null}
          </div>

          {canEdit ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {NEXT_STATUS.filter((s) => s !== r.status).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void setStatus(r.id, s)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
