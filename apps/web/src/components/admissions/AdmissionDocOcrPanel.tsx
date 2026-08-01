"use client";

import { useState } from "react";
import {
  readFileAsDataUrlForOcr,
  runAdmissionDocOcrApi,
} from "@/lib/ocrClient";
import type { AdmissionDocOcrKind } from "@/lib/ocrParse";

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
};

export function AdmissionDocOcrPanel({ disabled, onApply }: Props) {
  const [kind, setKind] = useState<AdmissionDocOcrKind>("birth_cert");
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

  async function runOcr() {
    if (!preview || disabled || busy) return;
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
        Scan document (Google Vision)
      </p>
      <p className="mt-0.5 text-[10px] text-[var(--muted)]">
        Photograph birth certificate or Aadhaar — OCR fills child name, DOB,
        pincode. Review before saving.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          className={`${inp} max-w-[180px] text-[12px]`}
          value={kind}
          disabled={disabled}
          onChange={(e) =>
            setKind(e.target.value as AdmissionDocOcrKind)
          }
        >
          <option value="birth_cert">Birth certificate</option>
          <option value="aadhaar">Aadhaar card</option>
          <option value="generic">Other document</option>
        </select>
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          <span className="sr-only">Upload scan</span>
          <input
            type="file"
            accept="image/*"
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
          {busy ? "Reading…" : "Run OCR"}
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
          Confidence: {lastConfidence}
        </p>
      ) : null}
    </div>
  );
}
