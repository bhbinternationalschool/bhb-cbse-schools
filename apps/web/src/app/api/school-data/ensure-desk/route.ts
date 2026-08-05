import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { ensureDeskCutoverServer } from "@/lib/ensureDeskCutover.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["ensure-desk"], "POST");
  if (!auth.ok) return auth.response
  const result = await ensureDeskCutoverServer();
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
