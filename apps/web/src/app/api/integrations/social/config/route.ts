import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getSocialCrossPostConfig } from "@/lib/socialCrossPost.server";

export const runtime = "nodejs";

/** Platform configuration status (no secrets). */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notices", "view");
  if (!auth.ok) return auth.response;

  const config = await getSocialCrossPostConfig();
  const pub = await import("@/lib/socialIntegrations.server").then((m) =>
    m.getSocialIntegrationsPublic(),
  );
  return NextResponse.json({ ...config, credentials: pub });
}

export async function POST() {
  return NextResponse.json(
    {
      error: "Use POST /api/integrations/social/cross-post to publish",
    },
    { status: 405 },
  );
}
