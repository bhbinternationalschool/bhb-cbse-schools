import { createHash, randomBytes, webcrypto } from "crypto";
import { getServerTenantContext } from "@/lib/serverTenant";

/**
 * Staff punch phones and office QR screens (director, 30 Sep 2026).
 * Schema and the why: supabase/migrations/20260930090000_staff_punch_devices.sql.
 *
 * A phone is its browser's non-extractable ECDSA P-256 key; device_id is
 * the SHA-256 of the public key. Every punch is signed with it.
 *
 * Unknown is never "allowed": a failed read refuses the punch.
 */

export type PunchJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };

export type PunchDeviceRow = {
  id: string;
  staff_id: string;
  device_id: string;
  status: "active" | "pending" | "rejected" | "revoked";
  label: string;
  created_at: string;
  decided_by: string;
  decided_at: string | null;
  last_used_at: string | null;
};

export function cleanJwk(raw: unknown): PunchJwk | null {
  const j = raw as Partial<PunchJwk> | null;
  if (!j || j.kty !== "EC" || j.crv !== "P-256") return null;
  if (typeof j.x !== "string" || typeof j.y !== "string") return null;
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(j.x) || !/^[A-Za-z0-9_-]{40,50}$/.test(j.y)) return null;
  return { kty: "EC", crv: "P-256", x: j.x, y: j.y };
}

export function deviceIdOf(jwk: PunchJwk): string {
  return createHash("sha256").update(`${jwk.x}.${jwk.y}`).digest("base64url");
}

/** The exact bytes a phone signs for one punch. */
export function punchMessage(p: { staffId: string; kind: string; code: string; ts: number }): string {
  return `punch|${p.staffId}|${p.kind}|${p.code}|${p.ts}`;
}

