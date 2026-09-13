"use client";

/**
 * Office relay: which office phone receives which kind of message the bot
 * could not answer, and the permanent record of every forward and reply.
 *
 * Two halves on one screen because they answer each other: someone setting up
 * numbers wants to see what has actually been arriving, and someone reading
 * the record wants to see who was meant to receive it.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ErpPanel, ErpTableShell } from "@/components/ui/erp-roster";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import {
  RELAY_CATEGORIES,
  relayCategoryLabel,
  relayMobile10,
  type RelayCategory,
  type RelayRoute,
} from "@/lib/waRelay";

type LogRow = {
  id: string;
  code: string;
  category: string;
  reason: string;
  senderName: string;
  senderMobile10: string;
  senderContext: string;
  text: string;
  mediaNote: string;
  status: string;
  createdAt: string;
  repliedAt: string | null;
  forwards: { officeName: string; officeMobile10: string; via: string; status: string; error: string; sentAt: string }[];
  replies: { officeName: string; body: string; matchedBy: string; status: string; error: string; at: string }[];
};

const STATUS_LABEL: Record<string, string> = {
  forwarded: "Forwarded — awaiting reply",
  replied: "Replied",
  no_route: "No office number set",
  failed: "Forward failed",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function newRoute(): RelayRoute {
  return {
    id: `rr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    mobile10: "",
    categories: [],
    active: true,
  };
}

export function OfficeRelayPanel({ readOnly }: { readOnly: boolean }) {
  const [routes, setRoutes] = useState<RelayRoute[] | null>(null);
  const [draftMobiles, setDraftMobiles] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [days, setDays] = useState("30");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const loadRoutes = useCallback(async () => {
    try {
      const r = await fetch("/api/wa/relay/routes", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRoutes(j.routes as RelayRoute[]);
      setDraftMobiles({});
    } catch (e) {
      // Never show an empty editor over a failed read: saving that would erase
      // the numbers the office already set.
      setRoutes(null);
      setError(`Could not read the office numbers: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const loadLog = useCallback(async () => {
    const p = new URLSearchParams({ days });
    if (category) p.set("category", category);
    if (status) p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    try {
      const r = await fetch(`/api/wa/relay/log?${p.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRows(j.rows as LogRow[]);
    } catch (e) {
      setRows(null);
      setError(`Could not read the message record: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [days, category, status, q]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);
  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  // Which categories nobody has taken, so they visibly fall to the catch-all.
  const uncovered = useMemo(() => {
    if (!routes) return [];
    const active = routes.filter((r) => r.active);
    const hasGeneral = active.some((r) => r.categories.includes("general"));
    return RELAY_CATEGORIES.filter(
      (c) => c.id !== "general" && !active.some((r) => r.categories.includes(c.id)),
    ).map((c) => ({ ...c, fallsToGeneral: hasGeneral }));
  }, [routes]);

  function patch(id: string, p: Partial<RelayRoute>) {
    setRoutes((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...p } : r)) : prev));
  }

  function toggleCategory(id: string, cat: RelayCategory) {
    setRoutes((prev) =>
      prev
        ? prev.map((r) =>
            r.id !== id
              ? r
              : {
                  ...r,
                  categories: r.categories.includes(cat)
                    ? r.categories.filter((c) => c !== cat)
                    : [...r.categories, cat],
                },
          )
        : prev,
    );
  }

  async function save() {
    if (!routes) return;
    setError("");
    setNotice("");
    // Resolve what was typed into ten digits, and refuse to save anything that
    // is not a real mobile rather than dropping the row silently.
    const resolved = routes.map((r) => {
      const typed = draftMobiles[r.id];
      return { ...r, mobile10: relayMobile10(typed !== undefined ? typed : r.mobile10) };
    });
    const bad = resolved.filter((r) => !r.mobile10);
    if (bad.length > 0) {
      setError(`Enter a valid 10-digit mobile for: ${bad.map((b) => b.name || "(unnamed)").join(", ")}`);
      return;
    }
    const noCats = resolved.filter((r) => r.categories.length === 0);
    if (noCats.length > 0) {
      setError(`Choose at least one kind of message for: ${noCats.map((b) => b.name || b.mobile10).join(", ")}`);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/wa/relay/routes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes: resolved }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRoutes(j.routes as RelayRoute[]);
      setDraftMobiles({});
      setNotice("Saved. Messages the bot cannot answer now go to these numbers.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const inp = field;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">{notice}</div>
      ) : null}

      <ErpPanel
        title="Office numbers"
        description="When the bot cannot answer a message, it is forwarded to every number that has taken that kind of message. The office replies from their own WhatsApp — swipe right on the forward, or start the message with its #code — and the answer goes back from the school number."
      >
        {routes === null ? (
          <p className="text-sm text-muted-foreground">Reading the office numbers…</p>
        ) : (
          <>
            {routes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No office numbers yet. Until one is added, nothing the bot hands over reaches anybody.
              </p>
            ) : null}

            <div className="space-y-3">
              {routes.map((r) => (
                <div key={r.id} className="rounded-xl border border-[var(--border)] p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Name</span>
                      <input
                        className={`${inp} !w-44`}
                        value={r.name}
                        placeholder="Fees desk"
                        disabled={readOnly}
                        onChange={(e) => patch(r.id, { name: e.target.value })}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">WhatsApp number</span>
                      <input
                        className={`${inp} !w-40`}
                        inputMode="numeric"
                        value={draftMobiles[r.id] ?? r.mobile10}
                        placeholder="98765 43210"
                        disabled={readOnly}
                        onChange={(e) => setDraftMobiles((d) => ({ ...d, [r.id]: e.target.value }))}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={r.active}
                        disabled={readOnly}
                        onChange={(e) => patch(r.id, { active: e.target.checked })}
                      />
                      Active
                    </label>
                    {!readOnly ? (
                      <button
                        type="button"
                        className={`${btnOutline} ml-auto`}
                        onClick={() => setRoutes((prev) => (prev ? prev.filter((x) => x.id !== r.id) : prev))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {RELAY_CATEGORIES.map((c) => {
                      const on = r.categories.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          title={c.hint}
                          disabled={readOnly}
                          onClick={() => toggleCategory(r.id, c.id)}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                            on
                              ? "bg-[var(--brand-deep)] text-white"
                              : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)]"
                          }`}
                          aria-pressed={on}
                        >
                          {on ? "✓ " : ""}
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {uncovered.length > 0 ? (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                No number has taken: {uncovered.map((u) => u.label).join(", ")}.{" "}
                {uncovered[0]?.fallsToGeneral
                  ? "These go to the General (catch-all) number."
                  : "With no General (catch-all) number either, these reach nobody."}
              </p>
            ) : null}

            {!readOnly ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={btnOutline} onClick={() => setRoutes((p) => [...(p ?? []), newRoute()])}>
                  + Add a number
                </button>
                <button type="button" className={btn} disabled={saving} onClick={() => void save()}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            ) : null}

            <p className="mt-3 text-xs text-muted-foreground">
              WhatsApp only lets the school write freely to a phone that has messaged the school number in the last 24 hours.
              Ask each office phone to send &quot;hi&quot; to the school number every morning, or forwards outside that window
              need the approved &quot;bhb_office_relay&quot; template.
            </p>
          </>
        )}
      </ErpPanel>

      <ErpPanel
        title="Message record"
        description="Every message handed to the office, who received it, and every reply sent back. Kept permanently."
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Period</span>
            <select className={`${inp} !w-32`} value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="1">Today</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="365">1 year</option>
              <option value="3650">Everything</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Kind</span>
            <select className={`${inp} !w-44`} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All kinds</option>
              {RELAY_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Status</span>
            <select className={`${inp} !w-52`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Search</span>
            <input
              className={`${inp} !w-56`}
              value={q}
              placeholder="Name, number, #code or words"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button type="button" className={btnOutline} onClick={() => void loadLog()}>
            Refresh
          </button>
        </div>

        {rows === null ? (
          <p className="mt-3 text-sm text-muted-foreground">Could not load the record, or it is still loading.</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing handed to the office in this period.</p>
        ) : (
          <ErpTableShell className="mt-3" exportAs="office-relay-record">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left">When</th>
                  <th className="px-2 py-2 text-left">Code</th>
                  <th className="px-2 py-2 text-left">Kind</th>
                  <th className="px-2 py-2 text-left">From</th>
                  <th className="px-2 py-2 text-left">Message</th>
                  <th className="px-2 py-2 text-left">Sent to</th>
                  <th className="px-2 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr
                      className="cursor-pointer border-t border-[var(--border)] align-top hover:bg-[var(--muted)]"
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                    >
                      <td className="whitespace-nowrap px-2 py-2">{when(r.createdAt)}</td>
                      <td className="px-2 py-2 font-mono">#{r.code}</td>
                      <td className="px-2 py-2">{relayCategoryLabel(r.category)}</td>
                      <td className="px-2 py-2">
                        <div className="font-medium">{r.senderName || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.senderMobile10}
                          {r.senderContext ? ` · ${r.senderContext}` : ""}
                        </div>
                      </td>
                      <td className="max-w-md px-2 py-2">
                        <div className="line-clamp-2">{r.text || r.mediaNote || "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.reason}</div>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {r.forwards.length === 0
                          ? "—"
                          : r.forwards.map((f) => `${f.officeName}${f.status === "failed" ? " (failed)" : ""}`).join(", ")}
                      </td>
                      <td className="px-2 py-2 text-xs">{STATUS_LABEL[r.status] || r.status}</td>
                    </tr>
                    {open === r.id ? (
                      <tr className="border-t border-[var(--border)] bg-[var(--muted)]">
                        <td colSpan={7} className="px-3 py-3 text-xs">
                          <div className="mb-2 whitespace-pre-wrap text-sm">{r.text || r.mediaNote || "(no text)"}</div>
                          <div className="font-semibold">Forwards</div>
                          {r.forwards.length === 0 ? (
                            <div className="text-muted-foreground">None — no office number was set for this kind.</div>
                          ) : (
                            r.forwards.map((f, i) => (
                              <div key={i}>
                                {when(f.sentAt)} · {f.officeName} ({f.officeMobile10}) · via {f.via} · {f.status}
                                {f.error ? ` — ${f.error}` : ""}
                              </div>
                            ))
                          )}
                          <div className="mt-2 font-semibold">Replies</div>
                          {r.replies.length === 0 ? (
                            <div className="text-muted-foreground">No reply yet.</div>
                          ) : (
                            r.replies.map((x, i) => (
                              <div key={i} className="mt-1">
                                {when(x.at)} · <strong>{x.officeName}</strong> ({x.matchedBy === "code" ? "by code" : "swipe reply"}) · {x.status}
                                {x.error ? ` — ${x.error}` : ""}
                                <div className="whitespace-pre-wrap">&quot;{x.body}&quot;</div>
                              </div>
                            ))
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ErpTableShell>
        )}
      </ErpPanel>
    </div>
  );
}
