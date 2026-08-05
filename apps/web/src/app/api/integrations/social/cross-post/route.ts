import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { crossPostCommsContent } from "@/lib/socialCrossPost.server";
import { listCrossPostLogs } from "@/lib/socialCrossPostLog.server";
import type {
  SocialCrossPostKind,
  SocialCrossPostPayload,
  SocialPlatform,
} from "@/lib/socialCrossPost.types";

export const runtime = "nodejs";

async function requireStaff(): Promise<boolean> {
  const session = await getDemoSession();
  return !!session && session.persona === "staff";
}

async function isAuthorized(req: Request): Promise<boolean> {
  if (await requireStaff()) return true;
  const secret = process.env.SOCIAL_CROSS_POST_SECRET;
  if (!secret) return false;
  return req.headers.get("x-social-cross-post-secret") === secret;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const contentId = url.searchParams.get("contentId") || undefined;
  const kind = (url.searchParams.get("kind") || undefined) as
    | SocialCrossPostKind
    | undefined;
  const limit = Number(url.searchParams.get("limit") || "30");

  if (!(await requireStaff())) {
    return NextResponse.json({ error: "Staff session required" }, { status: 401 });
  }

  const logs = await listCrossPostLogs({ contentId, kind, limit });
  return NextResponse.json({ logs });
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Partial<SocialCrossPostPayload>;
  try {
    body = (await req.json()) as Partial<SocialCrossPostPayload>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = body.kind;
  const contentId = body.contentId?.trim();
  const title = body.title?.trim();
  const textBody = body.body?.trim();

  if (!kind || !contentId || !title) {
    return NextResponse.json(
      { error: "kind, contentId, and title are required" },
      { status: 400 },
    );
  }
  if (!textBody && kind !== "gallery") {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const platforms = (body.platforms ?? []).filter(
    (p): p is SocialPlatform =>
      p === "facebook" || p === "instagram" || p === "telegram",
  );

  const result = await crossPostCommsContent({
    kind,
    contentId,
    title,
    body: textBody || body.summary || title,
    summary: body.summary,
    imageUrl: body.imageUrl,
    imageUrls: body.imageUrls,
    linkUrl: body.linkUrl,
    platforms: platforms.length ? platforms : undefined,
    force: body.force === true,
  });

  if (!result.ok && !result.results.some((r) => r.skipped)) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result);
}
