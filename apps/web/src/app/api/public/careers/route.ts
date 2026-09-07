/**
 * Public (no login) job application — the /careers page posts here.
 *
 * A stranger on the internet can reach this route, so it is written the
 * way a form open to the world has to be: rate-limited per IP, one
 * application per mobile per day, a hard size and type check before a
 * single byte reaches storage, and a vision call only AFTER all of that
 * has passed. The order matters — an OCR call is the expensive thing
 * here, and it must never be reachable by anyone who has not already got
 * past the cheap checks.
 *
 * What comes back to the applicant is deliberately thin: "we have it".
 * Not what the OCR read, not whether they matched a subject the school
 * teaches, not whether they have applied before. A public endpoint that
 * reports what it knows about a mobile number is a lookup tool for
 * anybody who wants one.
 */

import { NextResponse } from "next/server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { geminiConfigured, generateGeminiVisionJson } from "@/lib/erpAiGemini.server";
import {
  generateOpenAiVisionJson,
  openAiConfigured,
  openAiModel,
} from "@/lib/openAi.server";
import { recordAiGeneration } from "@/lib/aiGenerations.server";
import {
  JOB_CV_EXTRACT_PROMPT,
  JOB_CV_EXTRACT_SYSTEM,
  jobCvExtractIsUsable,
  parseJobCvExtract,
  type JobCvExtract,
} from "@/lib/jobCvExtractAi";
import {
  jobApplicationInputMessage,
  readJobApplicationInput,
  type JobApplicationOcrStatus,
} from "@/lib/jobApplications";
import {
  alertLeadershipOfJobApplication,
  createJobApplication,
  recentApplicationFor,
} from "@/lib/jobApplications.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/;

export async function GET() {
  return NextResponse.json({
    service: "public-careers",
    note: "POST { applicantName, mobile, email?, cv: dataUrl } — no login; JPG/PNG/WEBP/PDF ≤ 4 MB",
  });
}

// One IP gets a handful of tries an hour. Generous for a person filling a
// form twice, useless for a script.
const hits = new Map<string, { n: number; at: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now - cur.at > 3_600_000) {
    hits.set(ip, { n: 1, at: now });
    // The map is per-instance and unbounded otherwise; a busy hour on a
    // long-lived instance should not become a memory leak.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.at > 3_600_000) hits.delete(k);
    }
    return false;
  }
  cur.n += 1;
  return cur.n > 6;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0]!.trim() || req.headers.get("x-real-ip") || "unknown";
}

