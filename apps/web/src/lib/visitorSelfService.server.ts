/**
 * Gate-QR visitor self-service — server side.
 *
 * A visitor scans the QR at the gate → /visit → enters their mobile → we
 * look the number up in SIS (parents) and the admissions CRM (leads) and
 * greet them by what we know → they pick a purpose → check-in with a
 * visitor number → the same page (or the QR on their pass) checks them out.
 *
 * Reads/writes the same visitors state the reception desk uses
 * (module_local_state key "visitors"), merging by id so a reception push
 * can never erase a gate check-in and vice versa (mergeVisitorStates).
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  emptyVisitorState,
  mergeVisitorStates,
  nextVisitorNo,
  normalizeVisitorState,
  visitorQrPayload,
  type VisitorEntry,
  type VisitorPurpose,
  type VisitorState,
} from "@/lib/visitors";

const MODULE_KEY = "visitors";

export function normalizeMobile10(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export type VisitorLookup = {
  mobile: string;
  /** Best display name we can offer (guardian name / lead guardian). */
  suggestedName: string;
  parentOf: { studentName: string; classLabel: string; admissionNo: string }[];
  leads: { childName: string; classSought: string; stage: string }[];
  /** An open (not checked-out) visit for this mobile today, if any. */
  openVisit: VisitorEntry | null;
};

async function readState(): Promise<{ state: VisitorState; updatedAt: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", MODULE_KEY)
    .maybeSingle();
  if (error) return null;
  return {
    state: data?.state ? normalizeVisitorState(data.state) : emptyVisitorState(),
    updatedAt: data?.updated_at ? String(data.updated_at) : "",
  };
}

/** Merge-write: re-read, union with `next`, write. Returns the stored state. */
export async function mergeWriteVisitorState(next: VisitorState): Promise<VisitorState | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const cur = await readState();
  const merged = mergeVisitorStates(cur?.state ?? emptyVisitorState(), next);
  const { error } = await ctx.sb.from("module_local_state").upsert(
    { tenant_id: ctx.tenantId, module_key: MODULE_KEY, state: merged, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,module_key" },
  );
  if (error) {
    console.warn("[visitors] merge-write failed", error.message);
    return null;
  }
  return merged;
}

function todayIstKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function openVisitFor(state: VisitorState, mobile10: string): VisitorEntry | null {
  const today = todayIstKey();
  return (
    state.visitorLog.find(
      (v) => !v.outTime && normalizeMobile10(v.mobile) === mobile10 && todayIstKey(new Date(v.inTime)) === today,
    ) ?? null
  );
}

export async function lookupVisitorMobile(raw: string): Promise<VisitorLookup | null> {
  const mobile = normalizeMobile10(raw);
  if (mobile.length !== 10) return null;
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;
  const like = `%${mobile}`;

  const [students, households, leads, classes, stateRes] = await Promise.all([
    sb
      .from("sis_students")
      .select("id, full_name, admission_no, class_id, father_name, mother_name, father_mobile, mother_mobile, household_id, status")
      .eq("tenant_id", tenantId)
      .or(`father_mobile.like.${like},mother_mobile.like.${like}`)
      .limit(10),
    sb
      .from("sis_households")
      .select("id, guardian_name, mobile, whatsapp_mobile, alt_mobile")
      .eq("tenant_id", tenantId)
      .or(`mobile.like.${like},whatsapp_mobile.like.${like},alt_mobile.like.${like}`)
      .limit(5),
    sb
      .from("admission_desk_leads")
      .select("child_name, guardian_name, mobile, stage, class_sought_id")
      .eq("tenant_id", tenantId)
      .like("mobile", like)
      .limit(10),
    sb.from("masters_desk_classes").select("id, name").eq("tenant_id", tenantId),
    readState(),
  ]);

  const className = new Map((classes.data || []).map((c) => [String(c.id), String(c.name)]));
  const parentOf: VisitorLookup["parentOf"] = [];
  const seen = new Set<string>();
  const add = (row: VisitorLookup["parentOf"][number]) => {
    const k = `${row.admissionNo}|${row.studentName}`.toUpperCase();
    if (seen.has(k)) return;
    seen.add(k);
    parentOf.push(row);
  };
  let suggestedName = "";
  for (const s of students.data || []) {
    if (s.status && s.status !== "active") continue;
    add({
      studentName: String(s.full_name),
      classLabel: className.get(String(s.class_id)) || "",
      admissionNo: String(s.admission_no || ""),
    });
    if (!suggestedName) {
      const fm = normalizeMobile10(String(s.father_mobile || ""));
      suggestedName = fm === mobile ? String(s.father_name || "") : String(s.mother_name || s.father_name || "");
    }
  }
  // Household-linked students (mobile stored on the household, not the child)
  const hhIds = (households.data || []).map((h) => String(h.id));
  if (hhIds.length > 0) {
    const { data: hhStudents } = await sb
      .from("sis_students")
      .select("full_name, admission_no, class_id, status")
      .eq("tenant_id", tenantId)
      .in("household_id", hhIds)
      .limit(10);
    for (const s of hhStudents || []) {
      if (s.status && s.status !== "active") continue;
      add({ studentName: String(s.full_name), classLabel: className.get(String(s.class_id)) || "", admissionNo: String(s.admission_no || "") });
    }
    if (!suggestedName) suggestedName = String(households.data?.[0]?.guardian_name || "");
  }
  const leadRows: VisitorLookup["leads"] = (leads.data || []).map((l) => ({
    childName: String(l.child_name || ""),
    classSought: className.get(String(l.class_sought_id)) || "",
    stage: String(l.stage || ""),
  }));
  if (!suggestedName && leads.data?.[0]?.guardian_name) suggestedName = String(leads.data[0].guardian_name);

  return {
    mobile,
    suggestedName: suggestedName.trim(),
    parentOf,
    leads: leadRows,
    openVisit: stateRes ? openVisitFor(stateRes.state, mobile) : null,
  };
}

