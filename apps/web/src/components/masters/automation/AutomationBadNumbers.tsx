"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MastersEmptyRow,
  MastersTableCard,
} from "@/components/masters/MastersLayout";
import type { WaFailureKind } from "@/lib/waFailureReason";
import { autoBtnOutline, autoBtnPrimary } from "./automationUi";

type Row = {
  mobile: string;
  mobile10: string;
  householdId: string | null;
  guardianNames: string[];
  familyCount: number;
  children: string[];
  kind: WaFailureKind;
  label: string;
  advice: string;
  failures: number;
  lastFailedAt: string;
  rawReason: string;
  onWhatsApp: boolean | null;
  checkedAt: string | null;
  checkSource: string | null;
};

type RosterCheck = {
  ok?: boolean;
  checked?: number;
  onWhatsApp?: number;
  notOnWhatsApp?: number;
  noAnswer?: number;
  error?: string;
};

function prettyMobile(m10: string): string {
  return m10.length === 10 ? `${m10.slice(0, 5)} ${m10.slice(5)}` : m10;
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function AutomationBadNumbers({ readOnly }: { readOnly: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reachableButFailing, setReachable] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<RosterCheck | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wa/number-health");
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        rows?: Row[];
        reachableButFailing?: number;
      };
      if (!res.ok || !json.ok) {
        // Never an empty table on a failed read — that reads as "all fine".
        setError(json.error || "Could not read the number health");
        return;
      }
      setRows(json.rows || []);
      setReachable(json.reachableButFailing || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the number health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runRosterCheck() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Ask WhatsApp whether every active family's number is registered?\n\nThis contacts Meta once per 100 numbers and sends no messages to anyone.",
      )
    ) {
      return;
    }
    setChecking(true);
    setCheck(null);
    try {
      const res = await fetch("/api/wa/roster-check", { method: "POST" });
      const json = (await res.json()) as RosterCheck;
      setCheck(json);
      if (json.ok) await load();
    } catch (e) {
      setCheck({
        ok: false,
        error: e instanceof Error ? e.message : "The check could not run",
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-[12px] text-[var(--muted)]">
          Numbers WhatsApp cannot deliver to, one row per family. Only
          failures that are the <strong>number&apos;s</strong> fault are
          listed — a message that failed because it was sent outside the
          24-hour window says nothing about the number, so those are counted
          below rather than listed here.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={autoBtnOutline} onClick={() => void load()}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {!readOnly ? (
            <button
              type="button"
              className={autoBtnPrimary}
              disabled={checking}
              onClick={() => void runRosterCheck()}
            >
              {checking ? "Asking WhatsApp…" : "Check all family numbers"}
            </button>
          ) : null}
        </div>
      </div>

      {check ? (
        <div
          className={`rounded-xl border p-3 text-[12px] ${
            check.ok
              ? "border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {check.ok ? (
            <>
              Asked WhatsApp about {check.checked} number
              {check.checked === 1 ? "" : "s"}:{" "}
              <strong>{check.onWhatsApp}</strong> registered,{" "}
              <strong>{check.notOnWhatsApp}</strong> not on WhatsApp
              {check.noAnswer ? `, ${check.noAnswer} with no answer` : ""}.
            </>
          ) : (
            check.error || "The check could not run."
          )}
        </div>
      ) : null}

      {reachableButFailing > 0 ? (
        <p className="text-[11px] text-[var(--muted)]">
          {reachableButFailing} further number
          {reachableButFailing === 1 ? " has" : "s have"} had failures that are
          not the number&apos;s fault (usually the 24-hour window). Those
          families are reachable — see the Sent messages tab.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-[12px] text-rose-900">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : (
        <MastersTableCard title={`Numbers to fix (${rows.length})`}>
          {rows.length === 0 ? (
            <MastersEmptyRow
              label={
                loading
                  ? "Checking the message log…"
                  : "No number has failed for its own sake in the last 90 days."
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <li key={r.mobile10} className="space-y-1 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
                      {prettyMobile(r.mobile10)}
                      {r.guardianNames.length
                        ? ` · ${r.guardianNames.slice(0, 2).join(", ")}${
                            r.guardianNames.length > 2
                              ? ` +${r.guardianNames.length - 2} more`
                              : ""
                          }`
                        : ""}
                    </span>
                    <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                      {r.label}
                    </span>
                  </div>
                  {r.familyCount > 1 ? (
                    <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900">
                      {r.familyCount} families share this number — it is a
                      placeholder, not one family&apos;s mistake. Each needs
                      its own number.
                    </p>
                  ) : null}
                  {r.children.length ? (
                    <p className="text-[11px] text-[var(--brand-deep)]">
                      {r.children.length} child
                      {r.children.length === 1 ? "" : "ren"} affected:{" "}
                      {r.children.slice(0, 6).join(", ")}
                      {r.children.length > 6
                        ? ` +${r.children.length - 6} more`
                        : ""}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[var(--muted)]">
                      No active student matches this number — it may belong to
                      a lead or a family that has left.
                    </p>
                  )}
                  <p className="text-[11px] text-[var(--muted)]">
                    {r.failures > 0
                      ? `${r.failures} failed message${r.failures === 1 ? "" : "s"} · last ${shortDate(r.lastFailedAt)}`
                      : "No failed send — found by the WhatsApp check"}
                    {r.checkSource === "contacts_api" && r.checkedAt
                      ? ` · confirmed by WhatsApp ${shortDate(r.checkedAt)}`
                      : ""}
                  </p>
                  <p className="text-[11px] text-[var(--brand-deep)] opacity-80">
                    {r.advice}
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">
                    WhatsApp said: {r.rawReason || "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </MastersTableCard>
      )}
    </div>
  );
}