function extensionFor(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { error: "Too many applications from this connection. Please try again later." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = readJobApplicationInput(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: jobApplicationInputMessage(parsed.error) },
      { status: 400 },
    );
  }
  const input = parsed.value;

  // The CV itself.
  const dataUrl = String(body.cv ?? "");
  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) {
    return NextResponse.json(
      { error: "Please attach your CV as a PDF, JPG or PNG." },
      { status: 400 },
    );
  }
  const mimeType = m[1]!.toLowerCase();
  const base64 = m[2]!;
  if (!ALLOWED.test(mimeType)) {
    return NextResponse.json(
      { error: "Please attach a PDF, JPG, PNG or WEBP." },
      { status: 415 },
    );
  }
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is over 4 MB. Please attach a smaller PDF or photo." },
      { status: 413 },
    );
  }

  // Already applied today? Answer as though it worked. Telling a stranger
  // "you already applied" confirms which mobiles are on file.
  const recent = await recentApplicationFor(input.mobile);
  if (recent) {
    return NextResponse.json({ ok: true, received: true, duplicate: true });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "The school's system is unavailable right now. Please try again shortly." },
      { status: 503 },
    );
  }

  // Store the file first. A CV the office can open beats a perfect OCR of
  // a file nobody kept — if the model is down, the application still lands
  // with the document attached and a human can read it.
  const stamp = new Date();
  const path = `careers/${stamp.getUTCFullYear()}/${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${extensionFor(mimeType)}`;
  const buffer = Buffer.from(base64, "base64");
  const { error: uploadErr } = await ctx.sb.storage
    .from("school-files")
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (uploadErr) {
    console.warn("[careers] storage upload failed", uploadErr.message);
    return NextResponse.json(
      { error: "We couldn't save your CV. Please try again." },
      { status: 500 },
    );
  }

  // OCR. Gemini reads PDFs; OpenAI vision is the image-only fallback.
  let fields: JobCvExtract | null = null;
  let ocrStatus: JobApplicationOcrStatus = "failed";
  const t0 = Date.now();
  const errors: string[] = [];

  if (geminiConfigured()) {
    const r = await generateGeminiVisionJson({
      system: JOB_CV_EXTRACT_SYSTEM,
      prompt: JOB_CV_EXTRACT_PROMPT,
      base64,
      mimeType,
      maxTokens: 900,
    });
    if (r.ok) {
      fields = parseJobCvExtract(r.text);
      if (!fields) errors.push("gemini: unparseable reply");
    } else {
      errors.push(`gemini: ${r.error}`);
    }
    await recordAiGeneration({
      route: "public-careers-cv",
      promptVersion: "v1",
      tier: "flash",
      engine: "gemini",
      model: r.model,
      status: r.ok && fields ? "ok" : "error",
      error: r.ok ? (fields ? "" : "unparseable") : r.error,
      // The CV itself is never recorded — only its size and type.
      inputText: `cv ${mimeType}:${bytes}`,
      outputText: r.ok ? r.text : "",
      promptTokens: r.ok ? r.usage.promptTokens : null,
      completionTokens: r.ok ? r.usage.completionTokens : null,
      latencyMs: Date.now() - t0,
      requester: "careers-page",
    }).catch(() => {});
  }

  if (!fields && openAiConfigured() && mimeType !== "application/pdf") {
    const r = await generateOpenAiVisionJson<Record<string, unknown>>({
      system: JOB_CV_EXTRACT_SYSTEM,
      imageBase64: base64,
      mimeType,
      userHint: JOB_CV_EXTRACT_PROMPT,
      maxTokens: 900,
    });
    if (r.ok) {
      fields = parseJobCvExtract(r.rawText);
      if (!fields) errors.push("openai: unparseable reply");
    } else {
      errors.push(`openai: ${r.error}`);
    }
    await recordAiGeneration({
      route: "public-careers-cv",
      promptVersion: "v1",
      tier: "flash",
      engine: "openai",
      model: openAiModel(),
      status: r.ok && fields ? "ok" : "error",
      error: r.ok ? (fields ? "" : "unparseable") : r.error,
      inputText: `cv ${mimeType}:${bytes}`,
      outputText: r.ok ? r.rawText : "",
      promptTokens: null,
      completionTokens: null,
      latencyMs: Date.now() - t0,
      requester: "careers-page",
    }).catch(() => {});
  }

  if (fields) ocrStatus = jobCvExtractIsUsable(fields) ? "ok" : "unreadable";

  const created = await createJobApplication({
    source: "careers_page",
    // What the applicant typed wins over what the CV says: they know
    // their own name and number, and the typed mobile is the one the
    // school will ring.
    applicantName: input.applicantName,
    mobile: input.mobile,
    email: input.email || fields?.email || "",
    cvPath: path,
    cvMime: mimeType,
    subjectWords: fields?.subjects ?? [],
    classWords: fields?.classes ?? [],
    qualification: fields?.qualification ?? "",
    experienceYears: fields?.experienceYears ?? "",
    currentEmployer: fields?.currentEmployer ?? "",
    ocrStatus,
    ocrNotes: [fields?.notes, errors.join("; ")].filter(Boolean).join(" · ").slice(0, 300),
  });

  if (!created.ok) {
    console.warn("[careers] save failed", created.error);
    return NextResponse.json(
      { error: "We couldn't save your application. Please try again." },
      { status: 500 },
    );
  }

  // The applicant does not wait on the alert.
  void alertLeadershipOfJobApplication(created.application).catch(() => {});

  return NextResponse.json({ ok: true, received: true });
}
