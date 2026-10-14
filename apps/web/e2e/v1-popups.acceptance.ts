/**
 * Acceptance check for data-layer 4.1a — GET /api/v1/app/popups — on the
 * local stack (run by `bash scripts/e2e-stack.sh check` with the stack's state
 * dir as argument 1; the app's log is <state>/app.log).
 *
 *  1. Every fixture family's parent gets 200 and only its own children in
 *     the answer: every Aadhaar/documents target is one of the family's own
 *     on-roll children (or "father"/"mother"), and no other family's child
 *     is named anywhere in the body. The all-inactive family is refused
 *     (403 family_inactive) before anything is read.
 *  2. Staff get the staff pop-ups and no child targets.
 *  3. R6: with sis_students unreadable (service role's SELECT revoked) a
 *     parent gets 503, not a 200 with the child-less pop-ups; with
 *     module_local_state unreadable, 503, not `{popups: []}`.
 *  4. One `route-timing` log line per request with auth/query/build ms.
 *  5. p95 < 100 ms over 200 warm sequential requests (the step's target).
 * The pop-ups, events and other seeded rows are removed at the end.
 */

import { join } from "node:path";
import { buildFixture } from "./fixture";
import {
  arr,
  cleanupParentApiData,
  cookieFor,
  fixtureFamilies,
  get,
  localUrl,
  obj,
  parentSession,
  pct,
  reporter,
  seedParentApiData,
  timingLines,
  withUnreadableTable,
} from "./parentApi.support";

const ROUTE = "/api/v1/app/popups";

async function main(): Promise<void> {
  const stateDir = process.argv[2] || "";
  if (!stateDir) throw new Error("usage: v1-popups.acceptance.ts <e2e state dir>");
  const appLog = join(stateDir, "app.log");
  const app = localUrl("E2E_APP_URL", process.env.E2E_APP_URL);
  const r = reporter();
  const fx = buildFixture();
  const families = fixtureFamilies();
  const nameOf = new Map(fx.sis.students.map((s) => [s.id, s.fullName]));

  const seeded = await seedParentApiData();
  try {
    // 1. Isolation, every family.
    let checked = 0;
    let withTargets = 0;
    const leaks: string[] = [];
    for (const f of families) {
      const res = await get(app + ROUTE, cookieFor(parentSession(f.householdId, f.guardianName)));
      if (f.householdId === "e2e_hh_inactive") {
        const code = obj(obj(res.body).error).code;
        r.record("all-inactive family is refused before any read", res.status === 403 && code === "family_inactive", `${res.status} ${String(code)}`);
        continue;
      }
      if (res.status !== 200) {
        leaks.push(`${f.householdId}: status ${res.status}`);
        continue;
      }
      checked += 1;
      const own = new Set(f.studentIds);
      const ownNames = new Set(f.studentIds.map((id) => nameOf.get(id)));
      for (const p of arr(obj(obj(res.body).data).popups)) {
        for (const t of arr(obj(p).targets)) {
          const key = String(obj(t).key);
          withTargets += 1;
          if (key !== "father" && key !== "mother" && !own.has(key)) leaks.push(`${f.householdId}: target ${key}`);
        }
      }
      for (const s of fx.sis.students) {
        if (own.has(s.id) || ownNames.has(s.fullName)) continue;
        if (res.text.includes(s.id) || res.text.includes(`"${s.fullName}"`)) leaks.push(`${f.householdId}: names ${s.id}`);
      }
    }
    r.record(
      "every family sees only its own children",
      leaks.length === 0 && checked === families.length - 1 && withTargets > 0,
      `${checked} families, ${withTargets} child targets checked${leaks.length ? `; ${leaks.slice(0, 5).join("; ")}` : ""}`,
    );

    // A family with children on roll this year gets the pop-ups meant for parents.
    const sample = families.find((f) => f.householdId === "e2e_hh_001")!;
    const one = await get(app + ROUTE, cookieFor(parentSession(sample.householdId)));
    const ids = arr(obj(obj(one.body).data).popups).map((p) => String(obj(p).id));
    r.record(
      "a family gets its pop-ups (rules, classes, consent) and none of staff/off/ended/future",
      one.status === 200 && ids.includes("e2e_pop_aadhaar") && !ids.some((i) => ["e2e_pop_staff", "e2e_pop_off", "e2e_pop_ended", "e2e_pop_future"].includes(i)),
      ids.join(","),
    );

    // 2. Staff.
    const staff = await get(app + ROUTE, cookieFor(fx.sessions.office));
    const staffPops = arr(obj(obj(staff.body).data).popups);
    r.record(
      "staff get the staff pop-up, with no child targets",
      staff.status === 200 && staffPops.some((p) => obj(p).id === "e2e_pop_staff") && staffPops.every((p) => arr(obj(p).targets).length === 0),
      `${staff.status} ${staffPops.map((p) => String(obj(p).id)).join(",")}`,
    );

    // 3. R6 — a failed read is a 503, never an empty answer.
    const parent = cookieFor(parentSession(sample.householdId));
    const noSis = await withUnreadableTable(stateDir, "sis_students", () => get(app + ROUTE, parent));
    r.record("sis_students unreadable → 503 (not the pop-ups of a family with no children)", noSis.status === 503, `${noSis.status} ${noSis.text.slice(0, 160)}`);
    const noState = await withUnreadableTable(stateDir, "module_local_state", () => get(app + ROUTE, parent));
    r.record("module_local_state unreadable → 503 (not {popups: []})", noState.status === 503, `${noState.status} ${noState.text.slice(0, 160)}`);
    const back = await get(app + ROUTE, parent);
    r.record("reads recover once the table is readable again", back.status === 200, String(back.status));

    // 5. p95 (before 4, so the log holds these lines too).
    const ms: number[] = [];
    const live = families.filter((f) => f.householdId !== "e2e_hh_inactive");
    for (let i = 0; i < 220; i++) {
      const f = live[i % live.length]!;
      const res = await get(app + ROUTE, cookieFor(parentSession(f.householdId)));
      if (i >= 20) ms.push(res.ms);
    }
    const p95 = pct(ms, 95);
    r.record("p95 < 100 ms (200 warm sequential requests across families)", p95 < 100, `p50 ${pct(ms, 50).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${Math.max(...ms).toFixed(1)} ms`);

    // 4. Timing lines.
    await new Promise((res) => setTimeout(res, 300));
    const lines = timingLines(appLog, "v1/app/popups");
    const ok = lines.filter((l) => l.status === 200 && ["authMs", "queryMs", "buildMs", "totalMs"].every((k) => typeof l[k] === "number"));
    const failed = lines.filter((l) => l.status === 503);
    const qp95 = pct(ok.map((l) => Number(l.queryMs)), 95);
    r.record(
      "one route-timing line per request (auth/query/build ms), 503s included",
      ok.length >= 200 && failed.length >= 2,
      `${ok.length} ok lines, ${failed.length} 503 lines; server-side p95 auth ${pct(ok.map((l) => Number(l.authMs)), 95)} / query ${qp95} / build ${pct(ok.map((l) => Number(l.buildMs)), 95)} ms`,
    );
    console.log("seeded:", seeded);
  } finally {
    await cleanupParentApiData();
  }
  r.finish("4.1a app/popups");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
