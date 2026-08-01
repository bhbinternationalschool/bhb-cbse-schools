import { NextResponse } from "next/server";
import { buildPwaManifest, isPwaAppId } from "@/lib/pwaApps";

export const runtime = "nodejs";

type Params = { params: Promise<{ appId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { appId } = await params;
  if (!isPwaAppId(appId)) {
    return NextResponse.json({ error: "Unknown app" }, { status: 404 });
  }
  const manifest = buildPwaManifest(appId);
  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
