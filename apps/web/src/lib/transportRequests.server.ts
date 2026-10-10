/**
 * Transport requests — a family asking for the school bus, and the office
 * working it. Server-truth table `transport_requests`; see the migration.
 */
import { getServerTenantContext } from "@/lib/serverTenant";

export type TransportRequestStatus = "open" | "contacted" | "assigned" | "declined";
export const TRANSPORT_REQUEST_STATUSES: TransportRequestStatus[] = ["open", "contacted", "assigned", "declined"];

export type TransportRequest = {
  id: string;
  householdId: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  contactName: string;
  contactMobile: string;
  pickupAddress: string;
  locality: string;
  landmark: string;
  preferredStop: string;
  note: string;
  status: TransportRequestStatus;
  handlingNote: string;
  handledBy: string;
  handledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function rowToRequest(r: Record<string, unknown>): TransportRequest {
  return {
    id: String(r.id),
    householdId: String(r.household_id),
    studentId: String(r.student_id),
    studentName: String(r.student_name || ""),
    classLabel: String(r.class_label || ""),
    contactName: String(r.contact_name || ""),
    contactMobile: String(r.contact_mobile || ""),
    pickupAddress: String(r.pickup_address || ""),
    locality: String(r.locality || ""),
    landmark: String(r.landmark || ""),
    preferredStop: String(r.preferred_stop || ""),
    note: String(r.note || ""),
    status: (r.status as TransportRequestStatus) || "open",
    handlingNote: String(r.handling_note || ""),
    handledBy: String(r.handled_by || ""),
    handledAt: (r.handled_at as string | null) ?? null,
    createdAt: String(r.created_at || ""),
    updatedAt: String(r.updated_at || ""),
  };
}

function nid(): string {
  return `treq_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createTransportRequest(input: Omit<TransportRequest,
  "id" | "status" | "handlingNote" | "handledBy" | "handledAt" | "createdAt" | "updatedAt">,
): Promise<{ ok: true; request: TransportRequest } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const now = new Date().toISOString();
  const row = {
    id: nid(),
    tenant_id: ctx.tenantId,
    household_id: input.householdId,
    student_id: input.studentId,
    student_name: input.studentName,
    class_label: input.classLabel,
    contact_name: input.contactName,
    contact_mobile: input.contactMobile,
    pickup_address: input.pickupAddress,
    locality: input.locality,
    landmark: input.landmark,
    preferred_stop: input.preferredStop,
    note: input.note,
    status: "open",
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await ctx.sb.from("transport_requests").insert(row).select("*").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, request: rowToRequest(data as Record<string, unknown>) };
}

export async function listHouseholdTransportRequests(householdId: string): Promise<TransportRequest[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("transport_requests")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[transport-requests] household list failed", error.message);
    return null;
  }
  return (data ?? []).map((r) => rowToRequest(r as Record<string, unknown>));
}

export async function listTransportRequests(opts: {
  status?: TransportRequestStatus | "active";
  limit?: number;
}): Promise<TransportRequest[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  let q = ctx.sb
    .from("transport_requests")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 500));
  if (opts.status === "active") q = q.in("status", ["open", "contacted"]);
  else if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) {
    console.warn("[transport-requests] list failed", error.message);
    return null;
  }
  return (data ?? []).map((r) => rowToRequest(r as Record<string, unknown>));
}

export async function updateTransportRequest(input: {
  id: string;
  status: TransportRequestStatus;
  handlingNote?: string;
  handledBy: string;
}): Promise<{ ok: true; request: TransportRequest } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const now = new Date().toISOString();
  const { data, error } = await ctx.sb
    .from("transport_requests")
    .update({
      status: input.status,
      handling_note: (input.handlingNote ?? "").trim(),
      handled_by: input.handledBy,
      handled_at: now,
      updated_at: now,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.id)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Request not found" };
  return { ok: true, request: rowToRequest(data as Record<string, unknown>) };
}
