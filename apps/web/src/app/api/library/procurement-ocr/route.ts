import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  generateOpenAiVisionJson,
  openAiConfigured,
} from "@/lib/openAi.server";

export const runtime = "nodejs";

export type LibraryProcurementOcrLineItem = {
  description?: string;
  qty?: number;
  amount?: number;
};

export type LibraryProcurementOcrResult = {
  vendor: string;
  billNo: string;
  billDate: string;
  lineItems: LibraryProcurementOcrLineItem[];
  totalAmount: number | null;
  gst: string;
  notes: string;
  confidence: "high" | "medium" | "low" | "partial";
};

const SYSTEM_PROMPT = `You are an OCR assistant for Indian school library procurement bills and challans.
Extract fields from the image and return JSON with this shape:
{
  "vendor": "supplier / shop name",
  "billNo": "invoice or bill number",
  "billDate": "YYYY-MM-DD if possible",
  "lineItems": [{ "description": "book title or item", "qty": 1, "amount": 0 }],
  "totalAmount": 1234.56,
  "gst": "GSTIN or tax note if visible",
  "notes": "any other relevant text",
  "confidence": "high" | "medium" | "low" | "partial"
}
Use empty strings for missing text fields, empty array for lineItems, null for totalAmount if unknown.
Amounts are in INR rupees (not paise). Dates must be ISO YYYY-MM-DD or empty string.`;

function normalizeOcrPayload(raw: Record<string, unknown>): LibraryProcurementOcrResult {
  const lineItems = Array.isArray(raw.lineItems)
    ? raw.lineItems
        .filter((x) => x && typeof x === "object")
        .map((x) => {
          const row = x as Record<string, unknown>;
          return {
            description: String(row.description || ""),
            qty: row.qty != null ? Number(row.qty) : undefined,
            amount: row.amount != null ? Number(row.amount) : undefined,
          };
        })
    : [];

  const confRaw = String(raw.confidence || "partial").toLowerCase();
  const confidence =
    confRaw === "high" || confRaw === "medium" || confRaw === "low"
      ? confRaw
      : "partial";

  let totalAmount: number | null = null;
  if (raw.totalAmount != null && raw.totalAmount !== "") {
    const n = Number(raw.totalAmount);
    if (!Number.isNaN(n)) totalAmount = n;
  }

  return {
    vendor: String(raw.vendor || ""),
    billNo: String(raw.billNo || raw.bill_no || ""),
    billDate: String(raw.billDate || raw.bill_date || "").slice(0, 10),
    lineItems,
    totalAmount,
    gst: String(raw.gst || raw.gstin || ""),
    notes: String(raw.notes || raw.note || ""),
    confidence,
  };
}

export async function GET() {
  return NextResponse.json({
    service: "library-procurement-ocr",
    openAiConfigured: openAiConfigured(),
    note: "POST { imageBase64, mimeType }",
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "store", "edit");
  if (!auth.ok) return auth.response;

  if (!openAiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "OPENAI_API_KEY not configured — add it to enable bill OCR",
        openAiConfigured: false,
      },
      { status: 503 },
    );
  }

  let body: { imageBase64?: string; mimeType?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const imageBase64 = (body.imageBase64 || "").trim();
  if (!imageBase64) {
    return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
  }

  if (body.mimeType === "application/pdf") {
    return NextResponse.json(
      {
        ok: false,
        error: "PDF not supported for OpenAI vision OCR — use a JPG or PNG scan",
        openAiConfigured: true,
      },
      { status: 400 },
    );
  }

  const result = await generateOpenAiVisionJson<Record<string, unknown>>({
    system: SYSTEM_PROMPT,
    imageBase64,
    mimeType: body.mimeType || "image/jpeg",
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, openAiConfigured: true },
      { status: 502 },
    );
  }

  const suggestion = normalizeOcrPayload(result.data);
  const partial =
    suggestion.confidence === "low" || suggestion.confidence === "partial";
  const warning = partial
    ? "OCR returned partial data — please verify vendor, bill no., date, and amount"
    : undefined;

  return NextResponse.json({
    ok: true,
    openAiConfigured: true,
    suggestion,
    warning,
    rawTextPreview: result.rawText.slice(0, 400),
  });
}
