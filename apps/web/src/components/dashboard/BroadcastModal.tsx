"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";

type Audience = "parents" | "staff";

type BroadcastResult = {
  ok?: boolean;
  mode?: string;
  recipientCount?: number;
  skippedOptOut?: number;
  sent?: number;
  failed?: number;
  error?: string;
};

async function postBroadcast(
  audience: Audience,
  body: string,
  dryRun: boolean,
): Promise<BroadcastResult> {
  const res = await fetch("/api/v1/owner/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audience, body, dryRun }),
  });
  const json = (await res.json()) as BroadcastResult;
  if (!res.ok) throw new Error(json.error || "Broadcast request failed");
  return json;
}

/** Owner-only school-wide WhatsApp broadcast: compose → dry-run preview →
 * explicit confirm. Never sends on a single click — this reaches every
 * parent or staff phone number on file. */
export function BroadcastModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [audience, setAudience] = useState<Audience>("parents");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<BroadcastResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentResult, setSentResult] = useState<BroadcastResult | null>(null);

  function reset() {
    setAudience("parents");
    setMessage("");
    setPreview(null);
    setError(null);
    setSentResult(null);
    setBusy(false);
  }

  async function runPreview() {
    setError(null);
    setBusy(true);
    try {
      const result = await postBroadcast(audience, message.trim(), true);
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not preview broadcast");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend() {
    setBusy(true);
    setError(null);
    try {
      const result = await postBroadcast(audience, message.trim(), false);
      setSentResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Broadcast failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup size="md">
        <DialogHeader>
          <DialogTitle>Broadcast WhatsApp message</DialogTitle>
        </DialogHeader>

        {sentResult ? (
          <div className="space-y-3">
            <DialogDescription>
              Sent to {sentResult.sent ?? 0} of {sentResult.recipientCount ?? 0}{" "}
              recipient(s)
              {sentResult.failed ? ` — ${sentResult.failed} failed` : ""}
              {sentResult.skippedOptOut
                ? ` — ${sentResult.skippedOptOut} skipped (opted out)`
                : ""}
              .
            </DialogDescription>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>Close</DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <DialogDescription>
              Sends a real WhatsApp message to every {audience === "parents" ? "parent household" : "active staff member"} on file. Preview the recipient count before sending.
            </DialogDescription>

            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-[var(--brand-deep)]">Audience</span>
              <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
                {(["parents", "staff"] as Audience[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      setAudience(a);
                      setPreview(null);
                    }}
                    className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
                      audience === a
                        ? "bg-[var(--brand-deep)] text-white"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setPreview(null);
              }}
              placeholder="Message text…"
              rows={4}
              className="w-full rounded-lg border border-[var(--border)] p-2.5 text-sm"
            />

            <p className="text-xs text-[var(--muted)]">
              Free text only reaches recipients who have messaged the
              school&apos;s WhatsApp number in the last 24 hours — Meta blocks
              free text
              outside that window. For a true broadcast to everyone, use an
              approved template instead (not yet wired into this bar).
            </p>

            {error ? (
              <p className="text-sm text-[var(--danger)]">{error}</p>
            ) : null}

            {preview ? (
              <div className="rounded-lg border border-[var(--info)]/25 bg-[var(--info-soft)] p-3 text-sm">
                <span className="font-semibold" style={{ color: "var(--info)" }}>
                  {preview.recipientCount ?? 0} recipient(s) will receive this
                </span>
                {preview.skippedOptOut ? (
                  <span className="block text-xs text-[var(--muted)]">
                    {preview.skippedOptOut} number(s) excluded (opted out of
                    WhatsApp messages)
                  </span>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              {preview ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || (preview.recipientCount ?? 0) === 0}
                  onClick={confirmSend}
                >
                  {busy
                    ? "Sending…"
                    : `Send to ${preview.recipientCount ?? 0} number(s)`}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={busy || !message.trim()}
                  onClick={runPreview}
                >
                  {busy ? "Checking…" : "Preview recipients"}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
