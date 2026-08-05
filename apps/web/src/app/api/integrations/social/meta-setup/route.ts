import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  getMetaPageSetupReport,
  runSocialTestPost,
} from "@/lib/metaPageSetup.server";
import type { SocialPlatform } from "@/lib/socialCrossPost.types";

export const runtime = "nodejs";

async function requireStaff(): Promise<boolean> {
  const session = await getDemoSession();
  return !!session && session.persona === "staff";
}

/** Meta Page + Instagram setup status and checklist. */
export async function GET() {
  if (!(await requireStaff())) {
    return NextResponse.json({ error: "Staff session required" }, { status: 401 });
  }
  const report = await getMetaPageSetupReport();
  return NextResponse.json(report);
}

/** Run test cross-post. Body: { platforms?: ["facebook","instagram","telegram"] } */
export async function POST(req: Request) {
  if (!(await requireStaff())) {
    return NextResponse.json({ error: "Staff session required" }, { status: 401 });
  }

  let platforms: SocialPlatform[] | undefined;
  try {
    const body = (await req.json()) as { platforms?: SocialPlatform[] };
    if (Array.isArray(body.platforms)) {
      platforms = body.platforms.filter(
        (p): p is SocialPlatform =>
          p === "facebook" || p === "instagram" || p === "telegram",
      );
    }
  } catch {
    platforms = undefined;
  }

  const result = await runSocialTestPost(platforms);
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
