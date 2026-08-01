/**
 * Client helpers — Google Vision OCR via ERP API.
 */

import type {
  AdmissionDocOcrKind,
  AdmissionDocOcrSuggestion,
  BillOcrSuggestion,
} from "@/lib/ocrParse";

export function readFileAsDataUrlForOcr(
  file: File,
): Promise<
  { ok: true; url: string; mimeType: string } | { ok: false; error: string }
> {
  return new Promise((resolve) => {
    const okType =
      file.type.startsWith("image/") || file.type === "application/pdf";
    if (!okType) {
      resolve({ ok: false, error: "Choose a JPG, PNG, or PDF" });
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      resolve({ ok: false, error: "File too large (max 4 MB for OCR)" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      if (!url) {
        resolve({ ok: false, error: "Could not read file" });
        return;
      }
      resolve({
        ok: true,
        url,
        mimeType: file.type || "image/jpeg",
      });
    };
    reader.onerror = () => resolve({ ok: false, error: "Could not read file" });
    reader.readAsDataURL(file);
  });
}

function base64FromDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export async function runBillOcrApi(opts: {
  dataUrl?: string;
  imageBase64?: string;
  mimeType?: string;
  fileName?: string;
  photoNote?: string;
  fallbackAmountPaise: number;
  billDate?: string;
}): Promise<{
  ok: boolean;
  suggestion?: BillOcrSuggestion;
  visionConfigured?: boolean;
  error?: string;
  warning?: string;
}> {
  const imageBase64 =
    opts.imageBase64 ||
    (opts.dataUrl ? base64FromDataUrl(opts.dataUrl) : "");
  const res = await fetch("/api/ocr/bill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64,
      mimeType: opts.mimeType,
      fileName: opts.fileName,
      photoNote: opts.photoNote,
      fallbackAmountPaise: opts.fallbackAmountPaise,
      billDate: opts.billDate,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    suggestion?: BillOcrSuggestion;
    visionConfigured?: boolean;
    error?: string;
    warning?: string;
  };
  if (!res.ok) {
    return { ok: false, error: json.error || "OCR failed" };
  }
  return {
    ok: json.ok !== false,
    suggestion: json.suggestion,
    visionConfigured: json.visionConfigured,
    warning: json.warning,
  };
}

export async function runAdmissionDocOcrApi(opts: {
  dataUrl: string;
  mimeType?: string;
  kind: AdmissionDocOcrKind;
}): Promise<{
  ok: boolean;
  suggestion?: AdmissionDocOcrSuggestion;
  error?: string;
}> {
  const res = await fetch("/api/ocr/admission-doc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64: base64FromDataUrl(opts.dataUrl),
      mimeType: opts.mimeType,
      kind: opts.kind,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    suggestion?: AdmissionDocOcrSuggestion;
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: json.error || "OCR failed" };
  }
  return { ok: json.ok !== false, suggestion: json.suggestion };
}
