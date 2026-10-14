/**
 * Shared by the data-layer 4.1 checks of the parent app's routes
 * (e2e/v1-*.acceptance.ts and e2e/parentApi.golden.ts): parent sessions for
 * the fixture's families, HTTP helpers, and the extra data those routes read
 * that the base seed does not write — app pop-ups and their events,
 * attendance registers with marks, and fee open-dues rows — written to the
 * LOCAL stack through PostgREST with the stack's service key, and removed
 * again by `cleanupParentApiData` (Playwright counts must not see them).
 *
 * Every id written here starts with `e2e_` / `e2e:` so the clean-up can only
 * ever remove what this file wrote.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DemoSession } from "@/lib/auth";
import { AY_CURRENT, buildFixture, classId, sectionId, E2E_TENANT_SLUG } from "./fixture";
import { assertLocalStack, sessionCookieHeader } from "./session";

export type Outcome = { name: string; ok: boolean; detail: string };

export function reporter() {
  const outcomes: Outcome[] = [];
  return {
    outcomes,
    record(name: string, ok: boolean, detail: string): void {
      outcomes.push({ name, ok, detail });
      console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
    },
    finish(label: string): void {
      const failed = outcomes.filter((o) => !o.ok);
      console.log(`\n${label}: ${outcomes.length - failed.length}/${outcomes.length} passed`);
      if (failed.length) {
        for (const f of failed) console.log(`  FAILED: ${f.name}`);
        process.exitCode = 1;
      }
    },
  };
}

export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const pct = (xs: number[], p: number): number =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))]! : NaN;

export type HttpResult = { status: number; body: unknown; text: string; ms: number };

export async function get(url: string, headers: Record<string, string> = {}): Promise<HttpResult> {
  const t0 = performance.now();
  const res = await fetch(url, { headers, redirect: "manual" });
  const text = await res.text();
  const ms = performance.now() - t0;
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _text: text.slice(0, 200) };
  }
  return { status: res.status, body, text, ms };
}

export function localUrl(name: string, value: string | undefined): string {
  const v = value || "";
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(v)) throw new Error(`${name} is "${v}", not http://127.0.0.1:<port>`);
  return v;
}

/** What the app's parent OTP login signs (lib/parentSession.server.ts). */
export function parentSession(householdId: string, guardianName = "Parent"): DemoSession {
  return {
    persona: "parent",
    fullName: guardianName,
    roleCode: "parent",
    householdId,
    tenantSlug: E2E_TENANT_SLUG,
    academicYearCode: AY_CURRENT,
  };
}

export function cookieFor(session: DemoSession): Record<string, string> {
  return { cookie: sessionCookieHeader(session) };
}

// ── The local stack's PostgREST, as the service role ─────────────────────

