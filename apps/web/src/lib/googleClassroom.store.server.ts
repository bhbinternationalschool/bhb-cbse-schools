/**
 * Google per-staff connections + Classroom course mappings.
 *
 * Connections live in Postgres (public.google_staff_connections) since
 * 2026-09-09. They were in .data/google_classroom.json before, which Cloud
 * Run's filesystem forgets on every deploy — every teacher's Google grant
 * died with each release and nobody noticed because Classroom sync was
 * rarely used. Online classes create Meet rooms on the teacher's own
 * account, so a grant that vanishes weekly is not acceptable there.
 *
 * Course mappings stay on disk for now: they are Classroom-only, tiny, and
 * the Classroom feature is dormant. The disk store is also still read as
 * a fallback for a connection the table does not have yet.
 */

import { promises as fs } from "fs";
import path from "path";
import { getServerTenantContext } from "@/lib/serverTenant";

const DATA_FILE = path.join(process.cwd(), ".data", "google_classroom.json");
const TABLE = "google_staff_connections";

export type ClassroomStaffConnection = {
  staffKey: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  connectedAt: string;
  /** Space-separated scopes Google granted. '' for legacy disk rows. */
  scopes: string;
};

export type ClassroomCourseMapping = {
  courseId: string;
  courseName: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  enabled: boolean;
  updatedAt: string;
};

export type ClassroomStore = {
  version: 1;
  updatedAt: string;
  connections: ClassroomStaffConnection[];
  mappings: ClassroomCourseMapping[];
  lastSyncAt: string;
};

let cache: ClassroomStore | null = null;

function nowIso() {
  return new Date().toISOString();
}

function emptyStore(): ClassroomStore {
  return {
    version: 1,
    updatedAt: nowIso(),
    connections: [],
    mappings: [],
    lastSyncAt: "",
  };
}

export async function loadClassroomStore(): Promise<ClassroomStore> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as ClassroomStore;
    if (parsed?.version === 1) {
      cache = {
        version: 1,
        updatedAt: parsed.updatedAt || nowIso(),
        connections: Array.isArray(parsed.connections)
          ? parsed.connections.map((c) => ({ ...c, scopes: c.scopes || "" }))
          : [],
        mappings: Array.isArray(parsed.mappings) ? parsed.mappings : [],
        lastSyncAt: parsed.lastSyncAt || "",
      };
      return cache;
    }
  } catch {
    /* first run */
  }
  cache = emptyStore();
  return cache;
}

async function saveClassroomStore(store: ClassroomStore): Promise<void> {
  cache = { ...store, version: 1, updatedAt: nowIso() };
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* ephemeral disk */
  }
}

export function staffConnectionKey(opts: {
  staffId?: string;
  email?: string;
  fullName?: string;
}): string {
  return opts.staffId || opts.email || opts.fullName || "unknown";
}

type Row = {
  staff_key: string;
  email: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scopes: string;
  connected_at: string;
};

function fromRow(r: Row): ClassroomStaffConnection {
  return {
    staffKey: r.staff_key,
    email: r.email || "",
    accessToken: r.access_token || "",
    refreshToken: r.refresh_token || "",
    expiresAt: r.expires_at,
    connectedAt: r.connected_at,
    scopes: r.scopes || "",
  };
}

export async function getStaffConnection(
  staffKey: string,
): Promise<ClassroomStaffConnection | null> {
  const ctx = await getServerTenantContext();
  if (ctx) {
    const { data, error } = await ctx.sb
      .from(TABLE)
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("staff_key", staffKey)
      .maybeSingle();
    if (!error && data) return fromRow(data as Row);
  }
  const store = await loadClassroomStore();
  return store.connections.find((c) => c.staffKey === staffKey) || null;
}

/** Every connected staff member — the office's "who can host a Meet" view. */
export async function listStaffConnections(): Promise<ClassroomStaffConnection[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb
    .from(TABLE)
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .limit(1000);
  if (error || !data) return [];
  return (data as Row[]).map(fromRow);
}

export async function upsertStaffConnection(
  conn: Omit<ClassroomStaffConnection, "connectedAt" | "scopes"> & {
    connectedAt?: string;
    scopes?: string;
  },
): Promise<ClassroomStaffConnection> {
  const row: ClassroomStaffConnection = {
    ...conn,
    connectedAt: conn.connectedAt || nowIso(),
    scopes: conn.scopes ?? "",
  };
  const ctx = await getServerTenantContext();
  if (ctx) {
    const { error } = await ctx.sb.from(TABLE).upsert(
      {
        tenant_id: ctx.tenantId,
        staff_key: row.staffKey,
        email: row.email,
        access_token: row.accessToken,
        refresh_token: row.refreshToken,
        expires_at: row.expiresAt,
        scopes: row.scopes,
        connected_at: row.connectedAt,
        updated_at: nowIso(),
      },
      { onConflict: "tenant_id,staff_key" },
    );
    if (!error) return row;
    console.warn("[google-staff] upsert failed", error.message);
  }
  const store = await loadClassroomStore();
  const i = store.connections.findIndex((c) => c.staffKey === conn.staffKey);
  if (i >= 0) store.connections[i] = row;
  else store.connections.push(row);
  await saveClassroomStore(store);
  return row;
}

export async function removeStaffConnection(staffKey: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (ctx) {
    await ctx.sb
      .from(TABLE)
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("staff_key", staffKey);
  }
  const store = await loadClassroomStore();
  store.connections = store.connections.filter((c) => c.staffKey !== staffKey);
  await saveClassroomStore(store);
}

export async function listCourseMappings(): Promise<ClassroomCourseMapping[]> {
  const store = await loadClassroomStore();
  return store.mappings;
}

export async function upsertCourseMapping(
  mapping: Omit<ClassroomCourseMapping, "updatedAt">,
): Promise<ClassroomCourseMapping> {
  const store = await loadClassroomStore();
  const row: ClassroomCourseMapping = {
    ...mapping,
    updatedAt: nowIso(),
  };
  const i = store.mappings.findIndex((m) => m.courseId === mapping.courseId);
  if (i >= 0) store.mappings[i] = row;
  else store.mappings.push(row);
  await saveClassroomStore(store);
  return row;
}

export async function removeCourseMapping(courseId: string): Promise<void> {
  const store = await loadClassroomStore();
  store.mappings = store.mappings.filter((m) => m.courseId !== courseId);
  await saveClassroomStore(store);
}

export async function touchLastSync(): Promise<void> {
  const store = await loadClassroomStore();
  store.lastSyncAt = nowIso();
  await saveClassroomStore(store);
}
