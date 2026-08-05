import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateWaTemplateDraftJson, llmStatus } from "@/lib/aiLlm.server";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "wa-template-draft",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { purpose, module, language, layoutKind }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  let body: {
    purpose?: string;
    module?: string;
    language?: string;
    layoutKind?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const purpose = (body.purpose || "").trim();
  if (!purpose) {
    return NextResponse.json({ error: "purpose required" }, { status: 400 });
  }
  if (purpose.length > 500) {
    return NextResponse.json({ error: "purpose too long" }, { status: 400 });
  }

  const result = await generateWaTemplateDraftJson({
    purpose,
    module: body.module || "general",
    language: body.language === "hi" ? "hi" : "en",
    layoutKind: body.layoutKind || "text",
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, engine: result.engine },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    body: result.body,
    footer: result.footer,
  });
}
