import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { findHouseholdByMobileStrict } from "@/lib/parentHousehold.server";
import { loadSis } from "@/lib/sis";
import { readParentLinks } from "@/lib/parentNumberLink.server";
import { linkedHousehold } from "@/lib/parentNumberLink";
import { resolvePersonByMobile } from "@/lib/authProvisioning.server";
import {
  normalizeUnknownLoginState,
  setUnknownLoginDone,
  type LoginApp,
} from "@/lib/loginUnknownNumbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  — app login attempts from numbers the ERP does not know, newest
 *        first, each marked `nowRegistered` when the office has since added
 *        the number (so a fixed one shows as fixed without anyone ticking it).
 * POST {mobile10, app, done, note} — the office marks one handled / reopens it.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "students", "view");
  if (!auth.ok) return auth.response;
  const row = await readModuleLocalState<unknown>("login_unknown_numbers");
  if (!row) return NextResponse.json({ ok: false, error: "Could not read the list — try again" }, { status: 503 });
  const state = normalizeUnknownLoginState(row.state);
  await ensureSchoolMirrorHydrated();
  // The hydrated mirror, not a database lookup per number: these numbers are
  // by definition mostly unknown, and each miss cost two queries.
  const sis = loadSis();
  // A number the parent has since linked from the app counts as registered.
  const links = await readParentLinks();
  const numbers = await Promise.all(
    state.numbers.map(async (n) => {
      const known =
        n.app === "staff"
          ? !!(await resolvePersonByMobile("staff", n.mobile10))
          : !!findHouseholdByMobileStrict(sis, n.mobile10) || !!(links && linkedHousehold(links, n.mobile10));
      return { ...n, nowRegistered: known };
    }),
  );
  numbers.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return NextResponse.json({ ok: true, numbers });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "students", "edit");
  if (!auth.ok) return auth.response;
  let body: { mobile10?: string; app?: LoginApp; done?: boolean; note?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const mobile10 = String(body.mobile10 || "");
  if (!/^\d{10}$/.test(mobile10)) return NextResponse.json({ ok: false, error: "mobile10 required" }, { status: 400 });
  const row = await readModuleLocalState<unknown>("login_unknown_numbers");
  if (!row) return NextResponse.json({ ok: false, error: "Could not read the list — try again" }, { status: 503 });
  const next = setUnknownLoginDone(normalizeUnknownLoginState(row.state), {
    mobile10,
    app: body.app === "staff" ? "staff" : "parent",
    done: body.done !== false,
    by: auth.ctx.session.fullName || "office",
    note: String(body.note || ""),
    now: new Date().toISOString(),
  });
  const w = await writeModuleLocalState("login_unknown_numbers", next);
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
