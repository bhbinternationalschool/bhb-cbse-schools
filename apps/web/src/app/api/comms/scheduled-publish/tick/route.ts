/**
 * Scheduled comms publish tick — publish due notices/news/gallery + cross-post.
 * Guard: CRON_SECRET or SOCIAL_CROSS_POST_SECRET.
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { processScheduledCommsPublish } from "@/lib/schoolCommsScheduledPublish.server";

export const runtime = "nodejs";
// The class-gallery sweep streams videos to the AI check and to Drive.
export const maxDuration = 300;

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

  // Class-gallery items whose AI check did not finish at upload, and passed
  // items whose Drive copy has not landed (lib/classGalleryReview).
  const { sweepClassGallery } = await import("@/lib/classGalleryReview.server");
  const classGallery = await sweepClassGallery(Date.now() + 120_000).catch((e) => ({
    error: e instanceof Error ? e.message : String(e),
  }));

  if (!result.ok) {
    return NextResponse.json({ ...result, classGallery }, { status: 500 });
  }
  return NextResponse.json({ ...result, heldTeacherMessages, classGallery });
}
