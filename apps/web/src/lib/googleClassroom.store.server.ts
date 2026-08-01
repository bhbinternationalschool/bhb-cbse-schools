/**
 * Google Classroom — OAuth tokens + course mappings (server disk).
 */

import { promises as fs } from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), ".data", "google_classroom.json");

export type ClassroomStaffConnection = {
  staffKey: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  connectedAt: string;
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
          ? parsed.connections
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

export async function getStaffConnection(
  staffKey: string,
): Promise<ClassroomStaffConnection | null> {
  const store = await loadClassroomStore();
  return store.connections.find((c) => c.staffKey === staffKey) || null;
}

export async function upsertStaffConnection(
  conn: Omit<ClassroomStaffConnection, "connectedAt"> & {
    connectedAt?: string;
  },
): Promise<ClassroomStaffConnection> {
  const store = await loadClassroomStore();
  const row: ClassroomStaffConnection = {
    ...conn,
    connectedAt: conn.connectedAt || nowIso(),
  };
  const i = store.connections.findIndex((c) => c.staffKey === conn.staffKey);
  if (i >= 0) store.connections[i] = row;
  else store.connections.push(row);
  await saveClassroomStore(store);
  return row;
}

export async function removeStaffConnection(staffKey: string): Promise<void> {
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
