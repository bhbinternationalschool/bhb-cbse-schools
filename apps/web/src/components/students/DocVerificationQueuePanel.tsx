"use client";

import { useMemo, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  decideStaffDocVerification,
  decideStudentDocVerification,
  listPendingStaffDocs,
  listPendingStudentDocs,
  type PendingDocItem,
} from "@/lib/profileDocVerification";
import type { DocVerificationOcrResult } from "@/lib/docVerificationOcr";
import { runProfileDocOcrApi } from "@/lib/ocrClient";
import type { StaffDocKey } from "@/lib/foundationMasters";
import type { StudentDocKey } from "@/lib/sis";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

const OVERALL_LABEL: Record<
  DocVerificationOcrResult["overall"],
  { text: string; className: string }
> = {
  likely_match: {
    text: "Likely match",
    className: "bg-emerald-50 text-emerald-800",
  },
  review: {
    text: "Review manually",
    className: "bg-amber-50 text-amber-900",
  },
  likely_mismatch: {
    text: "Likely mismatch",
    className: "bg-rose-50 text-rose-800",
  },
  unreadable: {
    text: "Unreadable scan",
    className: "bg-slate-100 text-slate-700",
  },
};

function checkClass(status: DocVerificationOcrResult["checks"][0]["status"]) {
  if (status === "match") return "text-emerald-700";
  if (status === "mismatch") return "text-rose-700 font-semibold";
  return "text-[var(--muted)]";
}

export function DocVerificationQueuePanel({
  mode = "student",
  onChanged,
}: {
  mode?: "student" | "staff" | "all";
  onChanged?: () => void;
}) {
  const session = useDemoSession();
  const [tick, setTick] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ocrByKey, setOcrByKey] = useState<
    Record<string, DocVerificationOcrResult>
  >({});
  const [ocrBusy, setOcrBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = useMemo(() => {
    void tick;
    const student =
      mode === "staff" ? [] : listPendingStudentDocs();
    const staff = mode === "student" ? [] : listPendingStaffDocs();
    return [...student, ...staff];
  }, [tick, mode]);

  function itemKey(it: PendingDocItem) {
    return `${it.subject}:${it.subjectId}:${it.docKey}`;
  }

  async function runVisionScan(it: PendingDocItem) {
    const k = itemKey(it);
    const url = it.file.fileUrl;
    if (!url.startsWith("data:image")) {
      setError("Vision scan needs an image upload (JPG/PNG)");
      return;
    }
    setOcrBusy((b) => ({ ...b, [k]: true }));
    setError(null);
    try {
      const r = await runProfileDocOcrApi({
        subject: it.subject,
        subjectId: it.subjectId,
        docKey: it.docKey,
        dataUrl: url,
        mimeType: it.file.mimeType || "image/jpeg",
      });
      if (!r.ok || !r.result) {
        setError(r.error || "Vision scan failed");
        return;
      }
      setOcrByKey((o) => ({ ...o, [k]: r.result! }));
      setNotice("Vision scan complete");
      window.setTimeout(() => setNotice(null), 2200);
    } finally {
      setOcrBusy((b) => ({ ...b, [k]: false }));
    }
  }

  function decide(it: PendingDocItem, approve: boolean) {
    setError(null);
    const by = session?.fullName || session?.email || "Verifier";
    const k = itemKey(it);
    const note = notes[k] || "";
    if (!approve && !note.trim()) {
      setError("Add a remark when rejecting so the parent/staff can re-upload.");
      return;
    }
    const r =
      it.subject === "student"
        ? decideStudentDocVerification({
            studentId: it.subjectId,
            docKey: it.docKey as StudentDocKey,
            approve,
            by,
            note,
          })
        : decideStaffDocVerification({
            staffId: it.subjectId,
            docKey: it.docKey as StaffDocKey,
            approve,
            by,
            note,
          });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setNotice(approve ? "Marked verified" : "Rejected with remark");
    window.setTimeout(() => setNotice(null), 2200);
    setOcrByKey((o) => {
      const next = { ...o };
      delete next[k];
      return next;
    });
    setTick((t) => t + 1);
    onChanged?.();
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-[var(--brand-deep)]">
          Document verification queue
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Parent/staff uploads awaiting class teacher, office, or principal
          review. Use <strong>Vision scan</strong> to compare the upload against
          the register (name, DOB, Aadhaar, PAN).
        </p>
      </div>
      {notice ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-6 text-sm text-[var(--muted)]">
          No documents pending verification.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const k = itemKey(it);
            const ocr = ocrByKey[k];
            const isImage =
              it.file.mimeType.startsWith("image/") ||
              it.file.fileUrl.startsWith("data:image/");
            const overall = ocr ? OVERALL_LABEL[ocr.overall] : null;
            return (
              <li
                key={k}
                className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--brand-deep)]">
                      {it.subjectName}{" "}
                      <span className="font-normal text-[var(--muted)]">
                        · {it.classLabel}
                      </span>
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {it.subject === "staff" ? "Staff" : "Student"} ·{" "}
                      {it.docLabel} · {it.file.status}
                      {it.file.submittedBy
                        ? ` · by ${it.file.submittedBy}`
                        : ""}
                    </p>
                  </div>
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.file.fileUrl}
                      alt=""
                      className="h-20 w-20 rounded-md border object-cover"
                    />
                  ) : (
                    <a
                      href={it.file.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold underline"
                    >
                      Open file
                    </a>
                  )}
                </div>

                {isImage ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!!ocrBusy[k]}
                      className="rounded-lg bg-[#0f766e] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      onClick={() => void runVisionScan(it)}
                    >
                      {ocrBusy[k] ? "Scanning…" : "Vision scan"}
                    </button>
                    {ocr ? (
                      <button
                        type="button"
                        className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-xs font-semibold"
                        onClick={() =>
                          setNotes((n) => ({
                            ...n,
                            [k]: ocr.suggestedRemark,
                          }))
                        }
                      >
                        Use suggested remark
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {ocr ? (
                  <div className="mt-2 space-y-2 rounded-lg bg-[rgba(15,118,110,0.06)] p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${overall?.className}`}
                      >
                        {overall?.text}
                      </span>
                      <span className="text-[10px] text-[var(--muted)]">
                        Confidence: {ocr.confidence.replace("vision_", "")}
                      </span>
                    </div>
                    {ocr.checks.filter((c) => c.status !== "skipped").length ? (
                      <ul className="space-y-1 text-[11px]">
                        {ocr.checks
                          .filter((c) => c.status !== "skipped")
                          .map((c) => (
                            <li key={c.field} className={checkClass(c.status)}>
                              <span className="font-semibold">{c.label}:</span>{" "}
                              scan {c.ocrValue || "—"} · register{" "}
                              {c.recordValue || "—"}
                              {c.status === "match" ? " ✓" : ""}
                              {c.note ? ` (${c.note})` : ""}
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-[var(--muted)]">
                        {ocr.suggestedRemark}
                      </p>
                    )}
                  </div>
                ) : null}

                <label className="mt-2 block text-[11px] font-medium text-[var(--muted)]">
                  Remark (required to reject)
                  <input
                    className={`${field} mt-0.5`}
                    value={notes[k] || ""}
                    onChange={(e) =>
                      setNotes((n) => ({ ...n, [k]: e.target.value }))
                    }
                    placeholder="e.g. Blurry Aadhaar — please re-upload"
                  />
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"
                    onClick={() => decide(it, true)}
                  >
                    Approve (correct)
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white"
                    onClick={() => decide(it, false)}
                  >
                    Reject (wrong)
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
