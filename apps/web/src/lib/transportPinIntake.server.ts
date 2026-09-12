/**
 * Turning a parent's WhatsApp location into their child's boarding point.
 *
 * This runs BEFORE the ordinary bot, and only for a household we have
 * actually asked — `sis_transport_pin_request`. Without that gate an inbound
 * location keeps the meaning it already has: the transport bot invites one
 * when a family reports a problem ("share location + brief issue"), and
 * silently re-purposing that as a boarding point would move a child's stop
 * because their parent reported a breakdown.
 *
 * ONE PIN, EVERY RIDING CHILD IN THE HOUSEHOLD
 * Twenty-nine of a hundred and seventeen transport households send more than
 * one child. Asking which one costs a round trip for all of them and loses
 * the pin when a parent stops replying, so the pin is written for every
 * rider — and the confirmation NAMES them, so a family whose older child
 * boards on the main road can see what we assumed and correct it. The table
 * stays per-student, so that correction is an ordinary edit.
 *
 * NOTHING HERE MOVES A CHILD
 * A pin is a fact about where a child stands. It does not change their route,
 * their stop or their fee — the office decides that, with the boarding-point
 * audit and the AI suggestion now able to see a doorstep instead of a village
 * centroid. The message says so, and this keeps that promise by writing only
 * to sis_student_transport_point.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { TENANT } from "@/lib/types";
import { sendWhatsAppText } from "@/lib/waSend";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import {
  checkPinPlausible,
  classifyPinReply,
  pinDeclinedMessage,
  pinHowToMessage,
  pinSavedMessage,
  pinTooFarMessage,
} from "@/lib/transportPinIntake";
import {
  deskBundleToTransportState,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import type { SisState } from "@/lib/sis";

export type PinIntakeResult = {
  /** True when this message was the answer to our request and is now dealt
   *  with. False means the ordinary bot should take its turn as before. */
  handled: boolean;
  outcome?: "pinned" | "declined" | "how-to" | "too-far" | "no-riders";
  students?: string[];
  error?: string;
};

const NOT_HANDLED: PinIntakeResult = { handled: false };

/**
 * Does this household have an unanswered request?
 *
 * Only "asked" opens the gate. A household already pinned or declined is
 * closed: a second location from them is an ordinary message again, which is
 * what keeps a family who said no from having a stray pin taken later.
 */
async function openRequestFor(
  householdId: string,
): Promise<{ open: boolean; askCount: number } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("sis_transport_pin_request")
    .select("status, ask_count")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) return null;
  if (!data) return { open: false, askCount: 0 };
  return { open: data.status === "asked", askCount: Number(data.ask_count) || 0 };
}

async function closeRequest(
  householdId: string,
  status: "pinned" | "declined",
  note: string,
): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const { error } = await ctx.sb
    .from("sis_transport_pin_request")
    .update({
      status,
      note: note.slice(0, 400),
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId);
  // Logged, not thrown: the family has already been answered, and failing the
  // webhook now would have Meta redeliver and answer them twice.
  if (error) console.error("[transport/pin] could not close request", householdId, error.message);
}

/**
 * The riding children of one household, named.
 *
 * The year is derived from the household's own live assignments — the latest
 * one that actually has riders — rather than taken from a caller or defaulted.
 * A webhook has no session to ask, and answering for the wrong year would
 * report "no riding children" to a family whose child rides every day.
 */
async function ridersOfHousehold(
  householdId: string,
): Promise<{ studentId: string; fullName: string }[]> {
  const [desk, sisRes] = await Promise.all([
    fetchTransportDeskFromDb(),
    fetchSisFromDb(),
  ]);
  if (!desk.ok || !sisRes.ok) return [];
  const state = deskBundleToTransportState(desk.bundle);
  const sis = sisRes.bundle as unknown as SisState;

  const inHousehold = new Set(
    sis.students.filter((s) => s.householdId === householdId).map((s) => s.id),
  );

  const live = state.assignments.filter(
    (a) => a.effectiveTo == null && inHousehold.has(a.studentId),
  );
  const academicYearCode = live
    .map((a) => a.academicYearCode)
    .filter(Boolean)
    .sort()
    .pop();
  if (!academicYearCode) return [];

  const seen = new Set<string>();
  const out: { studentId: string; fullName: string }[] = [];
  for (const a of live) {
    if (a.academicYearCode !== academicYearCode) continue;
    if (seen.has(a.studentId)) continue;
    seen.add(a.studentId);
    const st = sis.students.find((s) => s.id === a.studentId);
    out.push({ studentId: a.studentId, fullName: st?.fullName || a.studentId });
  }
  return out;
}

