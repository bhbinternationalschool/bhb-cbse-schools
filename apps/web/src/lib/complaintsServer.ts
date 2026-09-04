/**
 * Server-side complaint tickets — WhatsApp Flow intake.
 *
 * lib/complaints.ts is browser-localStorage-only (by design, matching
 * discipline.ts's pattern), so it has no reach from the WhatsApp webhook,
 * which runs server-side with no browser in the loop. This module gives
 * WhatsApp-submitted tickets a durable home (the existing wa_desk_bot_slices
 * table, same one classChannel/crm/etc. already use — no new table/grant
 * needed) and the ComplaintsWorkspace merges them in for office to see.
 */

import { loadWaBotSlice, saveWaBotSlice } from "@/lib/waBotStore.server";
import {
  mergeTicketsForHousehold,
  normalizeComplaintState,
  type ComplaintCategory,
  type ComplaintSource,
  type ComplaintStatus,
  type ComplaintTicket,
} from "@/lib/complaints";
import { getServerTenantContext } from "@/lib/serverTenant";

type ServerComplaintStore = { version: 1; tickets: ComplaintTicket[] };

function nid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): ServerComplaintStore {
  return { version: 1, tickets: [] };
}

async function readStore(): Promise<ServerComplaintStore> {
  const raw = await loadWaBotSlice<ServerComplaintStore>(
    "complaints",
    emptyStore(),
  );
  if (raw?.version === 1 && Array.isArray(raw.tickets)) return raw;
  return emptyStore();
}

export async function listServerComplaintTickets(): Promise<
  ComplaintTicket[]
> {
  const store = await readStore();
  return store.tickets;
}

/** Append a ticket raised without a browser — WhatsApp Flow (the default
 * source) or the parent app. Mirrors createComplaintTicket's
 * shape/validation so both paths produce interchangeable ComplaintTicket
 * rows the browser-side workspace can merge without special-casing. */
export async function appendServerComplaintTicket(input: {
  householdId: string;
  studentId?: string | null;
  raisedByName: string;
  raisedByMobile: string;
  category: ComplaintCategory;
  subject: string;
  description: string;
  source?: ComplaintSource;
}): Promise<{ ok: true; ticket: ComplaintTicket } | { ok: false; error: string }> {
  if (!input.householdId) return { ok: false, error: "Missing household" };
  if (!input.subject.trim()) return { ok: false, error: "Subject required" };
  if (!input.description.trim()) {
    return { ok: false, error: "Description required" };
  }
  const store = await readStore();
  const now = nowIso();
  const ticket: ComplaintTicket = {
    id: nid("cplt"),
    householdId: input.householdId,
    studentId: input.studentId || null,
    raisedByName: input.raisedByName.trim(),
    raisedByMobile: input.raisedByMobile.trim(),
    category: input.category,
    subject: input.subject.trim(),
    description: input.description.trim(),
    date: now.slice(0, 10),
    assignedToStaffId: null,
    dueByDate: null,
    status: "open" as ComplaintStatus,
    resolutionNote: "",
    resolvedAt: null,
    source: input.source ?? "whatsapp",
    createdAt: now,
    updatedAt: now,
  };
  await saveWaBotSlice("complaints", {
    version: 1,
    tickets: [ticket, ...store.tickets],
  });
  return { ok: true, ticket };
}

/**
 * The office's triaged copy of the complaints module (module_local_state).
 * Null when the row cannot be read — unknown, not empty — so a caller can
 * refuse rather than tell a parent they have no complaints.
 */
async function readOfficeComplaintTickets(): Promise<ComplaintTicket[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", "complaints")
    .maybeSingle();
  if (error) {
    console.warn("[complaints] office state read failed", error.message);
    return null;
  }
  return normalizeComplaintState(data?.state ?? null).tickets;
}

/** Everything one household has raised, wherever it currently lives. */
export async function listHouseholdComplaintTickets(
  householdId: string,
): Promise<ComplaintTicket[] | null> {
  const [office, intake] = await Promise.all([
    readOfficeComplaintTickets(),
    listServerComplaintTickets(),
  ]);
  if (office === null) return null;
  return mergeTicketsForHousehold(office, intake, householdId);
}
