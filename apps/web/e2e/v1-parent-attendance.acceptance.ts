/**
 * Acceptance check for data-layer 4.1b — GET /api/v1/parent/attendance — on
 * the local stack (run by `bash scripts/e2e-stack.sh check` with the stack's
 * state dir as argument 1; the app's log is <state>/app.log).
 *
 *  1. For every student row of every fixture family (every year, blank-year
 *     rows, inactive rows) the family's parent gets exactly the marks the
 *     database holds for that child in that child's section and the
 *     session's year since the window start — counted independently with
 *     SQL (psql), at 90 and 366 days — newest first.
 *  2. A parent asking for another family's child is refused (403) for every
 *     family, and the answer names nobody; the all-inactive family is refused
 *     (403 family_inactive); an unknown id is 404; no id is 400.
 *  3. R6: with attendance_desk_marks — or sis_students — unreadable (service
 *     role's SELECT revoked) the answer is 503, not a 200 with no marks.
 *  4. One `route-timing` log line per request with auth/query/build ms.
 *  5. p95 < 150 ms over 200 warm sequential requests (the step's target).
 * Everything seeded is removed at the end.
 */

import { join } from "node:path";
import { AY_CURRENT, buildFixture } from "./fixture";
import {
  arr,
  cleanupParentApiData,
  cookieFor,
  fixtureFamilies,
  get,
  istDay,
  localUrl,
  obj,
  parentSession,
  logOffset,
  pct,
  reporter,
  seedParentApiData,
  stackPsql,
  timingLines,
  withUnreadableTable,
} from "./parentApi.support";

const ROUTE = "/api/v1/parent/attendance";

