"use client";

/**
 * Bank, UPI, Aadhaar, PAN and pay of ONE staff member — for the accountant
 * (the bank & pay details function, without staff · edit) and the owner
 * (data-layer 2.2b; director, 20–21 Oct 2026). Reads the record through
 * GET /api/data/sis.staff (whole rows for these sessions, never a password)
 * and saves only the fields changed here through
 * POST /api/data/sis.staff/sensitive (writeStaffSensitiveFields), on the
 * record's revision — a change made elsewhere first is a conflict, said, and
 * the panel shows the server's values again. Nothing else of the record can
 * be changed from here.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { readPage } from "@/lib/data/client/query";
import { writeStaffSensitiveFields } from "@/lib/data/client/mutate";
import { asRevision } from "@/lib/data/types";
import { bridgeStaffAfterWrite } from "@/lib/data/client/staffBridge";

type Row = Record<string, unknown>;

const FIELDS: { key: string; label: string; upper?: boolean }[] = [
  { key: "bankAccountName", label: "Account holder name" },
  { key: "bankName", label: "Bank name" },
  { key: "bankBranch", label: "Branch" },
  { key: "bankAccountNo", label: "Account number" },
  { key: "bankIfsc", label: "IFSC", upper: true },
  { key: "upiId", label: "UPI ID" },
  { key: "aadhaarNo", label: "Aadhaar number" },
  { key: "panNo", label: "PAN", upper: true },
  { key: "basicPay", label: "Basic pay (₹ a month)" },
];

const field = "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm";

export function StaffSensitiveDetailsPanel({ staffId }: { staffId: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await readPage<Row>("sis.staff", { limit: 500 });
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    const found = res.rows.find((r) => r.id === staffId) ?? null;
    if (!found) {
      setLoadError("This staff record could not be found (removed, or not on the roster).");
      return;
    }
    setLoadError(null);
    setRow(found);
    const p = (found.profile ?? {}) as Row;
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(p[f.key] ?? "")])));
  }, [staffId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!row) return;
    const p = (row.profile ?? {}) as Row;
    const changed: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = (draft[f.key] ?? "").trim();
      if (v !== String(p[f.key] ?? "").trim()) changed[f.key] = v;
    }
    if (Object.keys(changed).length === 0) {
      setMessage({ kind: "ok", text: "Nothing changed." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const r = await writeStaffSensitiveFields([
      { id: staffId, base: asRevision(String(row.updated_at ?? "")), fields: changed },
    ]);
    setSaving(false);
    // "Saved" only after the server said so.
    setMessage(
      r.ok
        ? { kind: "ok", text: `Saved: ${Object.keys(changed).join(", ")}.` }
        : { kind: "error", text: `Not saved — ${r.message}` },
    );
    await load();
    if (r.ok) void bridgeStaffAfterWrite();
  }

  if (loadError) return <p role="alert" className="text-sm text-[var(--danger)]">Could not load the record: {loadError}</p>;
  if (!row) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  return (
    <div className="space-y-4" data-testid="staff-sensitive-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Staff / bank, ID &amp; pay details</p>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">{String(row.full_name ?? "")}</h1>
          <p className="text-sm text-[var(--muted)]">
            {String(row.emp_code ?? "")} · Only these details can be changed here; the rest of the record is the office&apos;s.
          </p>
        </div>
        <Link
          href="/staff"
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
        >
          Back to roster
        </Link>
      </div>
      <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-xs font-semibold text-[var(--muted)]">
            {f.label}
            <input
              className={field}
              value={draft[f.key] ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [f.key]: f.upper ? e.target.value.toUpperCase() : e.target.value }))
              }
            />
          </label>
        ))}
      </div>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          data-testid="sensitive-save-message"
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === "error" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--card)] text-[var(--brand-deep)]"}`}
        >
          {message.text}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save bank, ID & pay details"}
        </button>
      </div>
    </div>
  );
}