function rest() {
  assertLocalStack();
  const api = localUrl("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing (.env.e2e)");
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };
  const call = async (method: string, path: string, body?: unknown, prefer?: string) => {
    const res = await fetch(`${api}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as unknown) : null;
  };
  return {
    select: (path: string) => call("GET", path) as Promise<unknown[]>,
    insert: async (table: string, rows: unknown[], upsertOn?: string) => {
      for (let i = 0; i < rows.length; i += 500) {
        await call(
          "POST",
          upsertOn ? `${table}?on_conflict=${upsertOn}` : table,
          rows.slice(i, i + 500),
          upsertOn ? "resolution=merge-duplicates,return=minimal" : "return=minimal",
        );
      }
    },
    remove: (path: string) => call("DELETE", path, undefined, "return=minimal"),
  };
}

export async function tenantId(): Promise<string> {
  const rows = (await rest().select(`tenants?slug=eq.${E2E_TENANT_SLUG}&select=id`)) as { id: string }[];
  if (!rows[0]?.id) throw new Error("tenant not found on the local stack");
  return rows[0].id;
}

/** YYYY-MM-DD in India, `daysAgo` days back — the routes compute "since" the same way. */
export function istDay(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

const SECTIONS = 13;
const STATUSES = ["P", "P", "P", "A", "L", "P", "HD", "P", "LE", "P", "A"] as const;

function popup(over: Record<string, unknown> & { id: string; title: string }): Record<string, unknown> {
  return {
    titleHi: `${over.title} (हिं)`,
    body: `Body of ${over.title}`,
    bodyHi: "",
    imageUrl: "",
    kind: "info",
    form: "none",
    consentKey: "",
    consentText: "",
    consentTextHi: "",
    aadhaarScope: "all",
    audience: "parents",
    targetMode: "all",
    classIds: [],
    rule: "",
    startsOn: "",
    endsOn: "",
    frequency: "until_done",
    ctaLabel: "",
    ctaRoute: "",
    active: true,
    createdBy: "e2e",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

/**
 * Writes the extra data (idempotent: removes its own rows first).
 * Returns what it wrote, for the checks' messages.
 */
export async function seedParentApiData(): Promise<{ popups: number; events: number; registers: number; marks: number; openDues: number }> {
  await cleanupParentApiData();
  const db = rest();
  const tenant = await tenantId();
  const fx = buildFixture();

  // App pop-ups: every kind of rule the parent route evaluates.
  const popups = [
    popup({ id: "e2e_pop_all", title: "E2E all parents", updatedAt: "2026-10-02T10:00:00.000Z" }),
    popup({ id: "e2e_pop_cls", title: "E2E classes 1 and 5", kind: "poster", targetMode: "classes", classIds: [classId(1), classId(5)], frequency: "daily", updatedAt: "2026-10-03T10:00:00.000Z" }),
    popup({ id: "e2e_pop_aadhaar", title: "E2E Aadhaar", form: "aadhaar", kind: "form", targetMode: "rule", rule: "missing_aadhaar", updatedAt: "2026-10-04T10:00:00.000Z" }),
    popup({ id: "e2e_pop_aadhaar_child", title: "E2E Aadhaar child only", form: "aadhaar", kind: "form", aadhaarScope: "child", targetMode: "all", updatedAt: "2026-10-04T11:00:00.000Z" }),
    popup({ id: "e2e_pop_docs", title: "E2E documents", form: "documents", kind: "form", targetMode: "rule", rule: "missing_docs", updatedAt: "2026-10-05T10:00:00.000Z" }),
    popup({ id: "e2e_pop_apaar", title: "E2E APAAR", form: "consent", kind: "form", consentKey: "apaar", targetMode: "rule", rule: "consent_pending", updatedAt: "2026-10-06T10:00:00.000Z" }),
    popup({ id: "e2e_pop_photo", title: "E2E photo consent", form: "consent", kind: "form", consentKey: "photo", consentText: "Photos?", updatedAt: "2026-10-07T10:00:00.000Z" }),
    popup({ id: "e2e_pop_staff", title: "E2E staff", audience: "staff", updatedAt: "2026-10-08T10:00:00.000Z" }),
    popup({ id: "e2e_pop_off", title: "E2E switched off", active: false }),
    popup({ id: "e2e_pop_ended", title: "E2E ended", endsOn: "2026-01-31" }),
    popup({ id: "e2e_pop_future", title: "E2E not yet", startsOn: "2099-01-01" }),
  ];
  await db.insert("module_local_state", [{ tenant_id: tenant, module_key: "app_popups", state: { version: 1, popups }, updated_at: new Date().toISOString() }], "tenant_id,module_key");

  // Events: some families finished / dismissed some of them.
  const hhIds = fx.sis.households.map((h) => h.id);
  const events: Record<string, unknown>[] = [];
  hhIds.forEach((hh, i) => {
    if (i % 4 === 0) events.push({ tenant_id: tenant, popup_id: "e2e_pop_all", subject_key: `hh:${hh}`, event: "done", value: {} });
    if (i % 6 === 1) events.push({ tenant_id: tenant, popup_id: "e2e_pop_cls", subject_key: `hh:${hh}`, event: "dismissed", value: {} });
    if (i % 5 === 2) events.push({ tenant_id: tenant, popup_id: "e2e_pop_photo", subject_key: `hh:${hh}`, event: "done", value: { consent: "yes" } });
    if (i % 7 === 3) events.push({ tenant_id: tenant, popup_id: "e2e_pop_aadhaar", subject_key: `hh:${hh}`, event: "shown", value: {} });
  });
  await db.insert("app_popup_events", events);

  // Attendance: this year's registers every 3rd day for 150 days in every
  // section (so 90 days and 366 days differ), last year's on some days, and
  // marks for the children on roll there — every status the table allows,
  // some children left unmarked, and some last-year rows marked too.
  const current = fx.sis.students.filter((s) => s.academicYearCode === AY_CURRENT);
  const registers: Record<string, unknown>[] = [];
  const marks: Record<string, unknown>[] = [];
  for (let k = 1; k <= SECTIONS; k++) {
    const inSection = current.filter((s) => s.sectionId === sectionId(k));
    for (let d = 1; d <= 150; d += 3) {
      const date = istDay(d);
      const rid = `e2e_ar_${k}_${d}`;
      registers.push({
        id: rid, tenant_id: tenant, academic_year_code: AY_CURRENT, campus_id: "", class_id: classId(k), section_id: sectionId(k),
        attendance_date: date, marked_by: "e2e", marked_at: `${date}T04:00:00.000Z`, remark: "", register_json: {},
      });
      inSection.forEach((s, j) => {
        if ((j + d) % 9 === 0) return; // not marked that day
        marks.push({ id: `e2e_am_${k}_${d}_${s.id}`, register_id: rid, tenant_id: tenant, student_id: s.id, status: STATUSES[(j * 7 + d) % STATUSES.length], note: "" });
      });
    }
    // Last year's register on the same section (never this year's answer).
    for (let d = 2; d <= 60; d += 10) {
      const date = istDay(d);
      const rid = `e2e_ar_prev_${k}_${d}`;
      registers.push({
        id: rid, tenant_id: tenant, academic_year_code: "2025-26", campus_id: "", class_id: classId(k), section_id: sectionId(k),
        attendance_date: date, marked_by: "e2e", marked_at: `${date}T04:00:00.000Z`, remark: "", register_json: {},
      });
      for (const s of fx.sis.students.filter((x) => x.sectionId === sectionId(k))) {
        marks.push({ id: `e2e_am_prev_${k}_${d}_${s.id}`, register_id: rid, tenant_id: tenant, student_id: s.id, status: "A", note: "" });
      }
    }
  }
  await db.insert("attendance_desk_registers", registers);
  await db.insert("attendance_desk_marks", marks);

  // Fee open dues (the cache the summary reads first): most children carry
  // rows; every 5th child carries none, so the summary computes for them.
  const dues: Record<string, unknown>[] = [];
  current.forEach((s, i) => {
    if (i % 5 === 0) return;
    dues.push(
      { tenant_id: tenant, student_id: s.id, academic_year_code: AY_CURRENT, due_key: `e2e:${s.id}:a`, household_id: s.householdId, kind: "academic", label: "Tuition · Sep", due_on: "2026-09-10", billed_paise: 150000, concession_paise: 0, balance_paise: 100000 + i * 100 },
      { tenant_id: tenant, student_id: s.id, academic_year_code: AY_CURRENT, due_key: `e2e:${s.id}:b`, household_id: s.householdId, kind: "transport", label: "Transport · Sep", due_on: "2026-09-10", billed_paise: 50000, concession_paise: 0, balance_paise: i % 3 === 0 ? 0 : 50000 },
      { tenant_id: tenant, student_id: s.id, academic_year_code: "2025-26", due_key: `e2e:${s.id}:old`, household_id: s.householdId, kind: "academic", label: "Old", due_on: "2026-01-10", billed_paise: 70000, concession_paise: 0, balance_paise: 70000 },
    );
  });
  await db.insert("fee_desk_open_dues", dues);

  return { popups: popups.length, events: events.length, registers: registers.length, marks: marks.length, openDues: dues.length };
}

/** Removes everything seedParentApiData wrote (and nothing else). */
export async function cleanupParentApiData(): Promise<void> {
  const db = rest();
  const tenant = await tenantId();
  await db.remove(`attendance_desk_registers?tenant_id=eq.${tenant}&id=like.e2e_ar_*`);
  await db.remove(`attendance_desk_marks?tenant_id=eq.${tenant}&id=like.e2e_am_*`);
  await db.remove(`fee_desk_open_dues?tenant_id=eq.${tenant}&due_key=like.e2e:*`);
  await db.remove(`app_popup_events?tenant_id=eq.${tenant}&popup_id=like.e2e_pop_*`);
  const state = (await db.select(`module_local_state?tenant_id=eq.${tenant}&module_key=eq.app_popups&select=state`)) as { state: { popups?: { id?: string }[] } }[];
  const mine = (state[0]?.state?.popups ?? []).every((p) => String(p.id ?? "").startsWith("e2e_pop_"));
  if (state.length && mine) await db.remove(`module_local_state?tenant_id=eq.${tenant}&module_key=eq.app_popups`);
  await db.remove(`parent_app_presence?tenant_id=eq.${tenant}&household_id=like.e2e_hh_*`);
}

/** The fixture's families, each with all of its student rows (every year, any status). */
export function fixtureFamilies(): { householdId: string; guardianName: string; studentIds: string[] }[] {
  const fx = buildFixture();
  return fx.sis.households.map((h) => ({
    householdId: h.id,
    guardianName: h.guardianName,
    studentIds: fx.sis.students.filter((s) => s.householdId === h.id).map((s) => s.id),
  }));
}

// ── Database-level failures (R6), on the local stack only ────────────────

/** psql against the stack's own Postgres (state dir from e2e-stack.sh). */
export function stackPsql(stateDir: string, sql: string): string {
  assertLocalStack();
  const pgbin = readFileSync(join(stateDir, "pgbin"), "utf8").trim();
  const port = readFileSync(join(stateDir, "pg_port"), "utf8").trim();
  return execFileSync(join(pgbin, "psql"), ["-X", "-q", "-At", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  });
}

/**
 * Runs `fn` while the app's service role cannot read `table` — a real
 * failed read through PostgREST (42501), not a mock — and puts the grant
 * back afterwards, whatever happens.
 */
export async function withUnreadableTable<T>(stateDir: string, table: string, fn: () => Promise<T>): Promise<T> {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`bad table name ${table}`);
  const had = stackPsql(stateDir, `select has_table_privilege('service_role', 'public.${table}', 'select')`).trim() === "t";
  stackPsql(stateDir, `revoke select on public.${table} from service_role; notify pgrst, 'reload schema';`);
  try {
    return await fn();
  } finally {
    if (had) stackPsql(stateDir, `grant select on public.${table} to service_role; notify pgrst, 'reload schema';`);
  }
}

/** The app's log lines with `"event":"route-timing"` for `route`, parsed. */
export function timingLines(appLog: string, route: string): Record<string, unknown>[] {
  return readFileSync(appLog, "utf8")
    .split("\n")
    .filter((l) => l.includes('"event":"route-timing"'))
    .map((l) => {
      try {
        return JSON.parse(l.slice(l.indexOf("{"))) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter((j) => j.route === route);
}