export async function verifyPunchSignature(
  jwk: PunchJwk,
  message: string,
  signatureB64url: string,
): Promise<boolean> {
  try {
    const key = await webcrypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Buffer.from(signatureB64url, "base64url"),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

export type DeviceCheck =
  | { ok: true; firstRegistration: boolean }
  | {
      ok: false;
      reason: "other_staff" | "not_registered" | "unavailable";
      otherStaffId?: string;
    };

/**
 * May this phone punch for this staff member?
 *  - their active phone → yes;
 *  - active for someone else → no (one phone cannot punch for two);
 *  - they have no phone yet → this one becomes theirs (first punch);
 *  - they have another phone → no; a pending request waits for the office.
 */
export async function checkPunchDevice(input: {
  staffId: string;
  jwk: PunchJwk;
  label: string;
}): Promise<DeviceCheck> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, reason: "unavailable" };
  const { sb, tenantId } = ctx;
  const deviceId = deviceIdOf(input.jwk);
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from("staff_punch_devices")
    .select("id, staff_id, device_id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .or(`staff_id.eq.${input.staffId},device_id.eq.${deviceId}`);
  if (error) {
    console.warn("[punch-devices] read failed", error.message);
    return { ok: false, reason: "unavailable" };
  }
  const rows = (data ?? []) as Pick<PunchDeviceRow, "id" | "staff_id" | "device_id" | "status">[];
  const phoneOwner = rows.find((r) => r.device_id === deviceId);
  if (phoneOwner && phoneOwner.staff_id !== input.staffId) {
    return { ok: false, reason: "other_staff", otherStaffId: phoneOwner.staff_id };
  }
  const mine = rows.find((r) => r.staff_id === input.staffId);
  if (mine && mine.device_id === deviceId) {
    try {
      await sb.from("staff_punch_devices").update({ last_used_at: now }).eq("id", mine.id);
    } catch {
      /* best effort — the punch is what matters */
    }
    return { ok: true, firstRegistration: false };
  }
  if (mine) {
    // A different phone. Record the ask once (the partial unique index
    // keeps one pending row per staff+phone) and refuse.
    const { error: pendErr } = await sb.from("staff_punch_devices").insert({
      tenant_id: tenantId,
      staff_id: input.staffId,
      device_id: deviceId,
      public_key: input.jwk,
      status: "pending",
      label: input.label.slice(0, 80),
    });
    if (pendErr && pendErr.code !== "23505") {
      console.warn("[punch-devices] pending insert failed", pendErr.message);
    }
    if (!pendErr || pendErr.code === "23505") {
      await sb
        .from("staff_punch_devices")
        .update({ updated_at: now, label: input.label.slice(0, 80) })
        .eq("tenant_id", tenantId)
        .eq("staff_id", input.staffId)
        .eq("device_id", deviceId)
        .eq("status", "pending");
    }
    return { ok: false, reason: "not_registered" };
  }
  // First punch ever: this phone becomes theirs.
  const { error: insErr } = await sb.from("staff_punch_devices").insert({
    tenant_id: tenantId,
    staff_id: input.staffId,
    device_id: deviceId,
    public_key: input.jwk,
    status: "active",
    label: input.label.slice(0, 80),
    decided_by: "first punch",
    decided_at: now,
    last_used_at: now,
  });
  if (insErr) {
    // 23505: a race — another request registered first. Ask again.
    console.warn("[punch-devices] first registration failed", insErr.message);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, firstRegistration: true };
}

export async function listPunchDevices(): Promise<PunchDeviceRow[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("staff_punch_devices")
    .select("id, staff_id, device_id, status, label, created_at, decided_by, decided_at, last_used_at")
    .eq("tenant_id", ctx.tenantId)
    .in("status", ["active", "pending"])
    .order("created_at", { ascending: false });
  if (error) return null;
  return (data ?? []) as PunchDeviceRow[];
}

/**
 * approve — a pending phone becomes the staff member's phone (the old one
 *           is revoked first); refused if that phone is active for someone else.
 * reject  — the pending ask is closed.
 * reset   — the active phone is revoked; the next punch registers anew.
 */
export async function decidePunchDevice(
  id: string,
  action: "approve" | "reject" | "reset",
  by: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const { data: row, error } = await sb
    .from("staff_punch_devices")
    .select("id, staff_id, device_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "Not found" };
  const r = row as Pick<PunchDeviceRow, "id" | "staff_id" | "device_id" | "status">;

  if (action === "reset") {
    if (r.status !== "active") return { ok: false, error: "That phone is not active" };
    const { error: e } = await sb
      .from("staff_punch_devices")
      .update({ status: "revoked", decided_by: by, decided_at: now, updated_at: now })
      .eq("id", id)
      .eq("status", "active");
    return e ? { ok: false, error: e.message } : { ok: true };
  }
  if (r.status !== "pending") return { ok: false, error: "Already decided" };
  if (action === "reject") {
    const { error: e } = await sb
      .from("staff_punch_devices")
      .update({ status: "rejected", decided_by: by, decided_at: now, updated_at: now })
      .eq("id", id)
      .eq("status", "pending");
    return e ? { ok: false, error: e.message } : { ok: true };
  }
  const { data: other } = await sb
    .from("staff_punch_devices")
    .select("staff_id")
    .eq("tenant_id", tenantId)
    .eq("device_id", r.device_id)
    .eq("status", "active")
    .neq("staff_id", r.staff_id)
    .maybeSingle();
  if (other) {
    return { ok: false, error: "That phone is registered to another staff member — reset theirs first." };
  }
  const { error: revErr } = await sb
    .from("staff_punch_devices")
    .update({ status: "revoked", decided_by: by, decided_at: now, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("staff_id", r.staff_id)
    .eq("status", "active");
  if (revErr) return { ok: false, error: revErr.message };
  const { error: actErr } = await sb
    .from("staff_punch_devices")
    .update({ status: "active", decided_by: by, decided_at: now, updated_at: now })
    .eq("id", id)
    .eq("status", "pending");
  return actErr ? { ok: false, error: actErr.message } : { ok: true };
}

/* ── Office QR screens ──────────────────────────────────────────────── */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createPunchDisplay(
  label: string,
  by: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable" };
  const token = randomBytes(24).toString("base64url");
  const { error } = await ctx.sb.from("staff_punch_displays").insert({
    tenant_id: ctx.tenantId,
    token_hash: sha(token),
    label: label.slice(0, 80),
    created_by: by,
  });
  return error ? { ok: false, error: error.message } : { ok: true, token };
}

/** null = the screen is unknown or switched off; "unavailable" = cannot tell. */
export async function punchDisplayFor(
  token: string,
): Promise<{ id: string; label: string } | null | "unavailable"> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const ctx = await getServerTenantContext();
  if (!ctx) return "unavailable";
  const { data, error } = await ctx.sb
    .from("staff_punch_displays")
    .select("id, label, revoked_at, last_seen_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("token_hash", sha(token))
    .maybeSingle();
  if (error) return "unavailable";
  if (!data || data.revoked_at) return null;
  const seen = data.last_seen_at ? Date.parse(String(data.last_seen_at)) : 0;
  if (Date.now() - seen > 5 * 60_000) {
    // Best effort — a stamp that fails must not blank the screen.
    try {
      await ctx.sb
        .from("staff_punch_displays")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", data.id);
    } catch {
      /* ignore */
    }
  }
  return { id: String(data.id), label: String(data.label || "") };
}

export async function listPunchDisplays() {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("staff_punch_displays")
    .select("id, label, created_by, created_at, last_seen_at")
    .eq("tenant_id", ctx.tenantId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return error ? null : data ?? [];
}

export async function revokePunchDisplay(id: string): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { error } = await ctx.sb
    .from("staff_punch_displays")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  return !error;
}
