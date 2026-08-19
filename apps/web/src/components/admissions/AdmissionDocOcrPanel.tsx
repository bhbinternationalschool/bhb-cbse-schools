"use client";

import { useState } from "react";
import {
  readFileAsDataUrlForOcr,
  runAdmissionDocOcrApi,
} from "@/lib/ocrClient";
import type { AdmissionDocOcrKind } from "@/lib/ocrParse";
import type { ApplicationExtract } from "@/lib/applicationExtractAi";

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

type Props = {
  disabled?: boolean;
  onApply: (patch: {
    childName?: string;
    dob?: string;
    pincode?: string;
    docsBirthCert?: boolean;
    docsAadhaar?: boolean;
    registrationFeeNote?: string;
  }) => void;
  /** Whole application form → many fields (AI vision); optional so older callers still work */
  onApplyApplication?: (fields: ApplicationExtract) => void;
};

type Kind = AdmissionDocOcrKind | "application_form";

export function AdmissionDocOcrPanel({ disabled, onApply, onApplyApplication }: Props) {
  const [kind, setKind] = useState<Kind>("birth_cert");
  const [missing, setMissing] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState("image/jpeg");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastConfidence, setLastConfidence] = useState<string | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    const r = await readFileAsDataUrlForOcr(file);
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    setPreview(r.url);
    setMimeType(r.mimeType);
    setNotice(null);
  }

  async function runApplicationExtract() {
    if (!preview || disabled || busy) return;
    setBusy(true);
    setNotice(null);
    setMissing([]);
    try {
      const res = await fetch("/api/ai/application-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: preview, mimeType }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; fields?: ApplicationExtract; engine?: string; model?: string };
      if (!res.ok || !json.ok || !json.fields) {
        setNotice(json.error || "Could not read the form");
        return;
      }
      const f = json.fields;
      onApplyApplication?.(f);
      setLastConfidence(json.model || json.engine || "ai");
      setMissing(f.missing);
      const filled = ["studentName", "dob", "gender", "classSought", "fatherName", "motherName", "mobile", "address", "pincode", "previousSchool"].filter(
        (k) => (f as unknown as Record<string, string>)[k],
      ).length;
      setNotice(`${filled} field${filled === 1 ? "" : "s"} filled from the form — review every one before saving.${f.notes ? ` Note: ${f.notes}` : ""}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not read the form");
    } finally {
      setBusy(false);
    }
  }

  async function runOcr() {
    if (!preview || disabled || busy) return;
    if (kind === "application_form") return runApplicationExtract();
    setBusy(true);
    setNotice(null);
    try {
      const r = await runAdmissionDocOcrApi({
        dataUrl: preview,
        mimeType,
        kind,
      });
      if (!r.ok || !r.suggestion) {
        setNotice(r.error || "OCR failed");
        return;
      }
      const s = r.suggestion;
      setLastConfidence(s.confidence.replace("vision_", "").replace("demo_", ""));
      const patch: Parameters<Props["onApply"]>[0] = {};
      if (s.childName) patch.childName = s.childName;
      if (s.dob) patch.dob = s.dob;
      if (s.pincode) patch.pincode = s.pincode;
      if (kind === "birth_cert" && s.childName) patch.docsBirthCert = true;
      if (kind === "aadhaar" && s.aadhaar) {
        patch.docsAadhaar = true;
        patch.registrationFeeNote = s.aadhaar
          ? `Aadhaar OCR: ${s.aadhaar}`
          : undefined;
      }
      if (s.registrationNo) {
        patch.registrationFeeNote = [
          patch.registrationFeeNote,
          `Reg# ${s.registrationNo}`,
        ]
          .filter(Boolean)
          .join(" · ");
      }
      onApply(patch);
      setNotice(s.note);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-[rgba(32,48,80,0.02)] p-3">
      <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
        Scan document
      </p>
      <p className="mt-0.5 text-[10px] text-[var(--muted)]">
        {kind === "application_form"
          ? "Photograph or upload the filled application form — AI reads every field (name, DOB, class, parents, mobile, address, previous school) and lists what is blank. Review before saving; nothing is stored until you save the lead."
          : "Photograph birth certificate or Aadhaar — OCR fills child name, DOB, pincode. Review before saving."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          className={`${inp} max-w-[180px] text-[12px]`}
          value={kind}
          disabled={disabled}
          onChange={(e) =>
            setKind(e.target.value as Kind)
          }
        >
          {onApplyApplication ? <option value="application_form">Application form (AI)</option> : null}
          <option value="birth_cert">Birth certificate</option>
          <option value="aadhaar">Aadhaar card</option>
          <option value="generic">Other document</option>
        </select>
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          <span className="sr-only">Upload scan</span>
          <input
            type="file"
            accept={kind === "application_form" ? "image/*,application/pdf" : "image/*"}
            disabled={disabled}
            className="block max-w-xs text-[11px]"
            onChange={(e) => void onFile(e.target.files?.[0] || null)}
          />
        </label>
        <button
          type="button"
          disabled={disabled || busy || !preview}
          className="rounded-lg bg-[#0f766e] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
          onClick={() => void runOcr()}
        >
          {busy ? "Reading…" : kind === "application_form" ? "Read form" : "Run OCR"}
        </button>
      </div>
      {preview && preview.startsWith("data:image") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Document preview"
          className="mt-2 max-h-24 rounded-lg border border-[rgba(32,48,80,0.12)]"
        />
      ) : null}
      {notice ? (
        <p className="mt-2 text-[10px] text-[var(--muted)]">{notice}</p>
      ) : null}
      {lastConfidence ? (
        <p className="mt-1 text-[10px] text-[#0f766e]">
          {kind === "application_form" ? "Read by" : "Confidence"}: {lastConfidence}
        </p>
      ) : null}
      {missing.length ? (
        <p className="mt-1 text-[10px] text-[var(--danger)]">
          Blank / illegible on the form: {missing.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
