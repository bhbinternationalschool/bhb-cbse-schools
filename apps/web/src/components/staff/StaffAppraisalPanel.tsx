"use client";

import { useEffect, useMemo, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import {
  APPRAISAL_CRITERIA,
  appraisalAverage,
  closeAppraisalCycle,
  defaultAppraisalScores,
  ensureAppraisalCycle,
  loadStaffHr,
  reopenAppraisalCycle,
  upsertAppraisal,
  type AppraisalCycle,
  type AppraisalScores,
  type StaffHrState,
} from "@/lib/staffHr";
import {
  exportFilterReport,
} from "@/lib/reportExport";
import { TENANT } from "@/lib/types";

export function StaffAppraisalPanel({ ay }: { ay: string }) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [hr, setHr] = useState<StaffHrState | null>(null);
  const [cycle, setCycle] = useState<AppraisalCycle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [staffId, setStaffId] = useState("");
  const [scores, setScores] = useState<AppraisalScores>(defaultAppraisalScores);
  const [comment, setComment] = useState("");

  const [draftText, setDraftText] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  function reload() {
    const m = loadMasters();
    setMasters(m);
    const state = loadStaffHr();
    const ensured = ensureAppraisalCycle(state, ay);
    setHr(ensured.state);
    setCycle(ensured.cycle);
  }

  useEffect(() => {
    reload();
    void (async () => {
      const { ensureStaffHydrated } = await import("@/lib/staffPersistence");
      const did = await ensureStaffHydrated();
      if (did) reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  const roster = useMemo(() => {
    if (!masters) return [];
    return (masters.staff ?? [])
      .filter((s) => s.status === "active")
      .sort((a, b) => a.empCode.localeCompare(b.empCode));
  }, [masters]);

  const cycleAppraisals = useMemo(() => {
    if (!hr || !cycle) return [];
    return hr.appraisals
      .filter((a) => a.cycleId === cycle.id)
      .sort((a, b) => b.ratedAt.localeCompare(a.ratedAt));
  }, [hr, cycle]);

  useEffect(() => {
    if (!staffId || !hr || !cycle) return;
    const existing = hr.appraisals.find(
      (a) => a.cycleId === cycle.id && a.staffId === staffId,
    );
    if (existing) {
      setScores(existing.scores);
      setComment(existing.comment);
    } else {
      setScores(defaultAppraisalScores());
      setComment("");
    }
    setDraftText(null);
    setDraftError(null);
  }, [staffId, hr, cycle]);

  async function draftComment() {
    if (!staffId) return;
    setDraftLoading(true);
    setDraftError(null);
    setDraftText(null);
    try {
      const res = await fetch("/api/ai/appraisal-comment-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffName: staffLabel(staffId),
          cycleLabel: cycle?.label,
          scores: APPRAISAL_CRITERIA.map((c) => ({
            label: c.label,
            value: scores[c.key],
          })),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        draft?: string;
      };
      if (!json.ok || !json.draft) {
        setDraftError(json.error || "Draft failed");
        return;
      }
      setDraftText(json.draft);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setDraftLoading(false);
    }
  }

  function flash(msg: string, isError = false) {
    if (isError) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
    window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 2800);
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!cycle) return;
    const result = upsertAppraisal({
      cycleId: cycle.id,
      staffId,
      scores,
      comment,
      ratedBy: session.fullName,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setHr(result.state);
    flash("Appraisal saved");
  }

  function staffLabel(id: string) {
    const s = masters?.staff.find((x) => x.id === id);
    return s ? `${s.empCode} · ${s.fullName}` : id;
  }

  function exportCycle(format: "excel" | "pdf") {
    if (!cycle || !hr) return;
    const rows = cycleAppraisals.map((a) => ({
      staff: staffLabel(a.staffId),
      teaching: a.scores.teaching,
      duty: a.scores.duty,
      punctuality: a.scores.punctuality,
      conduct: a.scores.conduct,
      overall: a.scores.overall,
      average: appraisalAverage(a.scores),
      comment: a.comment,
      ratedBy: a.ratedBy,
      ratedAt: a.ratedAt.slice(0, 10),
    }));
    const r = exportFilterReport(
      {
        title: `Appraisal · ${cycle.label}`,
        subtitle: `${TENANT.shortName} · Staff HR`,
        filterNote: `AY ${cycle.academicYearCode} · ${cycle.status}`,
        columns: [
          { key: "staff", header: "Staff", width: 1.3 },
          { key: "teaching", header: "Teach", width: 0.55, align: "right" },
          { key: "duty", header: "Duty", width: 0.55, align: "right" },
          { key: "punctuality", header: "Punct", width: 0.55, align: "right" },
          { key: "conduct", header: "Cond", width: 0.55, align: "right" },
          { key: "overall", header: "Ovr", width: 0.55, align: "right" },
          { key: "average", header: "Avg", width: 0.55, align: "right" },
          { key: "comment", header: "Comment", width: 1.2 },
          { key: "ratedBy", header: "By", width: 0.8 },
        ],
        rows,
        fileBaseName: `appraisal_${cycle.academicYearCode}`,
      },
      format,
    );
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash(`Exported ${rows.length} appraisal(s)`);
  }

  if (!masters || !hr || !cycle) {
    return <p className="text-sm text-[var(--muted)]">Loading appraisal…</p>;
  }

  const previewAvg = appraisalAverage(scores);

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            {cycle.label}
          </h2>
          <p className="text-[11px] text-[var(--muted)]">
            Academic year {cycle.academicYearCode} ·{" "}
            <span className="uppercase font-semibold">{cycle.status}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-[var(--surface-sunken)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]">
            {cycleAppraisals.length} rated
          </span>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
            onClick={() => exportCycle("excel")}
          >
            Export Excel
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
            onClick={() => exportCycle("pdf")}
          >
            Export PDF
          </button>
          {cycle.status === "open" ? (
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => {
                const res = closeAppraisalCycle(cycle.id);
                if (!res.ok) {
                  flash(res.error, true);
                  return;
                }
                setHr(res.state);
                setCycle(
                  res.state.appraisalCycles.find((c) => c.id === cycle.id) ??
                    cycle,
                );
                flash("Cycle closed — ratings locked");
              }}
            >
              Close cycle
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
              onClick={() => {
                const res = reopenAppraisalCycle(cycle.id);
                if (!res.ok) {
                  flash(res.error, true);
                  return;
                }
                setHr(res.state);
                setCycle(
                  res.state.appraisalCycles.find((c) => c.id === cycle.id) ??
                    cycle,
                );
                flash("Cycle reopened");
              }}
            >
              Reopen cycle
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form
          onSubmit={onSave}
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3"
        >
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Rate staff
          </h3>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Staff
            </span>
            <select
              className="field !py-1.5"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              required
            >
              <option value="">Select…</option>
              {roster.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.empCode} · {s.fullName}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            {APPRAISAL_CRITERIA.map((c) => (
              <label
                key={c.key}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="font-medium text-[var(--brand-deep)]">
                  {c.label}
                </span>
                <select
                  className="field !w-20 !py-1"
                  value={scores[c.key]}
                  onChange={(e) =>
                    setScores((prev) => ({
                      ...prev,
                      [c.key]: Number(e.target.value),
                    }))
                  }
                  disabled={cycle.status === "closed"}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <p className="text-[11px] text-[var(--muted)]">
            Average: <strong>{previewAvg}</strong> / 5
          </p>

          <label className="block text-sm">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--muted)]">Comment</span>
              {cycle.status === "open" && staffId ? (
                <button
                  type="button"
                  disabled={draftLoading}
                  className="text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline disabled:opacity-50"
                  onClick={() => void draftComment()}
                >
                  {draftLoading
                    ? "Drafting…"
                    : draftText
                      ? "Redraft"
                      : "Draft with AI"}
                </button>
              ) : null}
            </div>
            <textarea
              className="field !py-1.5 min-h-[72px]"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Strengths, areas to improve…"
              disabled={cycle.status === "closed"}
            />
          </label>

          {draftError ? (
            <p className="text-[11px] text-[var(--danger)]">{draftError}</p>
          ) : null}
          {draftText ? (
            <div className="rounded-lg bg-[var(--surface-sunken)] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  AI draft — review before using
                </span>
                <button
                  type="button"
                  className="text-[10px] font-semibold text-[var(--brand-deep)] underline"
                  onClick={() => setComment(draftText)}
                >
                  Use this comment
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--ink)]">
                {draftText}
              </p>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={cycle.status === "closed"}
            className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            Save appraisal
          </button>
        </form>

        <ErpTableShell>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Cycle ratings
            </h3>
          </div>
          <div className="overflow-x-auto">
            <ErpTable>
              <ErpTableHead>
                <tr>
                  <th className="px-4 py-2">Staff</th>
                  <th className="px-3 py-2">Avg</th>
                  <th className="px-3 py-2">Rated by</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody hoverable>
                {cycleAppraisals.map((a) => (
                  <tr
                    key={a.id}
                    className="cursor-pointer"
                    onClick={() => setStaffId(a.staffId)}
                  >
                    <td className="px-4 py-2 font-medium text-[var(--brand-deep)]">
                      {staffLabel(a.staffId)}
                    </td>
                    <td className="px-3 py-2 font-semibold">
                      {appraisalAverage(a.scores)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">
                      {a.ratedBy}
                    </td>
                  </tr>
                ))}
                {cycleAppraisals.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                    >
                      No appraisals yet — rate a staff member
                    </td>
                  </tr>
                ) : null}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      </div>
    </div>
  );
}