export async function selfServiceCheckIn(input: {
  mobile: string;
  visitorName: string;
  purpose: VisitorPurpose;
  personToMeet?: string;
  linkedTo?: string;
}): Promise<{ ok: true; entry: VisitorEntry; alreadyIn: boolean } | { ok: false; error: string }> {
  const mobile = normalizeMobile10(input.mobile);
  if (mobile.length !== 10) return { ok: false, error: "Enter a valid 10-digit mobile number" };
  const name = String(input.visitorName || "").trim();
  if (!name) return { ok: false, error: "Enter your name" };
  const cur = await readState();
  if (!cur) return { ok: false, error: "Server unavailable" };
  const existing = openVisitFor(cur.state, mobile);
  if (existing) return { ok: true, entry: existing, alreadyIn: true };

  const now = new Date();
  const id = `visit_${Math.random().toString(36).slice(2, 10)}`;
  const entry: VisitorEntry = {
    id,
    visitorNo: nextVisitorNo(cur.state, now),
    source: "gate_qr",
    linkedTo: input.linkedTo?.trim() || undefined,
    visitorName: name,
    mobile,
    purpose: input.purpose,
    personToMeet: String(input.personToMeet || "").trim(),
    inTime: now.toISOString(),
    outTime: null,
    idProofNote: "",
    qrPayload: visitorQrPayload(id, name),
    createdBy: "gate-qr",
    createdAt: now.toISOString(),
  };
  const merged = await mergeWriteVisitorState({ version: 1, visitorLog: [entry], gatePasses: [] });
  if (!merged) return { ok: false, error: "Could not save the check-in" };
  return { ok: true, entry, alreadyIn: false };
}

export async function selfServiceCheckOut(input: {
  id?: string;
  mobile?: string;
}): Promise<{ ok: true; entry: VisitorEntry } | { ok: false; error: string }> {
  const cur = await readState();
  if (!cur) return { ok: false, error: "Server unavailable" };
  let entry: VisitorEntry | undefined;
  if (input.id) entry = cur.state.visitorLog.find((v) => v.id === input.id && !v.outTime);
  if (!entry && input.mobile) entry = openVisitFor(cur.state, normalizeMobile10(input.mobile)) ?? undefined;
  if (!entry) return { ok: false, error: "No open visit found" };
  const done: VisitorEntry = { ...entry, outTime: new Date().toISOString() };
  const merged = await mergeWriteVisitorState({ version: 1, visitorLog: [done], gatePasses: [] });
  if (!merged) return { ok: false, error: "Could not save the check-out" };
  return { ok: true, entry: done };
}

export async function visitStatus(id: string): Promise<VisitorEntry | null> {
  const cur = await readState();
  return cur?.state.visitorLog.find((v) => v.id === id) ?? null;
}
