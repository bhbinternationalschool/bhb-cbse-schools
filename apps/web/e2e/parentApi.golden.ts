/**
 * Golden comparison for data-layer 4.1a–c: the OLD and the NEW parent-app
 * routes, answering the same requests against the same seeded local stack.
 *
 *   node ../../scripts/e2e/with-env.mjs .env.e2e -- npx tsx e2e/parentApi.golden.ts seed
 *   (start the old build — origin/main — and this build, both on the stack)
 *   node ../../scripts/e2e/with-env.mjs .env.e2e -- npx tsx e2e/parentApi.golden.ts compare <oldUrl> <newUrl>
 *   node ../../scripts/e2e/with-env.mjs .env.e2e -- npx tsx e2e/parentApi.golden.ts timing <url> [label]
 *   node ../../scripts/e2e/with-env.mjs .env.e2e -- npx tsx e2e/parentApi.golden.ts cleanup
 *
 * `compare`, for every fixture family (the all-inactive family, the
 * 0000000000 families, children with 2–4 per-year rows and blank-year rows,
 * the duplicate admission number included), as that family's parent:
 *  - GET /api/v1/app/popups
 *  - GET /api/v1/parent/summary
 *  - GET /api/v1/parent/attendance?studentId=<every row of the family>&days=90 and &days=366
 * and as the office (staff): popups, summary?householdId=<each family>,
 * attendance for every row; and the refusals: another family's child, another
 * family's summary, no studentId, no householdId. Each pair must have the
 * same status and the same body, byte for byte (the text, not only the
 * parsed value — the Flutter app's parser sees the text).
 *
 * `timing`: 20 warm-up then 200 timed requests per route, round-robin over
 * the families, sequential, from this process: p50 / p95 / max wall-clock.
 *
 * The old build has to be started after `seed` — its school mirror is cached
 * for up to 45 s.
 */

import { isDeepStrictEqual } from "node:util";
import { buildFixture } from "./fixture";
import {
  cleanupParentApiData,
  cookieFor,
  fixtureFamilies,
  get,
  localUrl,
  parentSession,
  pct,
  reporter,
  seedParentApiData,
} from "./parentApi.support";

type Probe = { name: string; path: string; headers: Record<string, string> };

function probes(): Probe[] {
  const fx = buildFixture();
  const families = fixtureFamilies();
  const office = cookieFor(fx.sessions.office);
  const out: Probe[] = [];
  families.forEach((f, i) => {
    const parent = cookieFor(parentSession(f.householdId, f.guardianName));
    out.push({ name: `parent ${f.householdId} popups`, path: "/api/v1/app/popups", headers: parent });
    out.push({ name: `parent ${f.householdId} summary`, path: "/api/v1/parent/summary", headers: parent });
    for (const sid of f.studentIds) {
      for (const days of [90, 366]) {
        out.push({ name: `parent ${f.householdId} attendance ${sid} ${days}d`, path: `/api/v1/parent/attendance?studentId=${sid}&days=${days}`, headers: parent });
      }
      out.push({ name: `office attendance ${sid}`, path: `/api/v1/parent/attendance?studentId=${sid}`, headers: office });
    }
    out.push({ name: `office summary ${f.householdId}`, path: `/api/v1/parent/summary?householdId=${f.householdId}`, headers: office });
    // Another family's data, asked for by this parent.
    const other = families[(i + 1) % families.length]!;
    out.push({ name: `parent ${f.householdId} → other family's summary`, path: `/api/v1/parent/summary?householdId=${other.householdId}`, headers: parent });
    if (other.studentIds[0]) {
      out.push({ name: `parent ${f.householdId} → other family's child attendance`, path: `/api/v1/parent/attendance?studentId=${other.studentIds[0]}`, headers: parent });
    }
  });
  out.push({ name: "office popups", path: "/api/v1/app/popups", headers: office });
  out.push({ name: "parent no studentId", path: "/api/v1/parent/attendance", headers: cookieFor(parentSession(families[0]!.householdId)) });
  out.push({ name: "parent unknown student", path: "/api/v1/parent/attendance?studentId=e2e_nobody", headers: cookieFor(parentSession(families[0]!.householdId)) });
  out.push({ name: "office summary without householdId", path: "/api/v1/parent/summary", headers: office });
  out.push({ name: "office summary unknown household", path: "/api/v1/parent/summary?householdId=e2e_hh_nobody", headers: office });
  out.push({ name: "no session popups", path: "/api/v1/app/popups", headers: {} });
  return out;
}

