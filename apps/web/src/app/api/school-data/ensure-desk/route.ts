import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureDeskCutoverServer } from "@/lib/ensureDeskCutover.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await ensureDeskCutoverServer();
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
