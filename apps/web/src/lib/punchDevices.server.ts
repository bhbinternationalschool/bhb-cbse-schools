import { createHash, randomBytes, randomInt, webcrypto } from "crypto";
import { getServerTenantContext } from "@/lib/serverTenant";
import { mergePunchAttempt, type PunchAttempt } from "@/lib/punchAttempts";

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
  attempts?: PunchAttempt[];
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
  /** This punch — kept on a pending phone so approval records it at this time. */
  attempt?: PunchAttempt;
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
    // A different phone. Keep one pending ask per staff+phone, carrying
    // today's refused punches so the office's approval records them at the
    // time they were made.
    const label = input.label.slice(0, 80);
    const { data: pend, error: pendReadErr } = await sb
      .from("staff_punch_devices")
      .select("id, attempts")
      .eq("tenant_id", tenantId)
      .eq("staff_id", input.staffId)
      .eq("device_id", deviceId)
      .eq("status", "pending")
      .maybeSingle();
    if (pendReadErr) {
      console.warn("[punch-devices] pending read failed", pendReadErr.message);
    } else if (pend) {
      const attempts = input.attempt
        ? mergePunchAttempt(pend.attempts, input.attempt, Date.now())
        : pend.attempts;
      await sb
        .from("staff_punch_devices")
        .update({ updated_at: now, label, attempts })
        .eq("id", pend.id);
    } else {
      const { error: pendErr } = await sb.from("staff_punch_devices").insert({
        tenant_id: tenantId,
        staff_id: input.staffId,
        device_id: deviceId,
        public_key: input.jwk,
        status: "pending",
        label,
        attempts: input.attempt ? mergePunchAttempt([], input.attempt, Date.now()) : [],
      });
      if (pendErr && pendErr.code !== "23505") {
        console.warn("[punch-devices] pending insert failed", pendErr.message);
      }
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
    .select("id, staff_id, device_id, status, label, created_at, decided_by, decided_at, last_used_at, attempts")
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
): Promise<
  { ok: true; staffId?: string; attempts?: PunchAttempt[] } | { ok: false; error: string }
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const { data: row, error } = await sb
    .from("staff_punch_devices")
    .select("id, staff_id, device_id, status, attempts")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "Not found" };
  const r = row as Pick<PunchDeviceRow, "id" | "staff_id" | "device_id" | "status" | "attempts">;

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
    .update({ status: "active", decided_by: by, decided_at: now, updated_at: now, attempts: [] })
    .eq("id", id)
    .eq("status", "pending");
  return actErr
    ? { ok: false, error: actErr.message }
    : { ok: true, staffId: r.staff_id, attempts: Array.isArray(r.attempts) ? r.attempts : [] };
}

/* ── Office QR screens ──────────────────────────────────────────────── */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createPunchDisplay(
  label: string,
  by: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string; duplicate?: true }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable" };
  // The same person switching on a same-named screen twice inside half a
  // minute is a double tap, not a second screen — 6–8 Oct 2026 left pairs
  // and threes of "Office tablet" created within milliseconds of each other.
  const since = new Date(Date.now() - 30_000).toISOString();
  const { data: recent } = await ctx.sb
    .from("staff_punch_displays")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("created_by", by)
    .eq("label", label.slice(0, 80))
    .is("revoked_at", null)
    .gte("created_at", since)
    .limit(1);
  if (recent && recent.length > 0) {
    return { ok: false, duplicate: true, error: "This screen was switched on a moment ago — open /punch-screen on it." };
  }
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
    // A screen still waiting for its pairing code is not a screen yet.
    .is("pairing_code_hash", null)
    .order("created_at", { ascending: false });
  return error ? null : data ?? [];
}

// ------------------------------------------------------------ pairing code

const PAIRING_TTL_MS = 10 * 60_000;
const PAIRING_MAX_TRIES = 5;

const pairHash = (code: string) => sha(`punch-pair|${code}`);

/**
 * Start pairing a gate screen (director, 5 Oct 2026): a one-time 6-digit
 * code, valid 10 minutes, so the gate phone is switched on without anybody
 * signing in on it. Only one pairing is open at a time — starting another
 * cancels the last — which is also what makes five wrong tries enough to
 * stop guessing: they all count against the one open code.
 */
export async function startScreenPairing(
  label: string,
  by: string,
): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable" };
  const now = new Date();
  await ctx.sb
    .from("staff_punch_displays")
    .update({ revoked_at: now.toISOString(), pairing_code_hash: null })
    .eq("tenant_id", ctx.tenantId)
    .is("revoked_at", null)
    .not("pairing_code_hash", "is", null);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
  const { error } = await ctx.sb.from("staff_punch_displays").insert({
    tenant_id: ctx.tenantId,
    // A placeholder nobody holds: the row shows nothing until paired.
    token_hash: sha(randomBytes(24).toString("base64url")),
    label: label.slice(0, 80) || "Gate phone",
    created_by: by,
    pairing_code_hash: pairHash(code),
    pairing_expires_at: expiresAt,
    pairing_attempts: 0,
  });
  return error ? { ok: false, error: error.message } : { ok: true, code, expiresAt };
}

/** The gate phone types the code — inside the school, checked by the caller. */
export async function completeScreenPairing(
  raw: unknown,
): Promise<{ ok: true; token: string; label: string } | { ok: false; error: string; status: number }> {
  const code = String(raw ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "Type the 6-digit pairing code from the office.", status: 400 };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable", status: 503 };
  const { data, error } = await ctx.sb
    .from("staff_punch_displays")
    .select("id, label, pairing_code_hash, pairing_expires_at, pairing_attempts")
    .eq("tenant_id", ctx.tenantId)
    .is("revoked_at", null)
    .not("pairing_code_hash", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: "Could not check the code right now — try again.", status: 503 };
  const row = data as {
    id: string;
    label: string;
    pairing_code_hash: string;
    pairing_expires_at: string | null;
    pairing_attempts: number | null;
  } | null;
  const expired = !row || !row.pairing_expires_at || Date.parse(row.pairing_expires_at) < Date.now();
  if (expired) {
    return { ok: false, error: "No pairing code is open. Ask the office to press “Pair a gate screen” again.", status: 404 };
  }
  if (row.pairing_code_hash !== pairHash(code)) {
    const tries = (row.pairing_attempts ?? 0) + 1;
    await ctx.sb
      .from("staff_punch_displays")
      .update(
        tries >= PAIRING_MAX_TRIES
          ? { pairing_attempts: tries, revoked_at: new Date().toISOString(), pairing_code_hash: null }
          : { pairing_attempts: tries },
      )
      .eq("id", row.id);
    return {
      ok: false,
      error:
        tries >= PAIRING_MAX_TRIES
          ? "Too many wrong codes — this pairing is cancelled. Ask the office for a new one."
          : `That code is not right (${PAIRING_MAX_TRIES - tries} tries left).`,
      status: 403,
    };
  }
  const token = randomBytes(24).toString("base64url");
  // Conditional on the code still being open: two phones typing the same
  // code at once cannot both become screens.
  const { data: done, error: upErr } = await ctx.sb
    .from("staff_punch_displays")
    .update({
      token_hash: sha(token),
      pairing_code_hash: null,
      pairing_expires_at: null,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("pairing_code_hash", pairHash(code))
    .select("id");
  if (upErr || !done || done.length === 0) {
    return { ok: false, error: "This code was just used. Ask the office for a new one.", status: 409 };
  }
  return { ok: true, token, label: String(row.label || "Gate phone") };
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