/**
 * Handle one inbound message from a household with an open pin request.
 *
 * Returns `handled: false` for anything that is not an answer to our
 * question, so the ordinary bot behaves exactly as it did before.
 */
export async function tryTransportPinIntake(input: {
  fromWaId: string;
  text: string;
  location?: { lat: number; lng: number; name?: string; address?: string } | null;
  household: { id: string; preferredLanguage?: unknown } | null;
}): Promise<PinIntakeResult> {
  const household = input.household;
  if (!household?.id) return NOT_HANDLED;

  const kind = classifyPinReply({
    text: input.text || "",
    hasLocation: !!input.location,
  });
  if (kind === "unrelated") return NOT_HANDLED;

  const req = await openRequestFor(household.id);
  if (!req?.open) return NOT_HANDLED;

  const language = waTemplateLanguageFor({
    preferredLanguage: household.preferredLanguage as never,
  });
  const say = async (body: string) => {
    // Free-form is allowed here: the family messaged us moments ago, so the
    // 24-hour window is open. No template needed, which is why this can be
    // written in their words rather than Meta's.
    await sendWhatsAppText({ toMobile: input.fromWaId, body });
  };

  if (kind === "will_share") {
    await say(pinHowToMessage(language));
    // Deliberately NOT closed. They have said they will send it; closing here
    // is how a request gets marked answered by a message containing no pin.
    return { handled: true, outcome: "how-to" };
  }

  if (kind === "decline") {
    await say(pinDeclinedMessage(language));
    await closeRequest(household.id, "declined", (input.text || "").slice(0, 200));
    return { handled: true, outcome: "declined" };
  }

  // A pin.
  const loc = input.location!;
  const plausible = checkPinPlausible(loc, {
    lat: TENANT.schoolLat,
    lng: TENANT.schoolLng,
  });
  if (!plausible.ok) {
    if (plausible.reason === "too-far") {
      await say(pinTooFarMessage({ kmFromSchool: plausible.kmFromSchool ?? 0, language }));
      // Left OPEN: a parent travelling today can send the real spot tomorrow.
      return { handled: true, outcome: "too-far" };
    }
    return NOT_HANDLED;
  }

  const riders = await ridersOfHousehold(household.id);
  if (riders.length === 0) {
    // Asked, then taken off the bus in between. Saying nothing would leave a
    // parent who did what we asked with no reply at all.
    await say(pinSavedMessage({ childNames: [], kmFromSchool: plausible.kmFromSchool, language }));
    await closeRequest(household.id, "pinned", "no riding children at intake");
    return { handled: true, outcome: "no-riders" };
  }

  const ctx = await getServerTenantContext();
  if (!ctx) return { handled: false, error: "no tenant context" };
  const now = new Date().toISOString();
  const { error } = await ctx.sb.from("sis_student_transport_point").upsert(
    riders.map((r) => ({
      student_id: r.studentId,
      tenant_id: ctx.tenantId,
      latitude: loc.lat,
      longitude: loc.lng,
      // What the family called the place, when WhatsApp carried a label.
      point_name: (loc.name || "").slice(0, 120),
      note: [
        "Sent by the family on WhatsApp",
        loc.address ? `· ${loc.address}` : "",
        riders.length > 1 ? `· one pin for ${riders.length} children` : "",
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 400),
      set_by: "family (WhatsApp)",
      updated_at: now,
    })),
    { onConflict: "student_id" },
  );
  if (error) {
    console.error("[transport/pin] could not save", household.id, error.message);
    // The family is told nothing rather than told it worked. A cheerful
    // confirmation for a pin that was not stored is the one outcome worse
    // than silence — they would never send it again.
    return { handled: true, outcome: "pinned", error: error.message };
  }

  await say(
    pinSavedMessage({
      childNames: riders.map((r) => r.fullName),
      kmFromSchool: plausible.kmFromSchool,
      language,
    }),
  );
  await closeRequest(
    household.id,
    "pinned",
    `${riders.length} child(ren) · ${plausible.kmFromSchool} km from school`,
  );
  return { handled: true, outcome: "pinned", students: riders.map((r) => r.studentId) };
}
