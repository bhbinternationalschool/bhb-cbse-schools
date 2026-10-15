/**
 * POST /api/staff/requests — raise a request (any member of staff, for
 * themselves), triage one (managers, with the revision they loaded), or send
 * a request a browser still holds from before 15 Oct 2026. Each is one
 * element written through the write kernel (desk_slice_row_write on
 * staff_hr_desk_slices.staffRequests). Handler: lib/staffRequests.server.ts.
 */
import { staffRequestsPost } from "@/lib/staffRequests.server";
import { staffRequestsDeps } from "@/lib/staffRequestsDeps.server";
import { withBuildCheck } from "@/lib/staleBuild.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withBuildCheck((req: Request) => staffRequestsPost(req, staffRequestsDeps));
