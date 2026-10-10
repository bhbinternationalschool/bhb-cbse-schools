import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { LibraryState } from "@/lib/library";
import { libraryDualWriteDbEnabled } from "@/lib/libraryDbConfig";
import {
  LIBRARY_DELETABLE_TABLES,
  LIBRARY_STAMPED_SLICES,
  fetchLibraryDeskFromDb,
  pushLibraryDeskToDb,
} from "@/lib/libraryNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { readStampsParam } from "@/lib/rowStampClient";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["library-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok, stamps, settingsStamp } = await fetchLibraryDeskFromDb();
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
    stamps,
    settingsStamp,
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
  > & { deletes?: unknown; stamps?: unknown; settingsBase?: string | null };
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
  }, readNamedDeletes(body.deletes, LIBRARY_DELETABLE_TABLES), {
    // No stamps = a tab from before 10 Oct 2026: it may add, never replace.
    stamps: readStampsParam(body.stamps, LIBRARY_STAMPED_SLICES),
    settingsBase: typeof body.settingsBase === "string" ? body.settingsBase : null,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  if (result.kept) console.warn(`[library-desk] unstamped save left ${result.kept} stored row(s) as they were`);

  return NextResponse.json({
    ok: true,
    titleCount: body.titles?.length ?? 0,
    updatedAt: new Date().toISOString(),
    stamps: result.stamps,
    conflicts: result.conflicts,
    settingsStamp: result.settingsStamp,
  });
}
