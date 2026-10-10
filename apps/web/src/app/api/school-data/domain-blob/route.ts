import { NextResponse } from "next/server";
import { cachedBlobJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import type { DomainBlobTable } from "@/lib/domainBlobPersistence";
import { domainBlobRbacModule } from "@/lib/domainBlobRbac";
import { fetchDomainBlobFromDb, pushDomainBlobToDb } from "@/lib/domainBlob.server";

/**
 * Blobs that hold a whole-school desk a teacher now edits piece by piece
 * through scoped v1 routes. A teacher's push of one would overwrite every
 * other class's rows, so only school-wide sessions may send it
 * (2026-09-29, PTM first).
 */
const SCHOOL_WIDE_ONLY_BLOBS = new Set<DomainBlobTable>(["ptm_state"]);

export const runtime = "nodejs";

function resolveTable(raw: string | null): DomainBlobTable | null {
  if (!raw) return null;
  return domainBlobRbacModule(raw) ? (raw as DomainBlobTable) : null;
}

/** GET /api/school-data/domain-blob?table=fees_state — pull one tenant's blob row */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const table = resolveTable(url.searchParams.get("table"));
  if (!table) {
    return NextResponse.json({ error: "Unknown or missing table" }, { status: 400 });
  }
  const rbacModule = domainBlobRbacModule(table)!;
  const auth = await requireStaffPermission(req, rbacModule, "view");
  if (!auth.ok) return auth.response;

  try {
    const cached = await cachedBlobJson({
      table,
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const result = await fetchDomainBlobFromDb(table);
        if (!result.ok) throw new Error("Fetch failed — tenant/db unavailable");
        return { payload: { ok: true, state: result.state, updatedAt: result.updatedAt }, updatedAt: result.updatedAt || "" };
      },
    });
    return deskJsonResponse(cached);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Fetch failed" },
      { status: 503 },
    );
  }
}

type PostBody = { table?: string; state?: unknown; baseUpdatedAt?: string | null };

/** POST /api/school-data/domain-blob — upsert one tenant's blob row */
export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const table = resolveTable(body.table ?? null);
  if (!table) {
    return NextResponse.json({ error: "Unknown or missing table" }, { status: 400 });
  }
  if (body.state === undefined) {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }
  const rbacModule = domainBlobRbacModule(table)!;
  const auth = await requireStaffPermission(req, rbacModule, "edit");
  if (!auth.ok) return auth.response;
  if (SCHOOL_WIDE_ONLY_BLOBS.has(table) && !auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the office or principal can save the whole PTM desk. " +
            "Your own slots and meeting feedback are saved on their own.",
        },
        { status: 403 },
      );
    }
  }

  // The teaching blob holds every teacher's period logs and lesson plans.
  // "teaching.edit" alone let any teacher's browser replace all of it — a
  // stale or hand-built copy could rewrite other classes' logs and plans.
  // Since 2026-09-29 a teacher saves one log through /api/v1/teaching/log
  // and one plan through /api/v1/teaching/lesson-plan, both scope-checked;
  // this whole-blob push is the office's and the principal's.
  if (table === "teaching_state" && !auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the office or principal can save the whole teaching desk. " +
            "Your period logs and lesson plans are saved one at a time.",
        },
        { status: 403 },
      );
    }
  }

  // Chat books are written by many people at once; a version check would
  // refuse ordinary messages. They keep last-write until they move to
  // per-message saves (Phase 2, 10 Oct 2026 plan).
  const multiWriter = table === "erp_chat_state" || table === "staff_chat_state";
  const result = await pushDomainBlobToDb(table, body.state, body.baseUpdatedAt ?? null, {
    server: auth.viaMirrorSecret === true || multiWriter,
  });
  if (!result.ok) {
    if (result.conflict) {
      return NextResponse.json({ ok: false, error: result.error, reason: result.conflict }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: result.error || "Push failed" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
}
