"use client";

/**
 * Comms → App pop-ups → Responses: one row per family — what they did with
 * the pop-up and, for Aadhaar, whose numbers are on record now (last 4
 * digits) and whether the office has verified them (lib/appPopupResponses).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { RowAction } from "@/components/ui/erp-grid";
import { OUTCOME_LABEL, type AadhaarSlot, type PopupOutcome, type ResponseRow } from "@/lib/appPopupResponses";

const FILTERS: ("all" | PopupOutcome)[] = ["all", "completed", "saved_some", "later", "seen", "not_seen"];

const istTime = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "";

function slotText(s: AadhaarSlot): string {
  if (!s.last4) return "Missing";
  return `••${s.last4} · ${s.status === "verified_udise" ? "verified" : "received"}`;
}

function Slot({ s }: { s: AadhaarSlot }) {
  const tone = !s.last4
    ? "text-[var(--danger)]"
    : s.status === "verified_udise"
      ? "text-[var(--success)]"
      : "text-[var(--warning)]";
  return <span className={`whitespace-nowrap text-xs font-medium ${tone}`}>{slotText(s)}</span>;
}

/** A parent's number is the same on every child; show it once (the first child that has it). */
const parentSlot = (row: ResponseRow, who: "father" | "mother"): AadhaarSlot =>
  row.children.map((c) => c[who]).find((s) => s.last4) ?? { last4: "", status: "missing" };

