import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { SisState } from "@/lib/sis";
import { sisDualWriteDbEnabled } from "@/lib/sisDbConfig";
import {
  fetchSisFromDb,
  pushSisToDb,
} from "@/lib/sisNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull SIS roster from normalized tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchSisFromDb();
  return NextResponse.json({
    ok: true,
    households: bundle.households,
    students: bundle.students,
    householdCount: bundle.households.length,
    studentCount: bundle.students.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type RosterPostBody = Pick<SisState, "households" | "students">;

/** POST — push full SIS roster snapshot */
export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sisDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "SIS_DUAL_WRITE_DB disabled",
    });
  }

  let body: RosterPostBody;
  try {
    body = (await req.json()) as RosterPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushSisToDb({
    households: Array.isArray(body.households) ? body.households : [],
    students: Array.isArray(body.students) ? body.students : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    householdCount: result.householdCount,
    studentCount: result.studentCount,
    updatedAt: new Date().toISOString(),
  });
}
