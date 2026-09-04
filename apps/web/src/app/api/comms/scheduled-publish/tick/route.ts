/**
 * Scheduled comms publish tick — publish due notices/news/gallery + cross-post.
 * Guard: CRON_SECRET or SOCIAL_CROSS_POST_SECRET.
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { processScheduledCommsPublish } from "@/lib/schoolCommsScheduledPublish.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "comms-scheduled-publish-tick",
    endpoint: "/api/comms/scheduled-publish/tick",
  });
}

export async function POST(req: Request) {
  if (
    !requireJobSecret(req, ["CRON_SECRET", "SOCIAL_CROSS_POST_SECRET"], [
      "x-cron-secret",
      "x-social-cross-post-secret",
    ])
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parents' messages to teachers held overnight go out with the first
  // ticks after 8 AM; a no-op the rest of the day.
  const { flushHeldTeacherMessages } = await import("@/lib/teacherContact.server");
  const heldTeacherMessages = await flushHeldTeacherMessages().catch((e) => ({
    delivered: 0,
    failed: 0,
    skipped: true,
    error: e instanceof Error ? e.message : String(e),
  }));

  const result = await processScheduledCommsPublish();
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json({ ...result, heldTeacherMessages });
}
