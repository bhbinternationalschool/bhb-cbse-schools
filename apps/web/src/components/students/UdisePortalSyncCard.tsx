"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FieldDiff, SyncField } from "@/lib/udisePortalStudentSync";

type PenHit = {
  pen: string;
  name: string;
  dob: string;
  father: string;
  mother: string;
  schoolName: string;
  udiseCode: string;
  classDesc: string;
  yearDesc: string;
  statusDesc: string;
};
type Child = {
  erpId: string;
  name: string;
  className: string;
  admissionNo: string;
  pen: string;
  revisionAt: string;
  onPortal: boolean;
  matchedBy: string;
  why: string;
  portalName: string;
  epRead: boolean;
  diffs: FieldDiff[];
  penSearch: { checkedAt: string; searched: boolean; error?: string; hits: PenHit[] } | null;
};
type Data = {
  academicYearCode: string;
  ourUdiseCode: string;
  fetchedAt: string;
  portalCount: number;
  children: Child[];
  notInErp: { pen: string; name: string; classDesc: string }[];
};
type View = "bring" | "differs" | "pen" | "notInErp";

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Students → UDISE+ → Portal ↔ ERP. What the robot read off UDISE+ (each
 * child's full record, and the PEN finder's search), lined up with the ERP:
 * what the ERP is missing, where the two disagree, and PENs to confirm.
 * Nothing changes in the ERP until the office ticks it and presses Apply
 * (director, 7 Oct 2026).
 */
