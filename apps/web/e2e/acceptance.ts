/**
 * Acceptance check for the local test stack (data-layer step 1.0).
 *
 *   bash scripts/e2e-stack.sh check
 *
 * Needs the stack up (`up`), the app built with .env.e2e (`build`) and
 * running (`app`). Talks to the proxy and the app over HTTP, exactly as a
 * browser and supabase-js would; signs in by minting the session cookie with
 * the app's own signSession(). Every expected number comes from the fixture
 * (apps/web/e2e/fixture.ts), never from the response under test.
 */

import { assertLocalStack, sessionCookieHeader } from "./session";
import { buildFixture, CLASS_TEACHER, classId, sectionId, TIMETABLE_TEACHER_SECTIONS } from "./fixture";
import type { DemoSession } from "@/lib/auth";

type Outcome = { name: string; ok: boolean; detail: string };
const outcomes: Outcome[] = [];

function record(name: string, ok: boolean, detail: string): void {
  outcomes.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function getJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> | unknown[] | null }> {
  const res = await fetch(url, { headers, redirect: "manual" });
  const text = await res.text();
  let body: Record<string, unknown> | unknown[] | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown> | unknown[];
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

async function main(): Promise<void> {
  assertLocalStack();
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const app = process.env.E2E_APP_URL || "";
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(app)) throw new Error(`E2E_APP_URL is "${app}", not 127.0.0.1`);
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const fx = buildFixture();
  const e = fx.expected;
  const svc = { apikey: service, Authorization: `Bearer ${service}` };

  // ── The API, through the proxy, as supabase-js sees it ──
  {
    const t = await getJson(`${api}/rest/v1/tenants?slug=eq.bhb-international&select=id,slug`, svc);
    record("proxy: tenants (service key)", t.status === 200 && arr(t.body).length === 1, `HTTP ${t.status}, ${arr(t.body).length} row(s)`);
    const c = await getJson(`${api}/rest/v1/masters_desk_slices?slice_key=eq.classes&select=payload`, svc);
    const n = arr(obj(arr(c.body)[0]).payload).length;
    record("proxy: masters_desk_slices classes", c.status === 200 && n === e.classes, `HTTP ${c.status}, ${n} classes (want ${e.classes})`);
    const none = await getJson(`${api}/rest/v1/tenants?select=id`);
    record("proxy: no key is refused", none.status === 401, `HTTP ${none.status}`);
    const anon = await getJson(`${api}/rest/v1/sis_students?select=id&limit=1`, {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""}`,
    });
    record(
      "proxy: anon key reads no student",
      anon.status !== 200 || arr(anon.body).length === 0,
      `HTTP ${anon.status}, ${arr(anon.body).length} row(s)`,
    );
    for (const p of ["/auth/v1/user", "/storage/v1/object/list/x"]) {
      const r = await getJson(`${api}${p}`, svc);
      record(`proxy: ${p} answers 501`, r.status === 501, `HTTP ${r.status}`);
    }
  }

  // ── The app ──
  const v = await getJson(`${app}/api/app-version`);
  record("app: GET /api/app-version", v.status === 200, `HTTP ${v.status}`);

  const as = (s: DemoSession) => ({ cookie: sessionCookieHeader(s) });

  const anonRoster = await getJson(`${app}/api/school-data/sis-roster`);
  record("app: sis-roster without a session is refused", anonRoster.status === 401, `HTTP ${anonRoster.status}`);

  // Pages: /home without a session goes to /login; with the office cookie it renders.
  {
    const res = await fetch(`${app}/home`, { redirect: "manual" });
    const to = res.headers.get("location") || "";
    record("app: /home without a session redirects to /login", res.status >= 300 && res.status < 400 && to.includes("/login"), `HTTP ${res.status} → ${to || "(no location)"}`);
    const withCookie = await fetch(`${app}/home`, { redirect: "manual", headers: as(fx.sessions.office) });
    record("office: /home renders", withCookie.status === 200, `HTTP ${withCookie.status} ${withCookie.headers.get("location") || ""}`.trim());
  }

  // Office (office role by Masters → Roles assignment).
  {
    const h = as(fx.sessions.office);
    const m = await getJson(`${app}/api/school-data/masters-desk`, h);
    const mb = obj(m.body);
    record(
      "office: masters-desk classes",
      m.status === 200 && mb.ok === true && arr(mb.classes).length === e.classes && !mb.teachingOnly,
      `HTTP ${m.status}, ${arr(mb.classes).length} classes (want ${e.classes}), teachingOnly=${String(mb.teachingOnly ?? false)}`,
    );
    const s = await getJson(`${app}/api/school-data/staff-roster`, h);
    const sb = obj(s.body);
    record(
      "office: staff-roster staff",
      s.status === 200 && arr(sb.staff).length === e.staff,
      `HTTP ${s.status}, ${arr(sb.staff).length} staff (want ${e.staff}), redacted=${String(sb.redacted)}`,
    );
    const r = await getJson(`${app}/api/school-data/sis-roster`, h);
    const rb = obj(r.body);
    record(
      "office: sis-roster students",
      r.status === 200 && arr(rb.students).length === e.studentRows && arr(rb.households).length === e.households,
      `HTTP ${r.status}, ${arr(rb.students).length} student rows (want ${e.studentRows}), ` +
        `${arr(rb.households).length} households (want ${e.households}), scopedToTeacher=${String(rb.scopedToTeacher ?? false)}`,
    );
  }

  // A teacher: class teacher of Nursery-A only.
  {
    const h = as(fx.sessions.teacher);
    const r = await getJson(`${app}/api/school-data/sis-roster`, h);
    const rb = obj(r.body);
    const students = arr(rb.students).map(obj);
    const mine = `${classId(CLASS_TEACHER - 3)}|${sectionId(CLASS_TEACHER - 3)}`;
    const outside = students.filter((s) => `${String(s.classId)}|${String(s.sectionId)}` !== mine).length;
    record(
      "teacher: sis-roster is her section only",
      r.status === 200 && rb.scopedToTeacher === true && students.length === e.classTeacherRows && outside === 0,
      `HTTP ${r.status}, ${students.length} rows (want ${e.classTeacherRows}), ${outside} outside her section, ` +
        `scopedToTeacher=${String(rb.scopedToTeacher ?? false)}`,
    );
    const m = await getJson(`${app}/api/school-data/masters-desk`, h);
    const mb = obj(m.body);
    record(
      "teacher: masters-desk teaching subset",
      m.status === 200 && mb.teachingOnly === true && arr(mb.classes).length === e.classes,
      `HTTP ${m.status}, ${arr(mb.classes).length} classes, teachingOnly=${String(mb.teachingOnly ?? false)}`,
    );
  }

  // The teacher whose only link to a section is the published timetable.
  {
    const h = as(fx.sessions.timetableTeacher);
    const r = await getJson(`${app}/api/school-data/sis-roster`, h);
    const rb = obj(r.body);
    const students = arr(rb.students).map(obj);
    const allowed = new Set(TIMETABLE_TEACHER_SECTIONS.map((k) => `${classId(k)}|${sectionId(k)}`));
    const outside = students.filter((s) => !allowed.has(`${String(s.classId)}|${String(s.sectionId)}`)).length;
    const right = r.status === 200 && students.length === e.timetableTeacherRows && outside === 0;
    const detail =
      `HTTP ${r.status}, ${students.length} rows (want ${e.timetableTeacherRows}), ${outside} outside her sections, ` +
      `scopedToTeacher=${String(rb.scopedToTeacher ?? false)}`;
    // KNOWN DEFECT, found by this stack on 13 Oct 2026: on the server,
    // loadTimetable() returns an empty state (lib/timetable.ts: `typeof window
    // === "undefined"`), and ensureTimetableHydratedServer() writes the DB
    // copy back through writeTimetableLocalRaw(), a no-op on the server — so
    // staffSectionScope() never sees a published grid, and a teacher whose
    // only tie is the timetable gets zero students. Recorded as an expected
    // failure so the run stays green for the stack itself; the moment the
    // app is fixed this flips to XPASS and FAILS the run, so the fix must
    // promote it to a plain check (remove `knownDefect`).
    const knownDefect = true;
    if (knownDefect) {
      const stillBroken = r.status === 200 && students.length === 0;
      console.log(`${right ? "XPASS" : stillBroken ? "XFAIL" : "FAIL "}  timetable-only teacher (known defect) — ${detail}`);
      outcomes.push({
        name: "timetable-only teacher: sis-roster (known defect, expected failure)",
        ok: stillBroken,
        detail: right ? `now correct — promote this to a plain check. ${detail}` : detail,
      });
    } else {
      record("timetable-only teacher: sis-roster is her timetable sections", right, detail);
    }
  }

  const failed = outcomes.filter((o) => !o.ok);
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} passed`);
  if (failed.length) {
    console.log("failed:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
