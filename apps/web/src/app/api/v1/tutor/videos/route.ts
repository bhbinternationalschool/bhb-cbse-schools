import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { resolveTutorStudent } from "@/lib/tutorApi.server";
import { parseTutorLanguage } from "@/lib/tutorPlans";
import { searchTutorVideos } from "@/lib/tutorVideos.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/tutor/videos { studentId, topic, language } — YouTube
 * videos for a topic at the child's class level. Free for any parent of
 * the child (no pass needed): it is a search, not the tutor.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as { studentId?: string; topic?: string; language?: string };
    const topic = (body.topic ?? "").trim();
    if (!topic) throw new ApiError("bad_request", "topic required", 400);
    if (topic.length > 300) throw new ApiError("bad_request", "topic too long", 400);
    const student = await resolveTutorStudent(householdId, (body.studentId ?? "").trim());
    const result = await searchTutorVideos({
      topic,
      classLabel: student.classLabel,
      language: parseTutorLanguage(body.language),
    });
    return apiOk(result);
  } catch (e) {
    return apiErr(e);
  }
}
