/**
 * Acceptance check for data-layer 4.1c — GET /api/v1/parent/summary — on the
 * local stack (run by `bash scripts/e2e-stack.sh check` with the stack's state
 * dir as argument 1; the app's log is <state>/app.log).
 *
 *  1. Every fixture family's parent gets its own household: the children are
 *     exactly its children on roll (one per admission number, this year's
 *     row preferred — counted here from the fixture), each with the class and
 *     section names Masters holds, and a child whose this-year open-dues rows
 *     exist shows their sum (counted independently with SQL); no other
 *     family's child is named anywhere in the body. The all-inactive family
 *     is refused (403 family_inactive).
 *  2. Another family's summary is refused (403) for every family; the office
 *     reads any family with ?householdId=; no id is 400; unknown is 404.
 *  3. R6: with sis_households — or sis_students — unreadable (service role's
 *     SELECT revoked) the answer is 503, not "Household not found" or a
 *     family with no children.
 *  4. One `route-timing` log line per request with auth/query/build ms and
 *     whether the fee calculation had to run (`computed`).
 *  5. p95 < 300 ms over 200 warm sequential requests for families whose
 *     children all have open-dues rows (the step's target). Families with a
 *     child without rows still run the whole-desk fee calculation (see the
 *     route); their p95 is reported, not gated.
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

const ROUTE = "/api/v1/parent/summary";

async function main(): Promise<void> {
  const stateDir = process.argv[2] || "";
  if (!stateDir) throw new Error("usage: v1-parent-summary.acceptance.ts <e2e state dir>");
  const appLog = join(stateDir, "app.log");
  const app = localUrl("E2E_APP_URL", process.env.E2E_APP_URL);
  const r = reporter();
  const fx = buildFixture();
  const families = fixtureFamilies();
  const className = new Map(fx.masters.classes.map((c) => [c.id, c.name]));
  const sectionName = new Map(fx.masters.sections.map((s) => [s.id, s.name]));

  const logStart = logOffset(appLog);
  await seedParentApiData();
  try {
    const dueSum = new Map<string, number>();
    for (const line of stackPsql(
      stateDir,
      `select student_id || '|' || sum(balance_paise) from fee_desk_open_dues where academic_year_code = '${AY_CURRENT}' and balance_paise > 0 group by student_id`,
    )
      .trim()
      .split("\n")
      .filter(Boolean)) {
      const [sid, sum] = line.split("|");
      dueSum.set(sid!, Number(sum));
    }

    // 1. Every family.
    const wrong: string[] = [];
    const cachedOnly: string[] = [];
    const withCompute: string[] = [];
    for (const f of families) {
      const res = await get(app + ROUTE, cookieFor(parentSession(f.householdId, f.guardianName)));
      if (f.householdId === "e2e_hh_inactive") {
        r.record("all-inactive family refused", res.status === 403 && obj(obj(res.body).error).code === "family_inactive", String(res.status));
        continue;
      }
      const d = obj(obj(res.body).data);
      const rows = fx.sis.students.filter((s) => s.householdId === f.householdId && s.status === "active");
      const byAdm = new Map<string, (typeof rows)[number]>();
      for (const s of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
        const prev = byAdm.get(s.admissionNo || s.id);
        if (!prev || s.academicYearCode === AY_CURRENT || (prev.academicYearCode !== AY_CURRENT && s.academicYearCode > prev.academicYearCode)) {
          byAdm.set(s.admissionNo || s.id, s);
        }
      }
      const want = [...byAdm.values()];
      const kids = arr(d.children).map(obj);
      const problems: string[] = [];
      if (res.status !== 200) problems.push(`status ${res.status}`);
      if (d.householdId !== f.householdId) problems.push("householdId");
      if (kids.map((k) => k.id).join(",") !== want.map((s) => s.id).join(",")) problems.push(`children ${kids.map((k) => k.id).join(",")}`);
      for (const k of kids) {
        const s = want.find((x) => x.id === k.id);
        if (!s) continue;
        if (k.className !== (className.get(s.classId) || "") || k.sectionName !== (sectionName.get(s.sectionId) || "")) problems.push(`names ${s.id}`);
        if (dueSum.has(s.id) && k.openBalancePaise !== dueSum.get(s.id)) problems.push(`balance ${s.id} ${String(k.openBalancePaise)} want ${dueSum.get(s.id)}`);
      }
      const total = kids.reduce((n, k) => n + Number(k.openBalancePaise), 0);
      if (d.totalOpenBalancePaise !== total) problems.push("total");
      for (const s of fx.sis.students) {
        if (s.householdId === f.householdId) continue;
        if (res.text.includes(`"${s.id}"`) || res.text.includes(`"${s.fullName}"`)) problems.push(`names other family's ${s.id}`);
      }
      if (problems.length) wrong.push(`${f.householdId}: ${problems.join(", ")}`);
      (want.every((s) => dueSum.has(s.id)) ? cachedOnly : withCompute).push(f.householdId);
    }
    r.record(
      "every family: its own children on roll, class/section names, cached balances, total; nobody else",
      wrong.length === 0,
      `${families.length - 1} families (${cachedOnly.length} all cached, ${withCompute.length} computed)${wrong.length ? `; ${wrong.slice(0, 4).join("; ")}` : ""}`,
    );

    // 2. Refusals and the office.
    const leaks: string[] = [];
    for (let i = 0; i < families.length; i++) {
      const f = families[i]!;
      if (f.householdId === "e2e_hh_inactive") continue;
      const other = families[(i + 1) % families.length]!;
      const res = await get(`${app}${ROUTE}?householdId=${other.householdId}`, cookieFor(parentSession(f.householdId)));
      if (res.status !== 403 || res.text.includes(other.householdId)) leaks.push(`${f.householdId} → ${other.householdId}: ${res.status}`);
    }
    r.record("a parent never reads another family's summary (403)", leaks.length === 0, leaks.slice(0, 5).join("; ") || `${families.length - 1} families`);
    const office = cookieFor(fx.sessions.office);
    const officeRead = await get(`${app}${ROUTE}?householdId=e2e_hh_002`, office);
    const noId = await get(app + ROUTE, office);
    const unknown = await get(`${app}${ROUTE}?householdId=e2e_hh_nobody`, office);
    r.record(
      "office: any family by id; no id 400; unknown 404",
      officeRead.status === 200 && obj(obj(officeRead.body).data).householdId === "e2e_hh_002" && noId.status === 400 && unknown.status === 404,
      `${officeRead.status} ${noId.status} ${unknown.status}`,
    );

    // 3. R6.
    const p1 = cookieFor(parentSession(cachedOnly[0]!));
    const noHh = await withUnreadableTable(stateDir, "sis_households", () => get(app + ROUTE, p1));
    r.record("sis_households unreadable → 503 (not 'Household not found')", noHh.status === 503, `${noHh.status} ${noHh.text.slice(0, 160)}`);
    const noKids = await withUnreadableTable(stateDir, "sis_students", () => get(app + ROUTE, p1));
    r.record("sis_students unreadable → 503 (not a family with no children)", noKids.status === 503, `${noKids.status} ${noKids.text.slice(0, 160)}`);
    const back = await get(app + ROUTE, p1);
    r.record("reads recover once the tables are readable again", back.status === 200, String(back.status));

    // 5. p95.
    const timed = async (ids: string[]) => {
      const ms: number[] = [];
      for (let i = 0; i < 220; i++) {
        const hh = ids[i % ids.length]!;
        const res = await get(app + ROUTE, cookieFor(parentSession(hh)));
        if (i >= 20) ms.push(res.ms);
      }
      return ms;
    };
    const fast = await timed(cachedOnly);
    const p95 = pct(fast, 95);
    r.record(
      "p95 < 300 ms, families whose children all have open-dues rows (200 warm sequential requests)",
      p95 < 300,
      `p50 ${pct(fast, 50).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${Math.max(...fast).toFixed(1)} ms`,
    );
    const slow = await timed(withCompute);
    console.log(
      `INFO  families with a child the fee calculation runs for (whole-desk path, not gated): p50 ${pct(slow, 50).toFixed(1)} ms, p95 ${pct(slow, 95).toFixed(1)} ms, max ${Math.max(...slow).toFixed(1)} ms`,
    );

    // 4. Timing lines.
    await new Promise((res) => setTimeout(res, 300));
    const lines = timingLines(appLog, "v1/parent/summary", logStart);
    const ok = lines.filter((l) => l.status === 200 && ["authMs", "queryMs", "buildMs", "totalMs"].every((k) => typeof l[k] === "number"));
    r.record(
      "one route-timing line per request (auth/query/build ms, computed), refusals and 503s included",
      ok.length >= 400 && ok.some((l) => l.computed === true) && ok.some((l) => l.computed === false) && lines.some((l) => l.status === 503) && lines.some((l) => l.status === 403),
      `${lines.length} lines; server-side p95 auth ${pct(ok.map((l) => Number(l.authMs)), 95)} / query ${pct(ok.map((l) => Number(l.queryMs)), 95)} / build ${pct(ok.map((l) => Number(l.buildMs)), 95)} ms`,
    );
  } finally {
    await cleanupParentApiData();
  }
  r.finish("4.1c parent/summary");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
