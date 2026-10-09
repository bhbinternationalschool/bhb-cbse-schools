"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { btnOutline, field } from "@/components/ui/erp-ui";
import { lastSeenLabel, type ClassGroup, type FamilyRow, type ParentsOnAppSummary } from "@/lib/parentsOnApp";

/**
 * Comms → Parents on app: who has the parent app, class by class, and when
 * each family last opened it. Classes start folded — the list only grows —
 * and each class keeps a folded "not on the app yet" list for nudging.
 */

type Data = { summary: ParentsOnAppSummary; classes: ClassGroup[]; asOf: string };

const istDateTime = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "—";

function matches(r: FamilyRow, q: string): boolean {
  if (!q) return true;
  const hay = `${r.guardianName} ${r.mobile} ${r.children.map((c) => c.name).join(" ")}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function FamilyLine({ r, now, onApp }: { r: FamilyRow; now: Date; onApp: boolean }) {
  const quiet = onApp && (!r.lastSeenAt || now.getTime() - Date.parse(r.lastSeenAt) >= 7 * 86_400_000);
  return (
    <li className="grid gap-x-3 gap-y-0.5 border-t border-[var(--border)] px-3 py-2 text-[12px] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_auto]">
      <div className="min-w-0">
        <p className="truncate font-semibold text-[var(--ink)]">{r.guardianName || "—"}</p>
        <p className="text-[11px] text-[var(--muted)]">{r.mobile || "no mobile"}</p>
      </div>
      <p className="min-w-0 text-[var(--ink)]">
        {r.children.map((c) => `${c.name}${c.className ? ` (${c.className})` : ""}`).join(", ")}
      </p>
      {onApp ? (
        <div className="text-[11px] sm:text-right">
          <p className={quiet ? "font-semibold text-[var(--danger)]" : "font-semibold text-[var(--tone-teal)]"} title={istDateTime(r.lastSeenAt)}>
            Opened {lastSeenLabel(r.lastSeenAt, now)}
          </p>
          <p className="text-[var(--muted)]">
            {r.phones} phone{r.phones === 1 ? "" : "s"} · joined {istDateTime(r.joinedAt)}
            {r.versions.length ? ` · v${r.versions.map((v) => v.split("+")[0]).join(", ")}` : ""}
          </p>
        </div>
      ) : (
        <span />
      )}
    </li>
  );
}

export function ParentsOnAppPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [openAll, setOpenAll] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/comms/parents-on-app", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Data & { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `Could not load (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const now = useMemo(() => new Date(data?.asOf || Date.now()), [data]);
  const classes = useMemo(
    () =>
      (data?.classes ?? [])
        .map((c) => ({ ...c, onApp: c.onApp.filter((r) => matches(r, q)), notOnApp: c.notOnApp.filter((r) => matches(r, q)) }))
        .filter((c) => !q || c.onApp.length || c.notOnApp.length),
    [data, q],
  );
  const s = data?.summary;
  const pct = s && s.families ? Math.round((s.familiesOnApp / s.families) * 100) : 0;

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="Parents on app">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Parents on the app</h3>
          <p className="text-[11px] text-[var(--muted)]">
            Families signed in to the BHB parent app, class by class. &ldquo;Opened&rdquo; is the last time any of the family&apos;s phones opened the app (India time).
          </p>
        </div>
        <button type="button" className={btnOutline} onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}

      {s ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { label: "Families on app", value: `${s.familiesOnApp} / ${s.families}`, hint: `${pct}% of families` },
            { label: "Phones", value: String(s.phones), hint: "signed in" },
            { label: "Opened today", value: String(s.openedToday), hint: "families" },
            { label: "Opened this week", value: String(s.openedThisWeek), hint: "families" },
            { label: "Quiet 7+ days", value: String(s.quiet), hint: "on app, not opening" },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{k.label}</p>
              <p className="text-lg font-bold text-[var(--brand-deep)]">{k.value}</p>
              <p className="text-[10px] text-[var(--muted)]">{k.hint}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${field} max-w-xs`}
          placeholder="Search parent, child or mobile…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search families"
        />
        <button type="button" className={btnOutline} onClick={() => setOpenAll(true)}>
          Open all
        </button>
        <button type="button" className={btnOutline} onClick={() => setOpenAll(false)}>
          Close all
        </button>
      </div>

      <div className="space-y-2">
        {classes.map((c) => {
          const share = c.families ? Math.round((c.onApp.length / c.families) * 100) : 0;
          const open = openAll ?? !!q;
          return (
            <details key={`${c.classId}-${String(open)}`} open={open} className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                <span className="font-semibold text-[var(--brand-deep)]">{c.className}</span>
                <span className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                  <span className="font-semibold text-[var(--tone-teal)]">{c.onApp.length}</span> of {c.families} families on app
                  <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-[var(--border)]" aria-hidden>
                    <span className="block h-full bg-[var(--tone-teal)]" style={{ width: `${share}%` }} />
                  </span>
                </span>
              </summary>
              {c.onApp.length ? (
                <ul>
                  {c.onApp.map((r) => (
                    <FamilyLine key={r.householdId} r={r} now={now} onApp />
                  ))}
                </ul>
              ) : (
                <p className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">No family of this class is on the app yet.</p>
              )}
              {c.notOnApp.length ? (
                <details className="border-t border-[var(--border)]">
                  <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-semibold text-[var(--muted)]">
                    Not on the app yet ({c.notOnApp.length})
                  </summary>
                  <ul>
                    {c.notOnApp.map((r) => (
                      <FamilyLine key={r.householdId} r={r} now={now} onApp={false} />
                    ))}
                  </ul>
                </details>
              ) : null}
            </details>
          );
        })}
        {data && !classes.length ? <p className="text-[12px] text-[var(--muted)]">No family matches &ldquo;{q}&rdquo;.</p> : null}
      </div>
      <p className="text-[10px] text-[var(--muted)]">
        A family with children in two classes is listed under both. Totals at the top count each family once.
      </p>
    </section>
  );
}
