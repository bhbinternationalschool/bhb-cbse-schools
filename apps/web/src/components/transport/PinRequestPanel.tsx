"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Asking transport families where their child actually waits for the bus.
 *
 * WHY THE COUNTS COME FIRST
 * The point of this screen is the first row of numbers: how many families the
 * school can place to a doorstep, and how many it knows only as "somewhere in
 * this village". On 12 Sep 2026 that was 0 and 117. A send button with no
 * number beside it invites sending to everyone because everyone is the only
 * option offered.
 *
 * WHY SENDING TAKES TWO PRESSES
 * These are real WhatsApp messages to real parents, charged per conversation,
 * about their home location. The first press previews exactly who would get
 * one; the second sends. A family who declined never appears in either, and a
 * family already asked is not asked again by accident.
 */

type Row = {
  householdId: string;
  guardianName: string;
  mobileMasked: string;
  childNames: string[];
  busNo: string;
  precision: "pin" | "household" | "village" | "none";
  status: "never_asked" | "asked" | "pinned" | "declined" | "failed";
  sendable: boolean;
  blockedBecause: string;
};

type Overview = {
  households: number;
  byPrecision: Record<Row["precision"], number>;
  byStatus: Record<Row["status"], number>;
  rows: Row[];
};

type Preview = {
  wouldSend: number;
  skipped: number;
  targets: { householdId: string; guardianName: string; mobileMasked: string; childNames: string[] }[];
};

const SCOPES: { key: string; label: string; hint: string }[] = [
  {
    key: "no_location",
    label: "Nothing at all",
    hint: "no pin, no address, no village — the school cannot place these families anywhere",
  },
  {
    key: "village_only",
    label: "Village or worse",
    hint: "located only to a census centroid: right village, wrong corner, about a kilometre out",
  },
  { key: "all", label: "Every transport family", hint: "including those already placed well" },
];

export function PinRequestPanel({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("no_location");
  const [limit, setLimit] = useState(5);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/transport/pin-request", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Could not read the request state");
        return;
      }
      setData(body);
      setError("");
    } catch {
      setError("Could not reach the server");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(confirm: boolean) {
    setBusy(true);
    setError("");
    if (confirm) setResult("");
    try {
      const res = await fetch("/api/transport/pin-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, limit, confirm }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Failed");
        return;
      }
      if (body.dryRun) {
        setPreview(body);
        return;
      }
      setPreview(null);
      setResult(
        `Sent to ${body.sent} of ${body.attempted}${body.failed ? ` · ${body.failed} failed` : ""}.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const placed = data ? data.byPrecision.pin + data.byPrecision.household : 0;
  const vague = data ? data.byPrecision.village + data.byPrecision.none : 0;

  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">
        Ask families where their child waits
      </h2>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        A WhatsApp message in the family&apos;s own language explaining why we
        are asking, what it is used for, who sees it, and that their
        transport does not change if they would rather not send it. A pin they
        send is recorded for every riding child in that household, and the
        reply names them so a family can correct it.
      </p>

      {error ? (
        <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Transport families" value={data.households} />
            <Stat
              label="Placed to a doorstep"
              value={placed}
              tone={placed === 0 ? "danger" : "ok"}
            />
            <Stat
              label="Village or nothing"
              value={vague}
              tone={vague > 0 ? "danger" : "ok"}
            />
            <Stat label="Sent us a pin" value={data.byStatus.pinned} tone="ok" />
          </div>

          <p className="mt-2 text-[10px] text-[var(--muted)]">
            Asked and waiting: {data.byStatus.asked} · declined:{" "}
            {data.byStatus.declined} · send failed: {data.byStatus.failed} · never
            asked: {data.byStatus.never_asked}
            {data.byStatus.declined > 0
              ? " — families who declined are never asked again."
              : ""}
          </p>

          {canEdit ? (
            <div className="mt-3 rounded-lg bg-[var(--surface-sunken)] p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Who to ask
                  </span>
                  <select
                    className="field !py-1.5"
                    value={scope}
                    onChange={(e) => {
                      setScope(e.target.value);
                      setPreview(null);
                    }}
                  >
                    {SCOPES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[10px] text-[var(--muted)]">
                    {SCOPES.find((s) => s.key === scope)?.hint}
                  </span>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    How many this run
                  </span>
                  <input
                    className="field !py-1.5"
                    type="number"
                    min={1}
                    max={200}
                    value={limit}
                    onChange={(e) => {
                      setLimit(Number(e.target.value) || 1);
                      setPreview(null);
                    }}
                  />
                  <span className="mt-1 block text-[10px] text-[var(--muted)]">
                    Start small. Read the replies before sending the rest.
                  </span>
                </label>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--brand-mid)] px-3 py-1.5 text-xs font-bold text-[var(--brand-mid)] disabled:opacity-40"
                  onClick={() => void run(false)}
                  disabled={busy}
                >
                  {busy && !preview ? "Checking…" : "Preview who gets one"}
                </button>
                {preview ? (
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-bold text-[var(--primary-foreground)] disabled:opacity-40"
                    onClick={() => void run(true)}
                    disabled={busy || preview.wouldSend === 0}
                  >
                    {busy ? "Sending…" : `Send to ${preview.wouldSend} famil${preview.wouldSend === 1 ? "y" : "ies"}`}
                  </button>
                ) : null}
              </div>

              {preview ? (
                <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2">
                  <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                    {preview.wouldSend} would get a message
                    {preview.skipped > 0
                      ? ` · ${preview.skipped} skipped (already asked, already pinned, declined, quiet hours, or no number)`
                      : ""}
                  </p>
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                    {preview.targets.map((t) => (
                      <li key={t.householdId} className="text-[10px] text-[var(--muted)]">
                        {t.guardianName} · {t.mobileMasked} ·{" "}
                        {t.childNames.join(", ")}
                      </li>
                    ))}
                  </ul>
                  {preview.wouldSend === 0 ? (
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      Nobody to ask in this group right now.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {result ? (
                <p className="mt-2 text-[11px] font-semibold text-[var(--success)]">
                  {result}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-[var(--muted)]">
              Sending needs transport edit permission.
            </p>
          )}

          <p className="mt-2 text-[10px] text-[var(--muted)]">
            The template must be approved by Meta before anything can send —
            an unapproved one fails at Meta rather than going quietly nowhere.
            Submit <strong>bhb_transport_pin_request</strong> from the WhatsApp
            templates desk first.
          </p>
        </>
      ) : !error ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">Loading…</p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "danger";
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
      <div
        className={`text-lg font-bold tabular-nums ${
          tone === "danger"
            ? "text-[var(--danger)]"
            : tone === "ok"
              ? "text-[var(--success)]"
              : "text-[var(--brand-deep)]"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] text-[var(--muted)]">{label}</div>
    </div>
  );
}
