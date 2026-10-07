"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultTicked, type TeacherSyncReview, type TeacherSyncRow } from "@/lib/udiseTeacherSync";

const ENDPOINT = "/api/v1/udise/robot/teacher-details";

type Review = TeacherSyncReview & {
  fetchedAt: string;
  fetchedBy: string;
  listsRead: { teaching: boolean; non_teaching: boolean } | null;
};

type ApplyResult = { staffId: string; name: string; ok: boolean; applied: string[]; error?: string };

const tickKey = (staffId: string, field: string) => `${staffId}:${field}`;

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function defaultTicks(rows: TeacherSyncRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) for (const i of r.items) if (defaultTicked(i)) out.add(tickKey(r.erpStaffId, i.field));
  return out;
}

/**
 * Students → UDISE+ → what the robot read off the UDISE+ Teacher module
 * ("Fetch all teachers from portal") against ERP Staff. Missing-in-ERP
 * values start ticked, disagreements unticked; items the ERP cannot take
 * one-to-one are shown without a box. Nothing changes in Staff until a
 * person presses Apply, and the server re-checks every tick first.
 */
export function UdiseTeacherSyncCard() {
  const [review, setReview] = useState<Review | null>(null);
  const [ticks, setTicks] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"loading" | "ready" | "applying" | "error">("loading");
  const [msg, setMsg] = useState("");
  const [results, setResults] = useState<ApplyResult[]>([]);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      const body = (await res.json()) as Review & { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setReview(body);
      setTicks(defaultTicks(body.rows));
      setState("ready");
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Could not load the teacher review.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const matched = useMemo(() => (review?.rows ?? []).filter((r) => r.match === "matched"), [review]);
  const withItems = matched.filter((r) => r.items.length);
  const unmatched = (review?.rows ?? []).filter((r) => r.match !== "matched");

  const apply = async () => {
    if (!review) return;
    const changes = [];
    for (const r of matched) {
      for (const i of r.items) {
        if (!i.apply || !ticks.has(tickKey(r.erpStaffId, i.field))) continue;
        changes.push({ staffId: r.erpStaffId, field: i.field, value: i.apply.value, revisionAt: r.erpRevision });
      }
    }
    if (!changes.length) return;
    setState("applying");
    setMsg("");
    try {
      const res = await fetch(`${ENDPOINT}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string; results?: ApplyResult[] };
      if (!body.results) throw new Error(body.error || `HTTP ${res.status}`);
      setResults(body.results);
      await load();
    } catch (e) {
      setState("ready");
      setMsg(`Not applied: ${e instanceof Error ? e.message : "try again"}`);
    }
  };

  const tickedCount = matched.reduce(
    (n, r) => n + r.items.filter((i) => i.apply && ticks.has(tickKey(r.erpStaffId, i.field))).length,
    0,
  );

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="UDISE teachers portal vs ERP">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Teachers: portal vs ERP</h3>
        <p className="text-xs text-[var(--muted)]">
          {review?.fetchedAt
            ? `Fetched from UDISE+ by ${review.fetchedBy || "the robot"}, ${when(review.fetchedAt)}`
            : state === "loading"
              ? "Loading…"
              : "Not fetched yet"}
        </p>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        On the UDISE+ Teacher module&apos;s staff list, press the robot&apos;s “Fetch all teachers from portal”. What the
        portal holds and the ERP does not starts ticked; where they disagree starts unticked — check which is right.
        Lines without a box cannot be applied one-to-one (change them on the staff record). Nothing changes in Staff until
        you press Apply.
      </p>

      {state === "error" ? (
        <p className="mt-3 text-xs text-[var(--danger)]">{msg}</p>
      ) : !review?.fetchedAt ? null : (
        <>
          {review.listsRead && (!review.listsRead.teaching || !review.listsRead.non_teaching) ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              The {review.listsRead.teaching ? "non-teaching" : "teaching"} list was not read on the last fetch — nobody
              from it is called missing.
            </p>
          ) : null}
          <p className="mt-2 text-xs">
            {review.rows.length} on the portal · {matched.length} matched · {withItems.length} with something to review
          </p>

          {withItems.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--muted)]">Every matched teacher agrees with the ERP.</p>
          ) : (
            <div className="mt-2 space-y-3">
              {withItems.map((r) => (
                <div key={r.erpStaffId} className="rounded-lg border border-[var(--border)] p-2">
                  <p className="text-xs font-semibold text-[var(--brand-deep)]">
                    {r.erpName}
                    <span className="ml-2 font-normal text-[var(--muted)]">
                      portal: {r.portalName}
                      {r.nationalCode ? ` · ${r.nationalCode}` : ""} · {r.staffType === "teaching" ? "teaching" : "non-teaching"} ·
                      matched by {r.matchedBy === "national_code" ? "National Code" : "name + date of birth"}
                    </span>
                  </p>
                  {r.unread.length ? <p className="text-[11px] text-[var(--muted)]">Portal forms: {r.unread.join("; ")}</p> : null}
                  <table className="mt-1 w-full text-left text-[11px]">
                    <thead>
                      <tr className="text-[var(--muted)]">
                        <th className="w-6" />
                        <th className="pr-2">Field</th>
                        <th className="pr-2">ERP</th>
                        <th className="pr-2">Portal</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.items.map((i) => {
                        const k = tickKey(r.erpStaffId, i.field);
                        return (
                          <tr key={k} className="align-top">
                            <td>
                              {i.apply ? (
                                <input
                                  type="checkbox"
                                  aria-label={`Apply ${i.label} for ${r.erpName}`}
                                  checked={ticks.has(k)}
                                  disabled={state !== "ready"}
                                  onChange={(e) =>
                                    setTicks((t) => {
                                      const n = new Set(t);
                                      if (e.target.checked) n.add(k);
                                      else n.delete(k);
                                      return n;
                                    })
                                  }
                                />
                              ) : null}
                            </td>
                            <td className="pr-2">
                              {i.label}
                              <br />
                              <span className="text-[var(--muted)]">{i.action === "bring_into_erp" ? "missing in ERP" : "differs"}</span>
                            </td>
                            <td className="pr-2">{i.erp || <span className="text-[var(--muted)]">— blank —</span>}</td>
                            <td className="pr-2">{i.portal}</td>
                            <td className="text-[var(--muted)]">{i.note || ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {unmatched.length ? (
            <p className="mt-3 text-xs text-[var(--muted)]">
              Not matched to an ERP staff member (nothing offered):{" "}
              {unmatched
                .map((r) => `${r.portalName}${r.candidates.length ? ` (maybe ${r.candidates.join(" / ")})` : ""}`)
                .join(", ")}
              . Put the portal&apos;s National Code on the right staff record (Staff → OASIS / UDISE id), then reload.
            </p>
          ) : null}
          {review.notOnPortal.length ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              In the ERP but on no portal list read: {review.notOnPortal.map((x) => x.name).join(", ")}. The robot&apos;s
              “Add missing teachers” on the portal adds teaching staff one by one.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              disabled={state !== "ready" || tickedCount === 0}
              onClick={() => void apply()}
            >
              {state === "applying" ? "Applying…" : `Apply ${tickedCount} selected to ERP`}
            </button>
            <button type="button" className="text-xs underline" disabled={state === "applying"} onClick={() => void load()}>
              Reload
            </button>
            {msg ? <span className="text-xs text-[var(--muted)]">{msg}</span> : null}
          </div>
          {results.length ? (
            <ul className="mt-2 space-y-1 text-xs">
              {results.map((x) => (
                <li key={x.staffId} className={x.ok ? "" : "text-[var(--danger)]"}>
                  {x.name}: {x.ok ? `applied ${x.applied.join(", ")}` : x.error}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
