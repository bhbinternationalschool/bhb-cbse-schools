/**
 * The desk-hydrate metric from the query kernel (data-layer 2.3a,
 * lib/data/client/viewLoadMetric.ts): once per read name per page, timed from
 * the route's clock, and a failing reporter never breaks a read.
 *
 *   npx tsx src/lib/data/client/viewLoadMetric.selftest.ts
 */
import assert from "node:assert/strict";
import type { ClientMetric } from "@/lib/clientMetrics";
import { createViewLoadMetric } from "./viewLoadMetric";

let now = 0;
const sent: ClientMetric[] = [];
const m = createViewLoadMetric({ report: (x) => sent.push(x), now: () => now });

m.setRouteStart(100);
now = 350;
m.loaded("masters");
assert.deepEqual(sent, [{ event: "desk-hydrate", key: "masters", ms: 250 }], "first answer: reported, timed from the route's clock");

now = 900;
m.loaded("masters");
assert.equal(sent.length, 1, "the same read answering again (a refetch) is not reported again");

m.loaded("staff-list");
assert.deepEqual(sent[1], { event: "desk-hydrate", key: "staff-list", ms: 800 }, "another read: its own line");

m.setRouteStart(1_000);
now = 1_200;
m.loaded("rbac");
assert.deepEqual(sent[2], { event: "desk-hydrate", key: "rbac", ms: 200 }, "after a navigation the new route's clock is used");

m.loaded("");
assert.equal(sent.length, 3, "an unnamed read is not reported");

const throwing = createViewLoadMetric({ report: () => { throw new Error("beacon"); }, now: () => 5 });
assert.doesNotThrow(() => throwing.loaded("masters"), "a reporter that throws never breaks the read");

console.log("viewLoadMetric: all passed");
