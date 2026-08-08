import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import type { DomainBlobTable } from "@/lib/domainBlobPersistence";
import { domainBlobRbacModule } from "@/lib/domainBlobRbac";
import { fetchDomainBlobFromDb, pushDomainBlobToDb } from "@/lib/domainBlob.server";

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

  const result = await fetchDomainBlobFromDb(table);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "Fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    state: result.state,
    updatedAt: result.updatedAt,
  });
}

type PostBody = { table?: string; state?: unknown };

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

  const result = await pushDomainBlobToDb(table, body.state);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Push failed" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
}
