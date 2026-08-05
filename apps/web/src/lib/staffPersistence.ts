/**
 * Staff remote sync — departments + designations + staff.
 * Masters localStorage remains the working copy; Supabase overlays when configured.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBrowserSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { TENANT } from "@/lib/types";
import {
  normalizeStaffRecord,
  type Department,
  type Designation,
  type StaffDocKey,
  type StaffDocs,
  type StaffRecord,
  emptyStaffDocs,
  STAFF_DOC_LABELS,
} from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";
import { staffDualWriteDbEnabled, staffReadFromDbEnabled } from "@/lib/staffDbConfig";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "staff";

export type StaffRemoteBundle = {
  departments: Department[];
  designations: Designation[];
  staff: StaffRecord[];
};

type DepartmentRow = {
  id: string;
  code: string | null;
  name: string | null;
  is_active: boolean | null;
  updated_at: string;
};

type DesignationRow = {
  id: string;
  code: string | null;
  name: string | null;
  department_id: string | null;
  is_active: boolean | null;
  updated_at: string;
};

type StaffRow = {
  id: string;
  emp_code: string | null;
  full_name: string | null;
  stream: string | null;
  category: string | null;
  department_id: string | null;
  designation_id: string | null;
  campus_id: string | null;
  mobile: string | null;
  email: string | null;
  status: string | null;
  profile: unknown;
  updated_at: string;
};

let tenantIdCache: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPush: MastersState | null = null;

const DATA_URL_MAX = 8_000;

export function staffRemoteEnabled() {
  return isSupabaseConfigured();
}

export function resetStaffPersistenceCache() {
  resetDeskHydrated(MODULE);
  tenantIdCache = null;
  pendingPush = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

async function clientAndTenant(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  const sb = createBrowserSupabase();
  if (!sb) return null;
  if (tenantIdCache) return { sb, tenantId: tenantIdCache };
  const { data, error } = await sb
    .from("tenants")
    .select("id")
    .eq("slug", TENANT.slug)
    .maybeSingle();
  if (error || !data?.id) {
    console.warn("[staff] tenant resolve failed", error?.message);
    return null;
  }
  tenantIdCache = data.id as string;
  return { sb, tenantId: tenantIdCache };
}

function photoForRemote(url: string): string {
  if (url.startsWith("data:") && url.length > DATA_URL_MAX) return "";
  return url;
}

function stripHeavyDocs(docs: StaffDocs): StaffDocs {
  const next = emptyStaffDocs();
  for (const { key } of STAFF_DOC_LABELS) {
    const d = docs[key as StaffDocKey];
    const fileUrl =
      d.fileUrl.startsWith("data:") && d.fileUrl.length > DATA_URL_MAX
        ? ""
        : d.fileUrl;
    next[key as StaffDocKey] = { ...d, fileUrl };
  }
  return next;
}

function staffForRemote(s: StaffRecord): StaffRecord {
  return normalizeStaffRecord({
    ...s,
    photoUrl: photoForRemote(s.photoUrl),
    signatureUrl: photoForRemote(s.signatureUrl),
    docs: stripHeavyDocs(s.docs),
  });
}

function rowToDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? "",
    isActive: row.is_active !== false,
  };
}

function rowToDesignation(row: DesignationRow): Designation {
  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? "",
    departmentId: row.department_id,
    isActive: row.is_active !== false,
  };
}

function rowToStaff(row: StaffRow): StaffRecord {
  const profile =
    row.profile && typeof row.profile === "object"
      ? (row.profile as Partial<StaffRecord>)
      : {};
  return normalizeStaffRecord({
    ...profile,
    id: row.id,
    empCode: row.emp_code ?? profile.empCode ?? "",
    fullName: row.full_name ?? profile.fullName ?? "",
    stream:
      (row.stream as StaffRecord["stream"]) ||
      profile.stream ||
      "teaching",
    category:
      (row.category as StaffRecord["category"]) ||
      profile.category ||
      "permanent",
    departmentId: row.department_id ?? profile.departmentId ?? null,
    designationId: row.designation_id ?? profile.designationId ?? null,
    campusId: row.campus_id || profile.campusId || null,
    mobile: row.mobile ?? profile.mobile ?? "",
    email: row.email ?? profile.email ?? "",
    status: row.status === "inactive" ? "inactive" : "active",
  });
}

export async function fetchStaffRemote(): Promise<StaffRemoteBundle | null> {
  if (!staffRemoteEnabled()) return null;
  const ctx = await clientAndTenant();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;

  const [depRes, desRes, stfRes] = await Promise.all([
    sb.from("sis_departments").select("*").eq("tenant_id", tenantId),
    sb.from("sis_designations").select("*").eq("tenant_id", tenantId),
    sb.from("sis_staff").select("*").eq("tenant_id", tenantId),
  ]);

  if (depRes.error) {
    console.warn("[staff] pull departments failed", depRes.error.message);
    return null;
  }
  if (desRes.error) {
    console.warn("[staff] pull designations failed", desRes.error.message);
    return null;
  }
  if (stfRes.error) {
    console.warn("[staff] pull staff failed", stfRes.error.message);
    return null;
  }

  return {
    departments: ((depRes.data ?? []) as DepartmentRow[]).map(rowToDepartment),
    designations: ((desRes.data ?? []) as DesignationRow[]).map(
      rowToDesignation,
    ),
    staff: ((stfRes.data ?? []) as StaffRow[]).map(rowToStaff),
  };
}

/** Service-role pull for WhatsApp / server mirror (no browser session). */
export async function fetchStaffRemoteServer(): Promise<StaffRemoteBundle | null> {
  const { getServerTenantContext } = await import("@/lib/serverTenant");
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;

  const [depRes, desRes, stfRes] = await Promise.all([
    sb.from("sis_departments").select("*").eq("tenant_id", tenantId),
    sb.from("sis_designations").select("*").eq("tenant_id", tenantId),
    sb.from("sis_staff").select("*").eq("tenant_id", tenantId),
  ]);

  if (depRes.error || desRes.error || stfRes.error) {
    console.warn(
      "[staff] server pull failed",
      depRes.error?.message || desRes.error?.message || stfRes.error?.message,
    );
    return null;
  }

  return {
    departments: ((depRes.data ?? []) as DepartmentRow[]).map(rowToDepartment),
    designations: ((desRes.data ?? []) as DesignationRow[]).map(
      rowToDesignation,
    ),
    staff: ((stfRes.data ?? []) as StaffRow[]).map(rowToStaff),
  };
}

