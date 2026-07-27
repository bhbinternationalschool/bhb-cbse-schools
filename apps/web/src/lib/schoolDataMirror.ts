/**
 * School data mirror — client-safe (no Node fs).
 * Browser localStorage remains the desk working copy; POSTs keep the server
 * mirror in sync. Disk persistence lives in schoolDataMirror.server.ts.
 */

export type SchoolMirrorBundle = {
  version: 1;
  updatedAt: string;
  sis: unknown | null;
  fees: unknown | null;
  payments: unknown | null;
  masters: unknown | null;
  admissions: unknown | null;
};

let memory: SchoolMirrorBundle = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  sis: null,
  fees: null,
  payments: null,
  masters: null,
  admissions: null,
};

let diskPersist: (() => void) | null = null;

function nowIso() {
  return new Date().toISOString();
}

/** Server-only module registers this so setMirrorSlice can flush to disk. */
export function registerSchoolMirrorDiskPersist(fn: () => void): void {
  diskPersist = fn;
}

export function getSchoolMirrorSync(): SchoolMirrorBundle {
  return memory;
}

export function replaceSchoolMirror(next: SchoolMirrorBundle): void {
  memory = {
    version: 1,
    updatedAt: next.updatedAt || nowIso(),
    sis: next.sis ?? null,
    fees: next.fees ?? null,
    payments: next.payments ?? null,
    masters: next.masters ?? null,
    admissions: next.admissions ?? null,
  };
}

export function setMirrorSlice(
  key: "sis" | "fees" | "payments" | "masters" | "admissions",
  value: unknown,
): void {
  memory = {
    ...memory,
    [key]: value,
    version: 1,
    updatedAt: nowIso(),
  };
  diskPersist?.();
}

/** Browser: best-effort push working copy to server mirror. */
export function scheduleClientSchoolMirrorSync(partial: {
  sis?: unknown;
  fees?: unknown;
  payments?: unknown;
  masters?: unknown;
  admissions?: unknown;
}): void {
  if (typeof window === "undefined") return;
  const body: Record<string, unknown> = {};
  if (partial.sis !== undefined) body.sis = partial.sis;
  if (partial.fees !== undefined) body.fees = partial.fees;
  if (partial.payments !== undefined) body.payments = partial.payments;
  if (partial.masters !== undefined) body.masters = partial.masters;
  if (partial.admissions !== undefined) body.admissions = partial.admissions;
  if (Object.keys(body).length === 0) return;
  void fetch("/api/school-data/mirror", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    keepalive: true,
  })
    .then(async (res) => {
      if (res.ok) return;
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
        supabaseError?: string | null;
      } | null;
      const detail =
        payload?.supabaseError || payload?.error || `HTTP ${res.status}`;
      console.error("[schoolMirror] push failed:", detail);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("bhb-mirror-sync-failed", {
            detail: { message: detail, status: res.status },
          }),
        );
      }
    })
    .catch((err) => {
      console.error("[schoolMirror] push failed:", err);
    });
}

/** Push full desk working copy to server (WhatsApp identity + chat). */
export function pushFullSchoolMirrorToServer(): void {
  if (typeof window === "undefined") return;
  void (async () => {
    const { loadSis } = await import("@/lib/sis");
    const { loadFees } = await import("@/lib/fees");
    const { loadPayments } = await import("@/lib/payments");
    const { loadMasters } = await import("@/lib/masters");
    const { loadAdmissions } = await import("@/lib/admissions");
    const admissions = loadAdmissions();
    const partial: {
      sis?: unknown;
      fees?: unknown;
      payments?: unknown;
      masters?: unknown;
      admissions?: unknown;
    } = {
      sis: loadSis(),
      fees: loadFees(),
      payments: loadPayments(),
      masters: loadMasters(),
    };
    // Never push an empty CRM desk over a populated server mirror.
    if ((admissions.leads?.length ?? 0) > 0) {
      partial.admissions = admissions;
    }
    scheduleClientSchoolMirrorSync(partial);
  })();
}

/** Browser: pull server mirror. */
export async function fetchSchoolMirror(): Promise<SchoolMirrorBundle | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/school-data/mirror", {
      method: "GET",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    return (await res.json()) as SchoolMirrorBundle;
  } catch {
    return null;
  }
}