async function main(): Promise<void> {
  const stateDir = process.argv[2] || "";
  if (!stateDir) throw new Error("usage: v1-parent-attendance.acceptance.ts <e2e state dir>");
  const appLog = join(stateDir, "app.log");
  const app = localUrl("E2E_APP_URL", process.env.E2E_APP_URL);
  const r = reporter();
  const fx = buildFixture();
  const families = fixtureFamilies();
  const student = new Map(fx.sis.students.map((s) => [s.id, s]));

  const logStart = logOffset(appLog);
  await seedParentApiData();
  try {
    // 1. Every row of every family, against SQL counted on its own.
    const wrong: string[] = [];
    let checked = 0;
    let withMarks = 0;
    for (const f of families) {
      if (f.householdId === "e2e_hh_inactive") continue;
      const parent = cookieFor(parentSession(f.householdId, f.guardianName));
      for (const sid of f.studentIds) {
        const s = student.get(sid)!;
        for (const days of [90, 366]) {
          const res = await get(`${app}${ROUTE}?studentId=${sid}&days=${days}`, parent);
          const d = obj(obj(res.body).data);
          const since = String(d.sinceDate);
          const want = stackPsql(
            stateDir,
            `select coalesce(string_agg(r.attendance_date::text || ':' || m.status, ',' order by r.attendance_date desc), '')
               from attendance_desk_marks m join attendance_desk_registers r on r.id = m.register_id
              where m.student_id = '${sid}' and r.section_id = '${s.sectionId}' and r.academic_year_code = '${AY_CURRENT}'
                and r.attendance_date >= '${since}'`,
          ).trim();
          const got = arr(d.entries).map((e) => `${String(obj(e).date)}:${String(obj(e).status)}`).join(",");
          checked += 1;
          if (got) withMarks += 1;
          const counts =
            Number(d.markedDays) === arr(d.entries).length &&
            Number(d.presentDays) === arr(d.entries).filter((e) => obj(e).status === "P").length &&
            Number(d.absentDays) === arr(d.entries).filter((e) => obj(e).status === "A").length &&
            Number(d.lateDays) === arr(d.entries).filter((e) => obj(e).status === "L").length;
          if (res.status !== 200 || got !== want || !counts || d.studentId !== sid || d.academicYearCode !== AY_CURRENT || since !== istDay(days)) {
            wrong.push(`${sid} ${days}d: ${res.status} got ${got.slice(0, 60)} want ${want.slice(0, 60)}`);
          }
        }
      }
    }
    r.record(
      "every child's marks = the database's, for its section and this year, newest first",
      wrong.length === 0 && withMarks > 100,
      `${checked} answers (${withMarks} with marks)${wrong.length ? `; ${wrong.slice(0, 4).join("; ")}` : ""}`,
    );

    // 2. Refusals.
    const leaks: string[] = [];
    for (let i = 0; i < families.length; i++) {
      const f = families[i]!;
      if (f.householdId === "e2e_hh_inactive") continue;
      const other = families[(i + 1) % families.length]!;
      for (const sid of other.studentIds.slice(0, 2)) {
        const res = await get(`${app}${ROUTE}?studentId=${sid}`, cookieFor(parentSession(f.householdId)));
        const name = student.get(sid)!.fullName;
        if (res.status !== 403 || res.text.includes(name)) leaks.push(`${f.householdId} → ${sid}: ${res.status}`);
      }
    }
    r.record("a parent never reads another family's child (403, no name)", leaks.length === 0, leaks.slice(0, 5).join("; ") || `${families.length - 1} families`);
    const inactive = await get(`${app}${ROUTE}?studentId=e2e_stu_9001`, cookieFor(parentSession("e2e_hh_inactive")));
    r.record("all-inactive family refused", inactive.status === 403 && obj(obj(inactive.body).error).code === "family_inactive", String(inactive.status));
    const p1 = cookieFor(parentSession("e2e_hh_001"));
    const unknown = await get(`${app}${ROUTE}?studentId=e2e_nobody`, p1);
    const none = await get(`${app}${ROUTE}`, p1);
    r.record("unknown child 404, no child 400", unknown.status === 404 && none.status === 400, `${unknown.status} ${none.status}`);

    // 3. R6.
    const sid = families.find((f) => f.householdId === "e2e_hh_001")!.studentIds[0]!;
    const noMarks = await withUnreadableTable(stateDir, "attendance_desk_marks", () => get(`${app}${ROUTE}?studentId=${sid}`, p1));
    r.record("attendance_desk_marks unreadable → 503 (not a 200 with no marks)", noMarks.status === 503, `${noMarks.status} ${noMarks.text.slice(0, 160)}`);
    const noSis = await withUnreadableTable(stateDir, "sis_students", () => get(`${app}${ROUTE}?studentId=${sid}`, p1));
    r.record("sis_students unreadable → 503 (not 'Student not found' or a stale copy)", noSis.status === 503, `${noSis.status} ${noSis.text.slice(0, 160)}`);
    const back = await get(`${app}${ROUTE}?studentId=${sid}`, p1);
    r.record("reads recover once the tables are readable again", back.status === 200, String(back.status));

    // 5. p95.
    const live = families.filter((f) => f.householdId !== "e2e_hh_inactive");
    const ms: number[] = [];
    for (let i = 0; i < 220; i++) {
      const f = live[i % live.length]!;
      const res = await get(`${app}${ROUTE}?studentId=${f.studentIds[0]}`, cookieFor(parentSession(f.householdId)));
      if (i >= 20) ms.push(res.ms);
    }
    const p95 = pct(ms, 95);
    r.record("p95 < 150 ms (200 warm sequential requests across families)", p95 < 150, `p50 ${pct(ms, 50).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${Math.max(...ms).toFixed(1)} ms`);

    // 4. Timing lines.
    await new Promise((res) => setTimeout(res, 300));
    const lines = timingLines(appLog, "v1/parent/attendance", logStart);
    const ok = lines.filter((l) => l.status === 200 && ["authMs", "queryMs", "buildMs", "totalMs"].every((k) => typeof l[k] === "number"));
    r.record(
      "one route-timing line per request (auth/query/build ms), refusals and 503s included",
      ok.length >= 200 && lines.some((l) => l.status === 503) && lines.some((l) => l.status === 403),
      `${lines.length} lines; server-side p95 auth ${pct(ok.map((l) => Number(l.authMs)), 95)} / query ${pct(ok.map((l) => Number(l.queryMs)), 95)} / build ${pct(ok.map((l) => Number(l.buildMs)), 95)} ms`,
    );
  } finally {
    await cleanupParentApiData();
  }
  r.finish("4.1b parent/attendance");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
