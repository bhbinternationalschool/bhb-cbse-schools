import "server-only";

/**
 * School chat → phones. The ONE place chat asks for a push.
 *
 * HOOK: a unified role-notification service is being built on branch
 * feat/role-notifications (not on main when this was written). When it
 * lands, replace the body of `deliver` with its notify() — the events this
 * module produces (who, what, urgent) are already the shape it needs. Until
 * then this calls the existing push helpers (Web Push + FCM,
 * lib/webPush.server.ts). Best-effort: a push failure never fails a send.
 *
 * What is pushed:
 *  - a visible message → the conversation's other members (staff; for a
 *    group, every family of the section except the sender's; for a
 *    staff↔parent chat, that family);
 *  - a HELD message → nobody but the moderators ("1 message waiting for
 *    review"); its text is never in the push;
 *  - a self-harm hold → the moderators, marked urgent;
 *  - a warning → the sender's family / staff member.
 */

import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { GroupRef } from "@/lib/schoolChat";
import type { SisStudent } from "@/lib/sis";
import { sendPushToSubjects } from "@/lib/webPush.server";
import { trackServerWork } from "@/lib/serverWork";

export type SchoolChatEvent = {
  kind: "message" | "held" | "warning";
  conversationId: string;
  title: string;
  senderLabel: string;
  preview: string;
  urgent: boolean;
  flagged: boolean;
  staffIds: string[];
  group: GroupRef | null;
  ay: string;
  householdIds: string[];
  exceptHousehold: string;
  ctx: ApiAuthContext;
  loadSection: (classId: string, sectionId: string) => Promise<SisStudent[]>;
};

const url = (id: string) => `/school-chat?c=${encodeURIComponent(id)}`;

async function deliver(e: SchoolChatEvent): Promise<void> {
  const data = { kind: "school_chat", conversationId: e.conversationId };
  if (e.kind === "held" || e.flagged) {
    const { chatModeratorStaffIds } = await import("@/lib/schoolChat.server");
    const mods = chatModeratorStaffIds(e.ctx.masters, e.ctx.rbac, e.ay);
    await sendPushToSubjects("staff", mods, {
      title: e.urgent ? "URGENT — school chat: a child may need help" : "School chat: a message is waiting for review",
      body: `${e.senderLabel} · ${e.title}`,
      url: "/school-chat?tab=review",
      data: { ...data, review: "1" },
    });
    if (e.kind === "held") return;
  }
  if (e.kind === "warning") {
    const payload = { title: "School chat", body: "The school removed one of your messages and has sent a warning. Please keep chat kind and safe.", url: url(e.conversationId), data };
    await Promise.all([sendPushToSubjects("parent", e.householdIds, payload), sendPushToSubjects("staff", e.staffIds, payload)]);
    return;
  }
  const preview = e.preview.length > 120 ? `${e.preview.slice(0, 117)}…` : e.preview;
  const payload = { title: `${e.senderLabel} · ${e.title}`, body: preview, url: url(e.conversationId), data };
  let households = [...e.householdIds];
  if (e.group) {
    const kids = await e.loadSection(e.group.classId, e.group.sectionId);
    households = [...new Set(kids.map((k) => k.householdId).filter(Boolean))];
  }
  households = households.filter((h) => h !== e.exceptHousehold);
  await Promise.all([sendPushToSubjects("staff", e.staffIds, payload), sendPushToSubjects("parent", households, payload)]);
}

export function notifySchoolChat(e: SchoolChatEvent): Promise<void> {
  return trackServerWork(
    deliver(e).catch((err) => {
      console.warn("[school-chat] push failed:", err instanceof Error ? err.message : err);
    }),
  );
}
