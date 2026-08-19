"use client";

/**
 * "Paste enquiry text" on the walk-in desk: email / WhatsApp / call note →
 * fields the counsellor ticks to apply to the enquiry form. Only what the
 * text says comes back; the "not found" list is shown, not filled.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { LeadExtract } from "@/lib/leadExtractAi";
import { concernLabel, PREVIOUS_BOARDS } from "@/lib/admissionsEnquiryForm";
import { languageLabel } from "@/lib/householdPrefs";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";

const FIELD_LABEL: Record<keyof Omit<LeadExtract, "summary" | "missing">, string> = {
  childName: "Child", dob: "Date of birth", gender: "Gender", classSoughtLabel: "Class sought", guardianName: "Father / guardian", motherName: "Mother", mobile: "Mobile", email: "Email", locality: "Locality", address: "Address", pincode: "PIN", previousSchool: "Previous school", previousBoard: "Previous board", transportInterest: "Transport", preferredLanguage: "Language", concerns: "What matters",
};

export function LeadExtractPanel({ onApply, canEdit, classNames }: { onApply: (fields: Partial<LeadExtract>, summary: string) => void; canEdit: boolean; classNames: string[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ extract: LeadExtract; generationId: string; engine: string } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  async function run() {
    if (busy || text.trim().length < 15) return;
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const r = await fetch("/api/ai/lead-extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, classNames }) });
      const j = (await r.json()) as { ok?: boolean; error?: string; extract?: LeadExtract; generationId?: string; engine?: string };
      if (!r.ok || !j.ok || !j.extract) return setError(j.error || "Extraction failed");
      setRes({ extract: j.extract, generationId: j.generationId || "", engine: j.engine || "" });
      setPicked(new Set((Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[]).filter((k) => { const v = j.extract![k]; return Array.isArray(v) ? v.length > 0 : !!v; })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!res) return;
    const fields: Partial<LeadExtract> = {};
    for (const k of picked) (fields as Record<string, unknown>)[k] = res.extract[k as keyof LeadExtract];
    onApply(fields, res.extract.summary);
    if (res.generationId) reportAiOutcome({ ids: [res.generationId], outcome: picked.size ? "accepted" : "rejected", targetType: "admission_lead", targetId: "enquiry_form" });
    setRes(null);
    setText("");
    setOpen(false);
  }

  if (!canEdit) return null;
  const display = (k: keyof typeof FIELD_LABEL, v: unknown) => {
    if (k === "concerns") return (v as string[]).map(concernLabel).join(", ");
    if (k === "previousBoard") return PREVIOUS_BOARDS.find((b) => b.id === v)?.label || String(v);
    if (k === "preferredLanguage") return languageLabel(String(v));
    return String(v);
  };

  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-3">
      <button type="button" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--brand-deep)]" onClick={() => setOpen((v) => !v)}>
        <Sparkles className="h-3.5 w-3.5" />
        Paste an email / WhatsApp / call note → fill the form
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <textarea className="field min-h-[6rem] text-[12px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={"e.g. Hi, I'm Rakesh Sharma, looking for Class VI admission for my son Aarav (DOB 4 Mar 2015). We live in Sigra, need bus. My number 99999 00001. What are the fees?"} />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy || text.trim().length < 15} className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-50" onClick={() => void run()}>
              {busy ? "Reading…" : "Extract"}
            </button>
            {error ? <span className="text-[11px] text-[var(--danger)]">{error}</span> : null}
          </div>
          {res ? (
            <div className="rounded-lg border border-[var(--border)] p-2 text-[12px]">
              {res.extract.summary ? <p className="mb-1 italic text-[var(--muted)]">&ldquo;{res.extract.summary}&rdquo;</p> : null}
              <ul className="grid gap-1 sm:grid-cols-2">
                {(Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[]).map((k) => {
                  const v = res.extract[k];
                  const has = Array.isArray(v) ? v.length > 0 : !!v;
                  return (
                    <li key={k} className={`flex items-start gap-2 ${has ? "" : "text-[var(--muted)]"}`}>
                      <input type="checkbox" disabled={!has} checked={picked.has(k)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                      <span>
                        <span className="text-[10px] uppercase text-[var(--muted)]">{FIELD_LABEL[k]}</span>
                        <br />
                        {has ? display(k, v) : "not in the text"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 flex gap-2">
                <button type="button" className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)]" onClick={apply}>
                  Apply {picked.size} field{picked.size === 1 ? "" : "s"} to the form
                </button>
                <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold" onClick={() => setRes(null)}>
                  Discard
                </button>
                <span className="ml-auto text-[10px] text-[var(--muted)]">{res.engine}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
