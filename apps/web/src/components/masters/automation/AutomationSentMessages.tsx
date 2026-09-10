"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MastersEmptyRow,
  MastersTableCard,
} from "@/components/masters/MastersLayout";
import type { WaDeliveryStage } from "@/lib/waDeliveryStatusShape";
import {
  emptyTally,
  type WaSentMessageRow as Row,
  type WaSentMessageTally as Tally,
} from "@/lib/waSentMessages";
import { autoBtnOutline, autoInp } from "./automationUi";
import { WaDeliveryTally, WaDeliveryTicks } from "./WaDeliveryTicks";

const WINDOWS: { id: string; label: string; days: number }[] = [
  { id: "1", label: "Today", days: 1 },
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
];

/** 919876543210 → 98765 43210, which is how the office reads a number. */
function prettyMobile(e164: string): string {
  const d = (e164 || "").replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return ten.length === 10 ? `${ten.slice(0, 5)} ${ten.slice(5)}` : e164 || "—";
}

function shortTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function AutomationSentMessages() {
  const [days, setDays] = useState("7");
  const [stage, setStage] = useState<WaDeliveryStage | "all">("all");
  const [purpose, setPurpose] = useState("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [tally, setTally] = useState<Tally>(emptyTally());
  const [purposes, setPurposes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sinceIso = useMemo(() => {
    const d = WINDOWS.find((w) => w.id === days)?.days ?? 7;
    return new Date(Date.now() - d * 86_400_000).toISOString();
  }, [days]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ since: sinceIso, limit: "300" });
      if (stage !== "all") p.set("stage", stage);
      if (purpose !== "all") p.set("purpose", purpose);
      if (search.trim()) p.set("search", search.trim());
      const res = await fetch(`/api/wa/sent-messages?${p.toString()}`);
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        rows?: Row[];
        tally?: Tally;
        purposes?: string[];
      };
      if (!res.ok || !json.ok) {
        // Never fall back to an empty table: "we could not read the log"
        // must not look like "the school sent nothing".
        setError(json.error || "Could not read the message log");
        return;
      }
      setRows(json.rows || []);
      setTally(json.tally || emptyTally());
      if (json.purposes?.length) setPurposes(json.purposes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the message log");
    } finally {
      setLoading(false);
    }
  }, [sinceIso, stage, purpose, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Window
            <select
              className={`${autoInp} mt-1`}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              {WINDOWS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Sent by
            <select
              className={`${autoInp} mt-1`}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              <option value="all">All modules</option>
              {purposes.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Search
            <input
              className={`${autoInp} mt-1`}
              placeholder="Mobile or template…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <button type="button" className={autoBtnOutline} onClick={() => void load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <WaDeliveryTally tally={tally} active={stage} onPick={setStage} />

      <p className="text-[11px] text-[var(--muted)]">
        Ticks come from WhatsApp itself. <strong>Read</strong> only ever
        appears if that family has read receipts switched on — a family who
        has turned them off stops at Delivered forever, and that is not a
        problem to chase.
      </p>

      {error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-[12px] text-rose-900">
          {error}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      ) : (
        <MastersTableCard title="Sent messages">
          {rows.length === 0 ? (
            <MastersEmptyRow
              label={
                loading
                  ? "Reading the message log…"
                  : "No WhatsApp messages sent in this window."
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <li key={r.id} className="space-y-1 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
                      {prettyMobile(r.mobile)}
                    </span>
                    <WaDeliveryTicks
                      stage={r.stage}
                      label={r.stageLabel}
                      className="text-[11px] font-semibold"
                    />
                  </div>
                  <p className="text-[11px] text-[var(--muted)]">
                    {shortTime(r.at)} · {r.purpose || "—"} ·{" "}
                    {r.templateName || r.via || "text"}
                    {r.readAt ? ` · read ${shortTime(r.readAt)}` : ""}
                    {!r.readAt && r.deliveredAt
                      ? ` · delivered ${shortTime(r.deliveredAt)}`
                      : ""}
                  </p>
                  {r.preview ? (
                    <p className="line-clamp-2 text-[11px] text-[var(--brand-deep)] opacity-80">
                      {r.preview}
                    </p>
                  ) : null}
                  {r.failureLabel ? (
                    <p className="text-[11px] font-medium text-rose-700">
                      {r.failureLabel}
                      {r.failureAdvice ? (
                        <span className="font-normal opacity-80">
                          {" — "}
                          {r.failureAdvice}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {r.error && r.error !== r.failureLabel ? (
                    <p className="text-[10px] text-[var(--muted)]">
                      WhatsApp said: {r.error}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </MastersTableCard>
      )}
    </div>
  );
}
