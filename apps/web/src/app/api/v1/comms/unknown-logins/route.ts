import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { findHouseholdByMobileStrict } from "@/lib/parentHousehold.server";
import { loadSis } from "@/lib/sis";
import { readParentLinks } from "@/lib/parentNumberLink.server";
import { linkedHousehold } from "@/lib/parentNumberLink";
import { resolvePersonByMobile } from "@/lib/authProvisioning.server";
import { inviteNumberForVerify, readWaVerifySessions } from "@/lib/waNumberVerify.server";
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
 * POST {action:"wa_verify", mobile10} — ask that number on WhatsApp (five
 *        questions about the child; lib/waNumberVerify).
 * POST {action:"wa_verify_all"} — the same for every open parent number not
 *        asked yet.
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
  const verify = new Map((await readWaVerifySessions())?.map((v) => [v.mobile10, v]) ?? []);
  const numbers = await Promise.all(
    state.numbers.map(async (n) => {
      const known =
        n.app === "staff"
          ? !!(await resolvePersonByMobile("staff", n.mobile10))
          : !!findHouseholdByMobileStrict(sis, n.mobile10) || !!(links && linkedHousehold(links, n.mobile10));
      const v = n.app === "parent" ? verify.get(n.mobile10) : undefined;
      return {
        ...n,
        nowRegistered: known,
        wa: v ? { step: v.step, result: v.result, invitedAt: v.invitedAt, updatedAt: v.updatedAt } : null,
      };
    }),
  );
  numbers.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return NextResponse.json({ ok: true, numbers });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "students", "edit");
  if (!auth.ok) return auth.response;
  let body: { mobile10?: string; app?: LoginApp; done?: boolean; note?: string; action?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (body.action === "wa_verify_all") {
    const row = await readModuleLocalState<unknown>("login_unknown_numbers");
    if (!row) return NextResponse.json({ ok: false, error: "Could not read the list — try again" }, { status: 503 });
    await ensureSchoolMirrorHydrated();
    const results: { mobile10: string; status: string; reason: string }[] = [];
    for (const n of normalizeUnknownLoginState(row.state).numbers) {
      if (n.app !== "parent" || n.doneAt) continue;
      const r = await inviteNumberForVerify(n.mobile10, "office");
      results.push({ mobile10: n.mobile10, ...r });
    }
    return NextResponse.json({ ok: true, results, sent: results.filter((r) => r.status === "sent").length });
  }
  const mobile10 = String(body.mobile10 || "");
  if (!/^\d{10}$/.test(mobile10)) return NextResponse.json({ ok: false, error: "mobile10 required" }, { status: 400 });
  if (body.action === "wa_verify") {
    await ensureSchoolMirrorHydrated();
    const r = await inviteNumberForVerify(mobile10, "office", true);
    return NextResponse.json({ ok: r.status !== "failed", ...r }, { status: r.status === "failed" ? 502 : 200 });
  }
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
