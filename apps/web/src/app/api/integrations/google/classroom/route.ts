import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  googleClassroomOAuthConfigured,
  googleOAuthRedirectUri,
} from "@/lib/googleOAuth.server";
import {
  getStaffConnection,
  loadClassroomStore,
  staffConnectionKey,
} from "@/lib/googleClassroom.store.server";

export const runtime = "nodejs";

function requireStaff(session: Awaited<ReturnType<typeof getDemoSession>>) {
  if (!session || session.persona !== "staff") return null;
  return session;
}

/** Classroom integration status */
export async function GET() {
  const session = requireStaff(await getDemoSession());
  if (!session) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  const staffKey = staffConnectionKey({
    staffId: session.staffId,
    email: session.email,
    fullName: session.fullName,
  });
  const store = await loadClassroomStore();
  const conn = await getStaffConnection(staffKey);

  return NextResponse.json({
    service: "google-classroom",
    oauthConfigured: googleClassroomOAuthConfigured(),
    redirectUri: googleOAuthRedirectUri(),
    connected: !!conn,
    email: conn?.email || null,
    connectedAt: conn?.connectedAt || null,
    mappingsCount: store.mappings.filter((m) => m.enabled).length,
    lastSyncAt: store.lastSyncAt || null,
    scopesNote:
      "Read-only: courses + coursework. Posts appear in ERP Homework for parents.",
  });
}

/** Disconnect Google Classroom for current staff */
export async function DELETE() {
  const session = requireStaff(await getDemoSession());
  if (!session) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const staffKey = staffConnectionKey({
    staffId: session.staffId,
    email: session.email,
    fullName: session.fullName,
  });
  const { removeStaffConnection } = await import(
    "@/lib/googleClassroom.store.server"
  );
  await removeStaffConnection(staffKey);
  return NextResponse.json({ ok: true, connected: false });
}
