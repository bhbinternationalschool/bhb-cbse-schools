import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateCollectionsDraftJson, llmStatus } from "@/lib/aiLlm.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "collections-draft",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { studentName, classLabel, amountLabel, overdueDaysLabel, stageLabel, language? }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  let body: {
    studentName?: string;
    classLabel?: string;
    amountLabel?: string;
    overdueDaysLabel?: string;
    stageLabel?: string;
    language?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const studentName = (body.studentName || "").trim().slice(0, 120);
  const amountLabel = (body.amountLabel || "").trim().slice(0, 40);
  if (!studentName || !amountLabel) {
    return NextResponse.json(
      { error: "studentName and amountLabel required" },
      { status: 400 },
    );
  }

  const result = await generateCollectionsDraftJson({
    schoolName: TENANT.nameDisplay,
    studentName,
    classLabel: (body.classLabel || "").trim().slice(0, 40),
    amountLabel,
    overdueDaysLabel: (body.overdueDaysLabel || "").trim().slice(0, 40),
    stageLabel: (body.stageLabel || "").trim().slice(0, 40),
    language: body.language === "hi" ? "hi" : "en",
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
    whatsappMessage: result.whatsappMessage,
    callScript: result.callScript,
  });
}
