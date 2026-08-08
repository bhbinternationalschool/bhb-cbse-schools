import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  fetchCurriculumRemoteServer,
  pushClassCurriculumTemplatesServer,
  pushCurriculumStateServer,
} from "@/lib/curriculum.server";

export const runtime = "nodejs";

/** GET — pull curriculum choices + requests + templates */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "students", "view");
  if (!auth.ok) return auth.response;

  const bundle = await fetchCurriculumRemoteServer();
  if (!bundle) {
    return NextResponse.json(
      { ok: false, error: "Curriculum fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, ...bundle });
}

type PostBody = {
  students?: Array<{
    id: string;
    academicYearCode: string;
    curriculum: unknown;
  }>;
  curriculumRequests?: unknown[];
  templates?: unknown[];
};

/** POST — push curriculum state and/or class templates */
export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "students", "edit");
  if (!auth.ok) return auth.response;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.students) {
    const result = await pushCurriculumStateServer({
      students: body.students as never,
      curriculumRequests: (body.curriculumRequests ?? []) as never,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "Push failed" },
        { status: 502 },
      );
    }
  }

  if (body.templates) {
    const result = await pushClassCurriculumTemplatesServer(
      body.templates as never,
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "Template push failed" },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
