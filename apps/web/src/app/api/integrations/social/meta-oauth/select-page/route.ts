import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { connectMetaOAuthPage } from "@/lib/socialIntegrations.server";
import { getMetaPageSetupReport } from "@/lib/metaPageSetup.server";

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

/** Pick Facebook Page after OAuth (when user manages multiple Pages) */
export async function POST(req: Request) {
  const auth = await requireStaffPrincipal();
  if (!auth.ok) {
    return NextResponse.json({ error: "Staff admin access required" }, { status: 401 });
  }

  let body: { pageId?: string };
  try {
    body = (await req.json()) as { pageId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pageId = body.pageId?.trim();
  if (!pageId) {
    return NextResponse.json({ error: "pageId is required" }, { status: 400 });
  }

  const result = await connectMetaOAuthPage(pageId, auth.by);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const setup = await getMetaPageSetupReport();
  return NextResponse.json({
    ok: true,
    message: `Connected to ${result.public.facebookPageName || "Facebook Page"}`,
    credentials: result.public,
    setup,
  });
}
