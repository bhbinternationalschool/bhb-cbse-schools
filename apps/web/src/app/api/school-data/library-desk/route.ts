import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { LibraryState } from "@/lib/library";
import { libraryDualWriteDbEnabled } from "@/lib/libraryDbConfig";
import {
  fetchLibraryDeskFromDb,
  pushLibraryDeskToDb,
} from "@/lib/libraryNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  return !!(await getDemoSession());
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchLibraryDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    titleCount: bundle.titles.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!libraryDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Pick<LibraryState, "titles" | "copies" | "issues" | "settings">;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushLibraryDeskToDb({
    version: 1,
    titles: body.titles ?? [],
    copies: body.copies ?? [],
    issues: body.issues ?? [],
    settings: body.settings ?? {
      maxBooksPerStudent: 2,
      loanDays: 14,
      finePaisePerDay: 500,
    },
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    titleCount: body.titles?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