export function AppPopupResponses({ popupId, isAadhaar, canVerify }: { popupId: string; isAadhaar: boolean; canVerify: boolean }) {
  const [rows, setRows] = useState<ResponseRow[] | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetch(`/api/comms/app-popups/responses?id=${encodeURIComponent(popupId)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; rows?: ResponseRow[]; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error || `Could not load (${r.status})`);
      setRows(j.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the responses");
    }
  }, [popupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const verify = useCallback(
    async (studentId: string, who: "child" | "father" | "mother") => {
      setMsg("");
      const r = await fetch("/api/comms/app-popups/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, who }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; marked?: number; error?: string };
      setMsg(j.ok ? `Marked verified on ${j.marked} record(s).` : j.error || "Could not save — try again");
      if (j.ok) await load();
    },
    [load],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length ?? 0 };
    for (const r of rows ?? []) c[r.outcome] = (c[r.outcome] ?? 0) + 1;
    return c;
  }, [rows]);
  const shown = useMemo(() => (rows ?? []).filter((r) => filter === "all" || r.outcome === filter), [rows, filter]);

  const columns: DataTableColumn<ResponseRow>[] = [
    { key: "family", header: "Family", value: (r) => r.family, sortable: true, render: (r) => <span className="font-semibold">{r.family}</span> },
    {
      key: "children",
      header: "Children",
      value: (r) => r.children.map((c) => `${c.name} (${c.classLabel})`).join("; "),
      render: (r) => (
        <div className="space-y-0.5">
          {r.children.map((c) => (
            <p key={c.id} className="whitespace-nowrap text-xs">
              <a className="underline-offset-2 hover:underline" href={`/students/${c.id}/edit?tab=ids`}>
                {c.name}
              </a>{" "}
              <span className="text-[var(--muted)]">· {c.classLabel}</span>
            </p>
          ))}
        </div>
      ),
    },
    {
      key: "outcome",
      header: "Answer",
      value: (r) => OUTCOME_LABEL[r.outcome],
      sortable: true,
      render: (r) => (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            r.outcome === "completed"
              ? "bg-[var(--success-soft)] text-[var(--success)]"
              : r.outcome === "saved_some" || r.outcome === "later"
                ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                : "bg-[var(--surface)] text-[var(--muted)]"
          }`}
        >
          {OUTCOME_LABEL[r.outcome]}
        </span>
      ),
    },
    ...(isAadhaar
      ? ([
          {
            key: "gave",
            header: "Gave in the app",
            value: (r) => r.gave.map((g) => (g === "father" ? "Father" : g === "mother" ? "Mother" : r.children.find((c) => c.id === g)?.name || "Child")).join(", "),
            render: (r) => (
              <span className="text-xs">
                {r.gave.length
                  ? r.gave.map((g) => (g === "father" ? "Father" : g === "mother" ? "Mother" : r.children.find((c) => c.id === g)?.name || "Child")).join(", ")
                  : "—"}
              </span>
            ),
          },
          {
            key: "child",
            header: "Child's Aadhaar",
            value: (r) => r.children.map((c) => `${c.name}: ${slotText(c.child)}`).join("; "),
            render: (r) => (
              <div className="space-y-0.5">
                {r.children.map((c) => (
                  <p key={c.id}>
                    <Slot s={c.child} />
                  </p>
                ))}
              </div>
            ),
          },
          { key: "father", header: "Father's", value: (r) => slotText(parentSlot(r, "father")), render: (r) => <Slot s={parentSlot(r, "father")} /> },
          { key: "mother", header: "Mother's", value: (r) => slotText(parentSlot(r, "mother")), render: (r) => <Slot s={parentSlot(r, "mother")} /> },
        ] satisfies DataTableColumn<ResponseRow>[])
      : []),
    {
      key: "when",
      header: "Answered / last seen",
      value: (r) => istTime(r.doneAt || r.lastSeen),
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-[var(--muted)]">
          {r.doneAt ? `Answered ${istTime(r.doneAt)}` : r.lastSeen ? `Seen ${istTime(r.lastSeen)}${r.later ? ` · Later ×${r.later}` : ""}` : "—"}
        </span>
      ),
    },
  ];

  const needs = (r: ResponseRow, who: "father" | "mother") => {
    const s = parentSlot(r, who);
    return !!s.last4 && s.status !== "verified_udise";
  };
  const rowActions: RowAction<ResponseRow>[] = [
    {
      id: "open",
      label: "Open the child's record",
      onSelect: (r) => {
        if (r.children[0]) window.location.href = `/students/${r.children[0].id}/edit?tab=ids`;
      },
      disabled: (r) => !r.children.length,
    },
    ...(isAadhaar && canVerify
      ? ([
          {
            id: "v-children",
            label: "Mark children's Aadhaar verified on UDISE+",
            separatorAbove: true,
            onSelect: (r) => {
              void (async () => {
                for (const c of r.children) if (c.child.last4 && c.child.status !== "verified_udise") await verify(c.id, "child");
              })();
            },
            disabled: (r) => !r.children.some((c) => c.child.last4 && c.child.status !== "verified_udise"),
          },
          {
            id: "v-father",
            label: "Mark father's Aadhaar verified on UDISE+",
            onSelect: (r) => void verify(r.children[0]!.id, "father"),
            disabled: (r) => !needs(r, "father"),
          },
          {
            id: "v-mother",
            label: "Mark mother's Aadhaar verified on UDISE+",
            onSelect: (r) => void verify(r.children[0]!.id, "mother"),
            disabled: (r) => !needs(r, "mother"),
          },
        ] satisfies RowAction<ResponseRow>[])
      : []),
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter responses">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              filter === f ? "border-[var(--brand-deep)] font-semibold text-[var(--brand-deep)]" : "border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {f === "all" ? "All" : OUTCOME_LABEL[f]} ({counts[f] ?? 0})
          </button>
        ))}
        <button type="button" className="ml-auto text-xs text-[var(--muted)] underline" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {isAadhaar ? (
        <p className="text-[11px] text-[var(--muted)]">
          Only the last 4 digits are shown here. “Received” = typed by the family, not yet checked; mark it verified once it is entered and accepted on
          UDISE+. A parent’s number is marked on all their children.
        </p>
      ) : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {msg ? <p className="text-sm text-[var(--brand-deep)]">{msg}</p> : null}
      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(r) => r.householdId}
        loading={rows === null && !error}
        emptyTitle="No families here"
        emptyDescription={filter === "all" ? "Nobody has met this pop-up yet." : "No family has this answer."}
        rowActions={rowActions}
        exportFileBaseName={`popup-responses-${popupId}`}
        exportTitle="Pop-up responses"
        pageSize={25}
      />
    </div>
  );
}