export function UdisePortalSyncCard() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [view, setView] = useState<View>("bring");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/udise/robot/student-diff", { cache: "no-store" });
      const body = (await res.json()) as Data & { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
      setErr("");
      // Missing in the ERP: ticked by default. Disagreements: never.
      const t: Record<string, boolean> = {};
      for (const c of body.children) for (const d of c.diffs) if (d.action === "bring_into_erp") t[`${c.erpId}:${d.field}`] = true;
      setTicked(t);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the comparison");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const kids = data?.children ?? [];
    return {
      bring: kids.filter((c) => c.diffs.some((d) => d.action === "bring_into_erp")),
      differs: kids.filter((c) => c.diffs.some((d) => d.action !== "bring_into_erp")),
      pen: kids.filter((c) => !c.pen && c.penSearch),
      noPenUnsearched: kids.filter((c) => !c.pen && !c.penSearch).length,
    };
  }, [data]);

  const tickedItems = useMemo(() => {
    const byChild = new Map<string, SyncField[]>();
    for (const [k, v] of Object.entries(ticked)) {
      if (!v) continue;
      const [erpId, field] = k.split(":") as [string, SyncField];
      byChild.set(erpId, [...(byChild.get(erpId) ?? []), field]);
    }
    return byChild;
  }, [ticked]);
  const tickedCount = [...tickedItems.values()].reduce((n, f) => n + f.length, 0);

  async function apply(items: { erpId: string; revisionAt: string; fields?: SyncField[]; penFromSearch?: string }[]) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/udise/robot/student-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; applied?: number; results?: { erpId: string; ok: boolean; error?: string }[] };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const failed = (body.results || []).filter((r) => !r.ok);
      const nameOf = (id: string) => data?.children.find((c) => c.erpId === id)?.name || id;
      setMsg({
        ok: failed.length === 0,
        text:
          `Written to the ERP for ${body.applied} child${body.applied === 1 ? "" : "ren"}.` +
          (failed.length ? ` Not written: ${failed.map((f) => `${nameOf(f.erpId)} — ${f.error}`).join("; ")}` : ""),
      });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: `Nothing written: ${e instanceof Error ? e.message : "try again"}` });
    } finally {
      setBusy(false);
    }
  }

  const applyTicked = () =>
    void apply(
      [...tickedItems.entries()].map(([erpId, fields]) => ({
        erpId,
        revisionAt: data?.children.find((c) => c.erpId === erpId)?.revisionAt || "",
        fields,
      })),
    );

  const tabs: { id: View; label: string; n: number }[] = [
    { id: "bring", label: "Missing in the ERP", n: groups.bring.length },
    { id: "differs", label: "Different / to check", n: groups.differs.length },
    { id: "pen", label: "PEN finder", n: groups.pen.length },
    { id: "notInErp", label: "On UDISE+, not in the ERP", n: data?.notInErp.length ?? 0 },
  ];

  const list = view === "bring" ? groups.bring : view === "differs" ? groups.differs : [];
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="UDISE portal and ERP">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Robot — Portal ↔ ERP</h3>
        <p className="text-xs text-[var(--muted)]">
          {data?.fetchedAt
            ? `Portal read ${when(data.fetchedAt)} · ${data.portalCount} children`
            : data
              ? "Not read from the portal yet"
              : "Loading…"}
        </p>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        In Chrome on UDISE+, press <strong>Fetch all children&apos;s details to ERP</strong> (and{" "}
        <strong>Find PENs for ERP children without one</strong>). What the portal knows that the ERP is missing is ticked
        for you; where the two disagree, you choose. Nothing changes in the ERP until you press Apply.
      </p>
      {err ? <p className="mt-2 text-xs text-[var(--danger)]">{err}</p> : null}

      {data ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setView(t.id)}
                className={`min-h-9 rounded-full px-3 text-xs font-semibold ${
                  view === t.id ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "border border-[var(--border)] text-[var(--brand-deep)]"
                }`}
              >
                {t.label} ({t.n})
              </button>
            ))}
          </div>

          {view === "bring" || view === "differs" ? (
            list.length ? (
              <>
                <ul className="mt-3 max-h-[28rem] divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]">
                  {list.map((c) => (
                    <li key={c.erpId} className="px-3 py-2">
                      <p className="text-sm font-semibold text-[var(--brand-deep)]">
                        {c.name}
                        <span className="ml-2 text-[11px] font-normal text-[var(--muted)]">
                          {c.className} · {c.pen ? `PEN ${c.pen}` : "no PEN in ERP"}
                          {c.matchedBy === "evidence" ? ` · matched on the portal as ${c.portalName} (${c.why})` : ""}
                        </span>
                      </p>
                      <ul className="mt-1 space-y-1">
                        {c.diffs
                          .filter((d) => (view === "bring" ? d.action === "bring_into_erp" : d.action !== "bring_into_erp"))
                          .map((d) => {
                            const k = `${c.erpId}:${d.field}`;
                            return (
                              <li key={k} className="flex items-start gap-2 text-xs">
                                {d.action === "check" ? (
                                  <span className="mt-0.5 w-4 text-center text-[var(--muted)]" title="Shown for you to check — never written by the robot">
                                    ⓘ
                                  </span>
                                ) : (
                                  <input
                                    type="checkbox"
                                    className="mt-0.5"
                                    checked={!!ticked[k]}
                                    onChange={(e) => setTicked((t) => ({ ...t, [k]: e.target.checked }))}
                                    aria-label={`Bring ${d.label} into the ERP for ${c.name}`}
                                  />
                                )}
                                <span>
                                  <span className="font-semibold">{d.label}:</span>{" "}
                                  <span className="text-[var(--muted)]">ERP</span> {d.erp || "—"}{" "}
                                  <span className="text-[var(--muted)]">· UDISE+</span> <strong>{d.portal}</strong>
                                  {d.action === "check" ? <span className="text-[var(--muted)]"> (check by hand)</span> : null}
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={busy || tickedCount === 0}
                    onClick={applyTicked}
                    className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  >
                    {busy ? "Writing…" : `Apply ${tickedCount} ticked change${tickedCount === 1 ? "" : "s"} to the ERP`}
                  </button>
                  {msg ? <span className={`text-xs ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</span> : null}
                </div>
              </>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]">
                {data.fetchedAt ? "Nothing here — the ERP and UDISE+ agree on these." : "Fetch from the portal first."}
              </p>
            )
          ) : null}

          {view === "pen" ? (
            <div className="mt-3 space-y-2">
              {groups.noPenUnsearched ? (
                <p className="text-xs text-[var(--muted)]">
                  {groups.noPenUnsearched} child{groups.noPenUnsearched === 1 ? "" : "ren"} without a PEN not searched yet — press
                  “Find PENs for ERP children without one” on UDISE+.
                </p>
              ) : null}
              {groups.pen.map((c) => {
                const ps = c.penSearch!;
                const here = ps.hits.filter((h) => h.udiseCode.replace(/\D/g, "") === data.ourUdiseCode && data.ourUdiseCode);
                const elsewhere = ps.hits.filter((h) => !here.includes(h));
                return (
                  <div key={c.erpId} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                    <p className="text-sm font-semibold text-[var(--brand-deep)]">
                      {c.name} <span className="font-normal text-[var(--muted)]">· {c.className} · searched {when(ps.checkedAt)}</span>
                    </p>
                    {!ps.searched ? (
                      <p className="text-[var(--danger)]">Could not search: {ps.error}</p>
                    ) : !ps.hits.length ? (
                      <p className="text-[var(--muted)]">Not found anywhere on UDISE+ — add the child (Nursery–Class I) or wait for the portal to allow it.</p>
                    ) : null}
                    {here.map((h) => (
                      <p key={h.pen} className="mt-1 flex flex-wrap items-center gap-2">
                        <span>
                          At this school: <strong>PEN {h.pen}</strong> — {h.name}, {h.dob}, {h.father} / {h.mother} · {h.classDesc} {h.yearDesc}{" "}
                          {h.statusDesc}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void apply([{ erpId: c.erpId, revisionAt: c.revisionAt, penFromSearch: h.pen }])}
                          className="btn-accent rounded-lg px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
                        >
                          Put this PEN on {c.name.split(" ")[0]}
                        </button>
                      </p>
                    ))}
                    {elsewhere.map((h) => (
                      <p key={h.pen} className="mt-1 text-[var(--warning,#a15c00)]">
                        At another school: PEN {h.pen} — {h.name}, {h.dob} · {h.schoolName} ({h.udiseCode}) · {h.classDesc} {h.yearDesc}{" "}
                        {h.statusDesc} → ask that school to release the child, then import from the Dropbox.
                      </p>
                    ))}
                  </div>
                );
              })}
              {msg ? <p className={`text-xs ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</p> : null}
            </div>
          ) : null}

          {view === "notInErp" ? (
            data.notInErp.length ? (
              <ul className="mt-3 space-y-1 text-xs">
                {data.notInErp.map((x) => (
                  <li key={`${x.pen}${x.name}`}>
                    {x.name} · {x.classDesc} · {x.pen ? `PEN ${x.pen}` : "no PEN yet"} — no active ERP child matches (left school, or
                    in the ERP under another name: see the robot&apos;s list check).
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]">Every child on UDISE+ is matched to an ERP child.</p>
            )
          ) : null}
        </>
      ) : null}
    </section>
  );
}