async function compare(oldUrl: string, newUrl: string): Promise<void> {
  const r = reporter();
  const list = probes();
  const byRoute = new Map<string, { same: number; differ: number }>();
  const statuses = new Map<string, number>();
  for (const p of list) {
    const [a, b] = await Promise.all([get(oldUrl + p.path, p.headers), get(newUrl + p.path, p.headers)]);
    const route = p.path.split("?")[0]!;
    const tally = byRoute.get(route) ?? { same: 0, differ: 0 };
    statuses.set(`${route} ${a.status}`, (statuses.get(`${route} ${a.status}`) ?? 0) + 1);
    const sameText = a.status === b.status && a.text === b.text;
    if (sameText) {
      tally.same += 1;
    } else {
      tally.differ += 1;
      const deep = a.status === b.status && isDeepStrictEqual(a.body, b.body);
      r.record(p.name, false, `old ${a.status} ${a.text.slice(0, 300)}\n      new ${b.status} ${b.text.slice(0, 300)}${deep ? "\n      (deep-equal, text differs: key order)" : ""}`);
    }
    byRoute.set(route, tally);
  }
  for (const [route, t] of byRoute) r.record(`${route}: old and new answer byte for byte`, t.differ === 0, `${t.same} identical, ${t.differ} different`);
  console.log("\nstatuses seen (old):", Object.fromEntries([...statuses].sort()));
  r.finish(`golden ${oldUrl} vs ${newUrl}`);
}

async function timing(url: string, label: string): Promise<void> {
  const families = fixtureFamilies().filter((f) => f.householdId !== "e2e_hh_inactive");
  const routes: { name: string; path: (f: (typeof families)[number]) => string }[] = [
    { name: "app/popups", path: () => "/api/v1/app/popups" },
    { name: "parent/attendance", path: (f) => `/api/v1/parent/attendance?studentId=${f.studentIds[0]}` },
    { name: "parent/summary", path: () => "/api/v1/parent/summary" },
  ];
  for (const route of routes) {
    const ms: number[] = [];
    for (let i = 0; i < 220; i++) {
      const f = families[i % families.length]!;
      const res = await get(url + route.path(f), cookieFor(parentSession(f.householdId, f.guardianName)));
      if (res.status !== 200) throw new Error(`${route.name} ${f.householdId}: ${res.status} ${res.text.slice(0, 200)}`);
      if (i >= 20) ms.push(res.ms);
    }
    console.log(
      `TIMING ${label} ${route.name}: n=${ms.length} p50=${pct(ms, 50).toFixed(1)} ms p95=${pct(ms, 95).toFixed(1)} ms max=${Math.max(...ms).toFixed(1)} ms`,
    );
  }
}

async function main(): Promise<void> {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "seed") {
    console.log("seeded", await seedParentApiData());
  } else if (cmd === "cleanup") {
    await cleanupParentApiData();
    console.log("cleaned up");
  } else if (cmd === "compare") {
    await compare(localUrl("old url", a), localUrl("new url", b));
  } else if (cmd === "timing") {
    await timing(localUrl("url", a), b || "run");
  } else {
    throw new Error("usage: parentApi.golden.ts seed | compare <oldUrl> <newUrl> | timing <url> [label] | cleanup");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