/**
 * Merge remote staff slice into Masters.
 * Remote wins on id collision; local-only rows kept.
 */
export function mergeStaffRemoteIntoMasters(
  local: MastersState,
  remote: StaffRemoteBundle,
  opts?: { preferDb?: boolean },
): MastersState {
  const prefer = opts?.preferDb ?? staffReadFromDbEnabled() ?? false;

  const depMap = new Map<string, Department>();
  if (!prefer) {
    for (const d of local.departments ?? []) depMap.set(d.id, d);
  }
  for (const d of remote.departments) depMap.set(d.id, d);

  const desMap = new Map<string, Designation>();
  if (!prefer) {
    for (const d of local.designations ?? []) desMap.set(d.id, d);
  }
  for (const d of remote.designations) desMap.set(d.id, d);

  const staffMap = new Map<string, StaffRecord>();
  if (!prefer) {
    for (const s of local.staff ?? []) staffMap.set(s.id, s);
  }
  for (const s of remote.staff) staffMap.set(s.id, s);

  return {
    ...local,
    departments: [...depMap.values()],
    designations: [...desMap.values()],
    staff: [...staffMap.values()],
  };
}

function departmentToRow(d: Department, tenantId: string, now: string) {
  return {
    id: d.id,
    tenant_id: tenantId,
    code: d.code,
    name: d.name,
    is_active: d.isActive,
    updated_at: now,
  };
}

function designationToRow(d: Designation, tenantId: string, now: string) {
  return {
    id: d.id,
    tenant_id: tenantId,
    code: d.code,
    name: d.name,
    department_id: d.departmentId,
    is_active: d.isActive,
    updated_at: now,
  };
}

function staffToRow(s: StaffRecord, tenantId: string, now: string) {
  const slim = staffForRemote(s);
  return {
    id: slim.id,
    tenant_id: tenantId,
    emp_code: slim.empCode,
    full_name: slim.fullName,
    stream: slim.stream,
    category: slim.category,
    department_id: slim.departmentId,
    designation_id: slim.designationId,
    campus_id: slim.campusId ?? "",
    mobile: slim.mobile,
    email: slim.email,
    status: slim.status,
    profile: slim,
    updated_at: now,
  };
}

