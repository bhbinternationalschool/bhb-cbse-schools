"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ensureWaTemplatesHydrated } from "@/lib/waTemplatesPersistence";
import {
  loadWaTemplates,
  listApprovedTemplates,
  WA_TEMPLATE_VARIABLES,
  type WaTemplate,
} from "@/lib/waTemplates";

type Audience = "parents" | "staff";

type TemplateSend = {
  name: string;
  language: string;
  variableKeys?: string[];
  variables?: Record<string, string>;
};

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
  payload: { body?: string; template?: TemplateSend },
  dryRun: boolean,
): Promise<BroadcastResult> {
  const res = await fetch("/api/v1/owner/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audience, ...payload, dryRun }),
  });
  const json = (await res.json()) as BroadcastResult;
  if (!res.ok) throw new Error(json.error || "Broadcast request failed");
  return json;
}

function variableLabel(key: string): string {
  return WA_TEMPLATE_VARIABLES.find((v) => v.key === key)?.label || key;
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
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<BroadcastResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentResult, setSentResult] = useState<BroadcastResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setTemplates(listApprovedTemplates(loadWaTemplates()));
    void ensureWaTemplatesHydrated().then(() => {
      setTemplates(listApprovedTemplates(loadWaTemplates()));
    });
  }, [open]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) || null,
    [templates, templateId],
  );

  function reset() {
    setAudience("parents");
    setMessage("");
    setTemplateId("");
    setTemplateVars({});
    setPreview(null);
    setError(null);
    setSentResult(null);
    setBusy(false);
  }

  function buildPayload(): { body?: string; template?: TemplateSend } {
    if (selectedTemplate) {
      return {
        template: {
          name: selectedTemplate.metaName,
          language: selectedTemplate.metaLanguage,
          variableKeys: selectedTemplate.variables,
          variables: templateVars,
        },
      };
    }
    return { body: message.trim() };
  }

  async function runPreview() {
    setError(null);
    setBusy(true);
    try {
      const result = await postBroadcast(audience, buildPayload(), true);
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
      const result = await postBroadcast(audience, buildPayload(), false);
      setSentResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Broadcast failed");
    } finally {
      setBusy(false);
    }
  }

  const canSend = selectedTemplate
    ? selectedTemplate.variables.every((k) => (templateVars[k] || "").trim())
    : !!message.trim();

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

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-[var(--brand-deep)]">
                Approved template (optional)
              </span>
              <select
                className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setTemplateVars({});
                  setPreview(null);
                }}
              >
                <option value="">Free text instead</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
            </label>

            {selectedTemplate ? (
              <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-2.5">
                <p className="whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
                  {selectedTemplate.body}
                </p>
                {selectedTemplate.variables.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-[var(--muted)]">
                      Same value is used for every recipient — this send has
                      no per-person data to fill placeholders with.
                    </p>
                    {selectedTemplate.variables.map((key) => (
                      <input
                        key={key}
                        className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                        placeholder={variableLabel(key)}
                        value={templateVars[key] || ""}
                        onChange={(e) => {
                          setTemplateVars((v) => ({ ...v, [key]: e.target.value }));
                          setPreview(null);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
                <p className="text-xs text-[var(--muted)]">
                  Templates reach every recipient regardless of the 24-hour
                  window.
                </p>
              </div>
            ) : (
              <>
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
                  school&apos;s WhatsApp number in the last 24 hours — Meta
                  blocks free text outside that window. Pick an approved
                  template above to reach everyone.
                </p>
              </>
            )}

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
                  disabled={busy || !canSend}
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
