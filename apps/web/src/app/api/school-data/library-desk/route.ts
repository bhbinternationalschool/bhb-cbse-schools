import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { LibraryState } from "@/lib/library";
import { libraryDualWriteDbEnabled } from "@/lib/libraryDbConfig";
import {
  LIBRARY_DELETABLE_TABLES,
  fetchLibraryDeskFromDb,
  pushLibraryDeskToDb,
} from "@/lib/libraryNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["library-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchLibraryDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Library desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    titleCount: bundle.titles.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["library-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!libraryDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Pick<
    LibraryState,
    "titles" | "ebooks" | "copies" | "issues" | "procurementDocs" | "settings"
  > & { deletes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushLibraryDeskToDb({
    version: 2,
    titles: body.titles ?? [],
    ebooks: body.ebooks ?? [],
    copies: body.copies ?? [],
    issues: body.issues ?? [],
    procurementDocs: body.procurementDocs ?? [],
    settings: body.settings ?? {
      maxBooksPerStudent: 2,
      maxBooksPerStaff: 3,
      loanDays: 14,
      finePaisePerDay: 500,
    },
  }, readNamedDeletes(body.deletes, LIBRARY_DELETABLE_TABLES));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    titleCount: body.titles?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