async function upsertStaffBundle(
  sb: SupabaseClient,
  tenantId: string,
  state: MastersState,
): Promise<{ ok: boolean; error?: string }> {
  if (!staffDualWriteDbEnabled()) return { ok: true };
  const now = new Date().toISOString();

  const depRows = (state.departments ?? []).map((d) =>
    departmentToRow(d, tenantId, now),
  );
  if (depRows.length > 0) {
    const { error } = await sb.from("sis_departments").upsert(depRows, {
      onConflict: "id",
    });
    if (error) {
      console.warn("[staff] push departments failed", error.message);
      return { ok: false, error: error.message };
    }
  }

  const desRows = (state.designations ?? []).map((d) =>
    designationToRow(d, tenantId, now),
  );
  if (desRows.length > 0) {
    const { error } = await sb.from("sis_designations").upsert(desRows, {
      onConflict: "id",
    });
    if (error) {
      console.warn("[staff] push designations failed", error.message);
      return { ok: false, error: error.message };
    }
  }

  const staffRows = (state.staff ?? []).map((s) =>
    staffToRow(s, tenantId, now),
  );
  const chunk = 40;
  for (let i = 0; i < staffRows.length; i += chunk) {
    const slice = staffRows.slice(i, i + chunk);
    const { error } = await sb.from("sis_staff").upsert(slice, {
      onConflict: "id",
    });
    if (error) {
      console.warn("[staff] push staff failed", error.message);
      return { ok: false, error: error.message };
    }
  }

  return { ok: true };
}

export async function pushStaffRemoteServer(
  state: MastersState,
): Promise<{ ok: boolean; error?: string }> {
  if (!staffDualWriteDbEnabled()) return { ok: true };
  const { getServerTenantContext } = await import("@/lib/serverTenant");
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { ok: false, error: "Supabase tenant not configured" };
  }
  return upsertStaffBundle(ctx.sb, ctx.tenantId, state);
}

export async function pushStaffSlice(
  state: MastersState,
): Promise<{ ok: boolean; error?: string }> {
  if (!staffRemoteEnabled()) return { ok: true };
  const ctx = await clientAndTenant();
  if (!ctx) return { ok: false, error: "Tenant not resolved" };
  return upsertStaffBundle(ctx.sb, ctx.tenantId, state);
}

export async function wipeRemoteStaffRoster(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!staffRemoteEnabled()) return { ok: true };
  const ctx = await clientAndTenant();
  if (!ctx) return { ok: false, error: "Tenant not resolved" };
  const { sb, tenantId } = ctx;

  const { error: stfErr } = await sb
    .from("sis_staff")
    .delete()
    .eq("tenant_id", tenantId);
  if (stfErr) {
    console.warn("[staff] wipe staff failed", stfErr.message);
    return { ok: false, error: stfErr.message };
  }
  const { error: desErr } = await sb
    .from("sis_designations")
    .delete()
    .eq("tenant_id", tenantId);
  if (desErr) {
    console.warn("[staff] wipe designations failed", desErr.message);
    return { ok: false, error: desErr.message };
  }
  const { error: depErr } = await sb
    .from("sis_departments")
    .delete()
    .eq("tenant_id", tenantId);
  if (depErr) {
    console.warn("[staff] wipe departments failed", depErr.message);
    return { ok: false, error: depErr.message };
  }
  resetStaffPersistenceCache();
  return { ok: true };
}

export function staffReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STAFF_READ_FROM_DB === "true";
}

/** Strip staff roster from masters before school_mirror blob upsert. */
export function stripStaffFromMastersForBlob(
  state: MastersState,
): MastersState {
  if (!staffReadFromDbEnabled()) return state;
  return {
    ...state,
    departments: [],
    designations: [],
    staff: [],
  };
}

export function scheduleStaffSync(state: MastersState) {
  if (!staffRemoteEnabled()) return;
  if (typeof window === "undefined") {
    void pushStaffRemoteServer(state);
    return;
  }
  pendingPush = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const payload = pendingPush;
    pendingPush = null;
    pushTimer = null;
    if (!payload) return;
    void pushStaffSlice(payload);
  }, 500);
}

/**
 * Pull staff slice once, merge into Masters localStorage, then push desk.
 */
export async function ensureStaffHydrated(): Promise<boolean> {
  if (!staffRemoteEnabled()) return false;
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

  const readFromDb = staffReadFromDbEnabled();
  const remote = await fetchStaffRemote();
  const { loadMasters, saveMasters } = await import("@/lib/masters");
  let next = loadMasters();
  let changed = false;

  if (
    remote &&
    (remote.departments.length > 0 ||
      remote.designations.length > 0 ||
      remote.staff.length > 0)
  ) {
    next = mergeStaffRemoteIntoMasters(next, remote, {
      preferDb: readFromDb || (next.staff?.length ?? 0) === 0,
    });
    changed = true;
  }

  const localStaffCount = next.staff?.length ?? 0;
  const remoteStaffCount = remote?.staff.length ?? 0;
  // DB-read mode: hydrate is pull-only; don't push stale browser demo roster back to server.
  if (!readFromDb && localStaffCount > 0) {
    await pushStaffSlice(next);
  }

  if (changed) {
    saveMasters(next);
  }

  return changed;
}
