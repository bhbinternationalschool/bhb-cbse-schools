/**
 * WhatsApp RSVP for school events — a genuine button-reply flow, not PTM's
 * one-way wa.me link. The button id is fully self-describing
 * (`evt_rsvp_<eventId>|<householdId>|<choice>`) so the inbound webhook can
 * record the RSVP with a single early-return guard clause in
 * handleWaUnifiedInbound, before any per-contact flow routing runs — see
 * that function for why this can't be a 7th bot flow.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { sendWhatsAppInteractive } from "@/lib/waInteractive";
import { sendWhatsAppText } from "@/lib/waSend";
import {
  buildEventRsvpButtonId,
  parseEventRsvpButtonId,
  type RsvpChoice,
  type SchoolEvent,
} from "@/lib/events";

function formatEventDateRange(e: SchoolEvent): string {
  if (e.endsOn && e.endsOn !== e.startsOn) {
    return `${e.startsOn} to ${e.endsOn}`;
  }
  return e.startsOn;
}

const CHOICE_LABEL: Record<RsvpChoice, string> = {
  yes: "Yes, attending",
  no: "Not attending",
  maybe: "Maybe",
};

/** Send the Yes/No/Maybe RSVP prompt for one household. */
export async function sendEventRsvpPrompt(
  event: SchoolEvent,
  household: { id: string; whatsappMobile: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!household.whatsappMobile) {
    return { ok: false, error: "Household has no WhatsApp number" };
  }
  const body = `${event.title}\n${formatEventDateRange(event)}${
    event.location ? ` · ${event.location}` : ""
  }\n\nWill you be attending?`;
  const choices: RsvpChoice[] = ["yes", "no", "maybe"];
  const r = await sendWhatsAppInteractive({
    toMobile: household.whatsappMobile,
    menu: {
      kind: "buttons",
      body,
      buttons: choices.map((choice) => ({
        id: buildEventRsvpButtonId(event.id, household.id, choice),
        title: CHOICE_LABEL[choice].slice(0, 20),
      })),
    },
    textFallback: `${body}\n\nReply YES, NO or MAYBE.`,
  });
  return { ok: r.ok, error: r.error };
}

/**
 * Parse + record an inbound RSVP button id, and return the confirmation
 * text to send back. Returns null when `rawId` isn't an RSVP button id (the
 * caller should fall through to normal bot handling in that case) or when
 * the event no longer exists.
 */
export async function recordEventRsvpFromButtonId(
  rawId: string,
): Promise<string | null> {
  const parsed = parseEventRsvpButtonId(rawId);
  if (!parsed) return null;
  const { eventId, householdId, choice } = parsed;

  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;

  const { data: eventRow, error: eventErr } = await sb
    .from("school_events")
    .select("id,title")
    .eq("tenant_id", tenantId)
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !eventRow) {
    console.warn("[waEventsRsvp] event lookup failed", eventErr?.message);
    return null;
  }
  const title = (eventRow as { title: string }).title;

  const now = new Date().toISOString();
  const { error: upsertErr } = await sb.from("event_rsvps").upsert(
    {
      id: `${eventId}|${householdId}`,
      tenant_id: tenantId,
      event_id: eventId,
      household_id: householdId,
      choice,
      responded_at: now,
      updated_at: now,
    },
    { onConflict: "event_id,household_id" },
  );
  if (upsertErr) {
    console.warn("[waEventsRsvp] upsert failed", upsertErr.message);
    return null;
  }

  return `Thanks! We've recorded "${CHOICE_LABEL[choice]}" for ${title}.`;
}

/** Convenience wrapper used by the inbound webhook — records the RSVP and
 * sends the confirmation, swallowing send failures (the RSVP itself is
 * already durably recorded by the time the confirmation is attempted). */
export async function handleInboundEventRsvp(
  fromMobile: string,
  rawId: string,
): Promise<boolean> {
  const confirmation = await recordEventRsvpFromButtonId(rawId);
  if (!confirmation) return false;
  await sendWhatsAppText({ toMobile: fromMobile, body: confirmation });
  return true;
}
