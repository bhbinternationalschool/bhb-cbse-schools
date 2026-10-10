/**
 * Live check: the whole "where is my child's bus" chain, against production.
 *
 * child -> transport assignment -> vehicle -> last Fleet Edge fix -> verdict
 * -> the words a parent would actually receive. Reads only; sends nothing.
 *
 * `server-only` is aliased by Next and is not a real package, so tsx needs a
 * stub. From apps/web:
 *
 *   mkdir -p /tmp/so/server-only
 *   echo '{"name":"server-only","main":"index.js"}' > /tmp/so/server-only/package.json
 *   echo 'module.exports = {};' > /tmp/so/server-only/index.js
 *   NODE_PATH=/tmp/so npx tsx --env-file=.env.local scripts/parent-bus-live-check.ts
 */
import { busLocationReplyForHousehold } from "../src/lib/parentBusLocation.server";
import { ensureSchoolMirrorHydrated } from "../src/lib/schoolDataMirror.server";
import { currentAcademicYearCode, loadMasters } from "../src/lib/masters";
import { loadTransport } from "../src/lib/transport";

// Real ids from the transport desk: one child on a tracked route (Magic-1),
// one on a route with no tracker (City Bus).
const CASES = [
  { label: "tracked route (Magic-1), asked in English", children: [{ id: "stu_e40y9i8v", name: "Child A" }], text: "where is the bus" },
  { label: "tracked route (Magic-1), asked in Hindi", children: [{ id: "stu_e40y9i8v", name: "Child A" }], text: "बस कहाँ है" },
  { label: "no tracker (City Bus)", children: [{ id: "stu_z2sj0jst", name: "Child B" }], text: "bus kahan hai" },
  { label: "siblings on two different routes", children: [{ id: "stu_e40y9i8v", name: "Child A" }, { id: "stu_z2sj0jst", name: "Child B" }], text: "bus kahan hai" },
  { label: "child with no transport at all", children: [{ id: "stu_does_not_ride", name: "Child C" }], text: "where is the bus" },
];

async function main() {
  // Exactly what the webhook does before routing a message.
  await ensureSchoolMirrorHydrated();
  const ay = currentAcademicYearCode(loadMasters());
  // Browser state is empty on a server, which is the bug this feature had:
  // the desk must be read from transport_desk_slices, not from here.
  const browserState = loadTransport();
  console.log(
    `academicYear=${ay || "(none)"} · browser-state routes=${browserState.routes.length} (expected 0 on a server)`,
  );

  for (const c of CASES) {
    const r = await busLocationReplyForHousehold({ children: c.children, rawText: c.text });
    console.log(`\n═══ ${c.label}  [escalate=${r.escalate}]`);
    console.log(r.text);
  }
}

void main();
