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
import { isLibraryMigrationPending, LIBRARY_NOT_MIGRATED } from "@/lib/libraryCounter";
import { mergeLibraryEbooks, readLibraryEbooks } from "@/lib/libraryEbooks.server";
import { deskReadGate } from "@/lib/deskFeatureGate.server";
import { LIBRARY_READER_FUNCTIONS } from "@/lib/rbacFeatureCatalog/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // The Store grant, or a library function (counter, copies, circulation,
  // reports — Masters → Roles), each of which owns every desk key: its
  // reader gets the whole desk, never a cut-down copy. A store function
  // that is not a library one (the store counter) reads nothing here.
  // Saving the desk stays module-level (POST below).
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["library-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (gate.mode === "feature") {
    const holds = (id: string) =>
      (["view", "create", "edit", "approve", "export"] as const).some((a) => gate.access(id, a).allowed);
    if (!LIBRARY_READER_FUNCTIONS.some(holds)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Reading the library needs the Store grant or a library function.",
          reason: "feature_forbidden",
        },
        { status: 403 },
      );
    }
  }
  const { bundle, meta, ok, stamps, settingsStamp, error } = await fetchLibraryDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: error || "Library desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  // The e-book shelves live in their own server store; a failed read sends
  // none (the browser keeps what it has) rather than an empty shelf.
  const ebooks = await readLibraryEbooks();
  return NextResponse.json({
    ok: true,
    ...bundle,
    ...(ebooks ? { ebooks } : {}),
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
    const error = isLibraryMigrationPending(result.error) ? LIBRARY_NOT_MIGRATED : result.error;
    return NextResponse.json({ ok: false, error }, { status: 502 });
  }
  // Shelves the browser sent (only when it changed them): merged by id into
  // their own store — none is ever removed by absence.
  if (Array.isArray(body.ebooks) && body.ebooks.length) {
    const shelves = await mergeLibraryEbooks(body.ebooks);
    if (!shelves.ok) return NextResponse.json({ ok: false, error: shelves.error }, { status: 502 });
  }
  if (result.kept) console.warn(`[library-desk] unstamped save left ${result.kept} stored row(s) as they were`);

  return NextResponse.json({
    ok: true,
    titleCount: body.titles?.length ?? 0,
    updatedAt: new Date().toISOString(),
    stamps: result.stamps,
    conflicts: result.conflicts,
    settingsStamp: result.settingsStamp,
    // Named deletes the server kept because the row has loan history.
    refusedDeletes: result.refusedDeletes ?? [],
  });
}
