import { NextResponse } from "next/server";
import { APP_MIN_BUILD, APP_UPDATE_MESSAGE, appBuildTooOld, cleanBuild, cleanFlavor } from "@/lib/appMinBuild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/public/app-version?app=staff&build=15 — whether this phone app
 * build still works with the server (see lib/appMinBuild.ts). No login: the
 * app asks at launch, before anyone has signed in.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const flavor = cleanFlavor(params.get("app"));
  if (!flavor) {
    return NextResponse.json({ ok: false, error: "app must be staff or parent" }, { status: 400 });
  }
  const build = cleanBuild(params.get("build"));
  const updateRequired = appBuildTooOld(flavor, build);
  return NextResponse.json(
    {
      ok: true,
      app: flavor,
      minBuild: APP_MIN_BUILD[flavor],
      updateRequired,
      message: updateRequired ? APP_UPDATE_MESSAGE : "",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
