/**
 * Client helpers — Google Vision OCR via ERP API.
 */

import type {
  AdmissionDocOcrKind,
  AdmissionDocOcrSuggestion,
  BillOcrSuggestion,
} from "@/lib/ocrParse";
import type { SyllabusOcrChapter, syllabusOcrQuality } from "@/lib/syllabusOcr";

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

export type LibraryProcurementOcrSuggestion = {
  vendor: string;
  billNo: string;
  billDate: string;
  lineItems: { description?: string; qty?: number; amount?: number }[];
  totalAmount: number | null;
  gst: string;
  notes: string;
  confidence: "high" | "medium" | "low" | "partial";
};

export async function runLibraryProcurementOcrApi(opts: {
  imageBase64: string;
  mimeType?: string;
}): Promise<{
  ok: boolean;
  suggestion?: LibraryProcurementOcrSuggestion;
  openAiConfigured?: boolean;
  error?: string;
  warning?: string;
}> {
  const res = await fetch("/api/library/procurement-ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64: opts.imageBase64,
      mimeType: opts.mimeType,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    suggestion?: LibraryProcurementOcrSuggestion;
    openAiConfigured?: boolean;
    error?: string;
    warning?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: json.error || "OCR failed",
      openAiConfigured: json.openAiConfigured,
    };
  }
  return {
    ok: json.ok !== false,
    suggestion: json.suggestion,
    openAiConfigured: json.openAiConfigured,
    warning: json.warning,
    error: json.error,
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

export async function runProfileDocOcrApi(opts: {
  subject: "student" | "staff";
  subjectId: string;
  docKey: string;
  dataUrl: string;
  mimeType?: string;
}): Promise<{
  ok: boolean;
  result?: import("@/lib/docVerificationOcr").DocVerificationOcrResult;
  error?: string;
  visionConfigured?: boolean;
}> {
  const res = await fetch("/api/ocr/profile-doc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: opts.subject,
      subjectId: opts.subjectId,
      docKey: opts.docKey,
      imageBase64: base64FromDataUrl(opts.dataUrl),
      mimeType: opts.mimeType,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: import("@/lib/docVerificationOcr").DocVerificationOcrResult;
    error?: string;
    visionConfigured?: boolean;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: json.error || "OCR failed",
      visionConfigured: json.visionConfigured,
    };
  }
  return {
    ok: json.ok !== false,
    result: json.result,
    visionConfigured: json.visionConfigured,
  };
}

export type SyllabusOcrApiResult = {
  ok: boolean;
  chapters?: SyllabusOcrChapter[];
  ignored?: string[];
  quality?: ReturnType<typeof syllabusOcrQuality>;
  rawText?: string;
  source?: "text" | "ocr";
  error?: string;
  visionConfigured?: boolean;
};

/**
 * Parse a contents list pasted as text — no OCR, no Vision key.
 *
 * This is the e-book path: the book's page is already digital, so a teacher
 * copies its contents list rather than photographing the screen. The parser
 * and the review step downstream are exactly the same as for a scan.
 */
export async function parseSyllabusTextApi(
  text: string,
): Promise<SyllabusOcrApiResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Paste the contents list first" };
  const res = await fetch("/api/ocr/syllabus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: trimmed }),
  });
  const json = (await res.json().catch(() => ({}))) as SyllabusOcrApiResult;
  if (!res.ok) {
    return { ok: false, error: json.error || "Could not read that list" };
  }
  return json;
}

/** Read a textbook contents page into chapter/topic candidates. */
export async function runSyllabusOcrApi(opts: {
  dataUrl: string;
  mimeType?: string;
}): Promise<SyllabusOcrApiResult> {
  const res = await fetch("/api/ocr/syllabus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64: base64FromDataUrl(opts.dataUrl),
      mimeType: opts.mimeType,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as SyllabusOcrApiResult;
  if (!res.ok) {
    return {
      ok: false,
      error: json.error || "Could not read that page",
      visionConfigured: json.visionConfigured,
    };
  }
  return json;
}
