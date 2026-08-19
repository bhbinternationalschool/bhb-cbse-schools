/**
 * Admission application form → fields. Gemini multimodal (OCR + structure
 * in one call); OpenAI vision as fallback. Nothing persisted — the office
 * reviews the fields in the lead form before saving. Recorded in
 * ai_generations (route application-extract; hashes only, no image).
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { geminiConfigured, generateGeminiVisionJson } from "@/lib/erpAiGemini.server";
import { generateOpenAiVisionJson, openAiConfigured, openAiModel } from "@/lib/openAi.server";
import { recordAiGeneration } from "@/lib/aiGenerations.server";
import {
  APPLICATION_EXTRACT_PROMPT,
  APPLICATION_EXTRACT_SYSTEM,
  parseApplicationExtract,
  type ApplicationExtract,
} from "@/lib/applicationExtractAi";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({
    service: "application-extract",
    engines: { gemini: geminiConfigured(), openai: openAiConfigured() },
    note: "POST { dataUrl | base64 + mimeType } (jpg/png/webp/pdf ≤ 4 MB) — staff with admissions:edit; returns { fields, missing }, saves nothing",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (!hasPermission(session, masters, "admissions", "edit")) {
    return NextResponse.json({ error: "Admissions edit permission required" }, { status: 403 });
  }
  let body: { dataUrl?: unknown; base64?: unknown; mimeType?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  let base64 = "";
  let mimeType = String(body.mimeType ?? "").trim();
  const dataUrl = String(body.dataUrl ?? "");
  if (dataUrl.startsWith("data:")) {
    const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]*)$/);
    if (!m) return NextResponse.json({ error: "Bad data URL" }, { status: 400 });
    mimeType = mimeType || m[1];
    base64 = m[2];
  } else {
    base64 = String(body.base64 ?? "").replace(/^data:[^;]+;base64,/, "");
  }
  if (!base64 || !/^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/.test(mimeType)) {
    return NextResponse.json({ error: "Send a JPG, PNG, WEBP or PDF" }, { status: 400 });
  }
  if ((base64.length * 3) / 4 > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 4 MB)" }, { status: 400 });
  }

  const requester = session.email || session.fullName || "staff";
  const t0 = Date.now();
  let fields: ApplicationExtract | null = null;
  let engine: "gemini" | "openai" | "none" = "none";
  let model = "";
  const errors: string[] = [];

  if (geminiConfigured()) {
    const r = await generateGeminiVisionJson({
      system: APPLICATION_EXTRACT_SYSTEM,
      prompt: APPLICATION_EXTRACT_PROMPT,
      base64,
      mimeType,
      maxTokens: 1500,
    });
    model = r.model;
    if (r.ok) {
      fields = parseApplicationExtract(r.text);
      engine = "gemini";
      if (!fields) errors.push("gemini: unparseable reply");
    } else {
      errors.push(`gemini: ${r.error}`);
    }
    await recordAiGeneration({
      route: "application-extract",
      promptVersion: "v1",
      tier: "flash",
      engine: "gemini",
      model: r.model,
      status: r.ok && fields ? "ok" : "error",
      error: r.ok ? (fields ? "" : "unparseable") : r.error,
      inputText: `${APPLICATION_EXTRACT_SYSTEM}\n${mimeType}:${base64.length}`,
      outputText: r.ok ? r.text : "",
      promptTokens: r.ok ? r.usage.promptTokens : null,
      completionTokens: r.ok ? r.usage.completionTokens : null,
      latencyMs: Date.now() - t0,
      requester,
    });
  }
  if (!fields && openAiConfigured() && mimeType !== "application/pdf") {
    const t1 = Date.now();
    const r = await generateOpenAiVisionJson<Record<string, unknown>>({
      system: APPLICATION_EXTRACT_SYSTEM,
      imageBase64: base64,
      mimeType,
      userHint: APPLICATION_EXTRACT_PROMPT,
      maxTokens: 1500,
    });
    if (r.ok) {
      fields = parseApplicationExtract(r.rawText);
      engine = "openai";
      model = openAiModel();
      if (!fields) errors.push("openai: unparseable reply");
    } else {
      errors.push(`openai: ${r.error}`);
    }
    await recordAiGeneration({
      route: "application-extract",
      promptVersion: "v1",
      tier: "flash",
      engine: "openai",
      model: openAiModel(),
      status: r.ok && fields ? "ok" : "error",
      error: r.ok ? (fields ? "" : "unparseable") : r.error,
      inputText: `${APPLICATION_EXTRACT_SYSTEM}\n${mimeType}:${base64.length}`,
      outputText: r.ok ? r.rawText : "",
      latencyMs: Date.now() - t1,
      requester,
    });
  }
  if (!fields) {
    return NextResponse.json(
      { error: errors[0] || "No vision engine configured (GEMINI_API_KEY or OPENAI_API_KEY)" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, engine, model, fields });
}
