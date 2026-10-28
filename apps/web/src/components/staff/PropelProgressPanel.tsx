"use client";

// ratchet-allow: grids_without_row_menu — a read-only report of what Propel
// says, refreshed by the Office Robot. Its rows are not ERP records; there is
// nothing to edit or delete here, only to read.

import { useEffect, useMemo, useState } from "react";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import type { PropelProgressRecord, PropelProgressSnapshot } from "@/lib/propelRobot";

/**
 * Staff → Appraisal: each teacher's Propel course progress (director,
 * 12 Oct 2026), as the Office Robot last brought it from Propel's Teacher
 * Timeliness — day plans done against Propel's schedule, per class and
 * subject, furthest behind first, with the change over the last 7 days.
 * Read only; to refresh, press "Bring teacher progress to ERP" on Propel.
 */

type State = { rows: PropelProgressRecord[]; history: PropelProgressSnapshot[]; fetchedAt: string; fetchedBy: string };

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

export function PropelProgressPanel() {
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState("");
  const [behindOnly, setBehindOnly] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/propel/progress", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Partial<State> & { ok?: boolean; error?: string };
        if (!live) return;
        if (!r.ok || !j.ok) {
          setErr(r.status === 403 ? "" : j.error || `Could not load (${r.status})`);
          return;
        }
        setSt({ rows: j.rows ?? [], history: j.history ?? [], fetchedAt: j.fetchedAt ?? "", fetchedBy: j.fetchedBy ?? "" });
      })
      .catch(() => live && setErr("Could not load the Propel progress."));
    return () => {
      live = false;
    };
  }, []);

  // Day plans done in the last 7 days, from the oldest snapshot at least a week old.
  const weekAgo = useMemo(() => {
    if (!st?.history.length) return null;
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const older = st.history.filter((h) => h.on <= cutoff);
    return older.length ? older[older.length - 1] : null;
  }, [st]);

  if (err) return <p className="mb-3 text-xs text-[var(--danger)]">{err}</p>;
  if (!st) return null;

  const rows = behindOnly ? st.rows.filter((r) => r.gap < 0) : st.rows;
  const behind = st.rows.filter((r) => r.gap < 0).length;

  return (
    <section className="mb-4 space-y-2" aria-label="Propel progress">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Propel progress</h3>
          <p className="text-[11px] text-[var(--muted)]">
            {st.rows.length
              ? `Day plans marked done on Propel against its schedule · ${behind} of ${st.rows.length} behind · from Propel ${when(st.fetchedAt)}${st.fetchedBy ? ` by ${st.fetchedBy}` : ""}`
              : "Not brought in yet — on Propel, press the Office Robot's “Bring teacher progress to ERP”."}
          </p>
        </div>
        {st.rows.length ? (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={behindOnly} onChange={(e) => setBehindOnly(e.target.checked)} />
            Behind only
          </label>
        ) : null}
      </div>
      {st.rows.length ? (
        <ErpTableShell exportAs="propel_progress" exportTitle="Propel progress" density="compact">
          <div className="max-h-[min(60vh,560px)] overflow-x-auto">
            <ErpTable>
              <ErpTableHead sticky>
                <tr>
                  <th className="px-3 py-2 text-left">Teacher</th>
                  <th className="px-3 py-2 text-left">Class</th>
                  <th className="px-3 py-2 text-left">Subject</th>
                  <th className="px-3 py-2 text-right">Done</th>
                  <th className="px-3 py-2 text-right">Due by now</th>
                  <th className="px-3 py-2 text-right">Ahead / behind</th>
                  <th className="px-3 py-2 text-right">Last 7 days</th>
                  <th className="px-3 py-2 text-left">Last day plan</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {rows.map((r) => {
                  const before = weekAgo?.done[r.key];
                  const week = typeof before === "number" ? r.donePlans - before : null;
                  return (
                    <tr key={r.key}>
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                        {r.teacher || "—"}
                        {!r.staffId ? <span className="ml-1 text-[10px] text-[var(--muted)]">(not matched)</span> : null}
                      </td>
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                        {r.className}
                        {r.division ? `-${r.division}` : ""}
                      </td>
                      <td className="px-3 py-1.5 text-xs">{r.subject}</td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                        {r.donePlans}/{r.totalPlans}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums">{r.requiredPlans}</td>
                      <td
                        className={`px-3 py-1.5 text-right text-xs font-semibold tabular-nums ${r.gap < 0 ? "text-[var(--danger)]" : "text-[var(--tone-teal)]"}`}
                      >
                        {r.gap > 0 ? `+${r.gap}` : r.gap}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums">{week === null ? "—" : `+${week}`}</td>
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap">{r.lastPlanOn || "—"}</td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      ) : null}
    </section>
  );
}
