import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { getMetaPageSetupReport } from "@/lib/metaPageSetup.server";
import {
  clearSocialIntegrations,
  getSocialIntegrationsPublic,
  saveSocialIntegrations,
  type SaveSocialIntegrationsInput,
} from "@/lib/socialIntegrations.server";

export const runtime = "nodejs";

async function requireStaffPrincipal(): Promise<
  { ok: true; by: string } | { ok: false }
> {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return { ok: false };
  const role = session.roleCode.toLowerCase();
  if (!/owner|principal|admin|office/.test(role)) return { ok: false };
  return { ok: true, by: session.fullName || "Staff" };
}

/** Masked credentials + connection status */
export async function GET() {
  const auth = await requireStaffPrincipal();
  if (!auth.ok) {
    return NextResponse.json({ error: "Staff admin access required" }, { status: 401 });
  }

  const [pub, setup] = await Promise.all([
    getSocialIntegrationsPublic(),
    getMetaPageSetupReport(),
  ]);

  return NextResponse.json({ credentials: pub, setup });
}

/** Save credentials from ERP form + auto-validate connection */
export async function POST(req: Request) {
  const auth = await requireStaffPrincipal();
  if (!auth.ok) {
    return NextResponse.json({ error: "Staff admin access required" }, { status: 401 });
  }

  let body: SaveSocialIntegrationsInput;
  try {
    body = (await req.json()) as SaveSocialIntegrationsInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const saved = await saveSocialIntegrations(body, auth.by);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  const setup = await getMetaPageSetupReport();
  return NextResponse.json({
    ok: true,
    message: "Credentials saved",
    credentials: saved.public,
    setup,
  });
}

/** Clear ERP-stored credentials (falls back to env if set) */
export async function DELETE() {
  const auth = await requireStaffPrincipal();
  if (!auth.ok) {
    return NextResponse.json({ error: "Staff admin access required" }, { status: 401 });
  }

  const cleared = await clearSocialIntegrations();
  if (!cleared.ok) {
    return NextResponse.json({ error: cleared.error }, { status: 500 });
  }

  const pub = await getSocialIntegrationsPublic();
  return NextResponse.json({ ok: true, credentials: pub });
}
