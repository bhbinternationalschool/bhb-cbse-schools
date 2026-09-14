/**
 * Self-test: a browser that cannot cache the transport desk must not show it
 * empty, must not invent a fleet, and must not push either back.
 * Run: npx tsx apps/web/src/lib/transportPhoneEmptyDesk.selftest.ts
 *
 * Seen in production on 14 Sep 2026 on an iPhone: the desk (6 routes, 174
 * assignments) downloaded fine, the cache write was dropped for quota, the
 * page read the cache back as empty, seeded five vehicles and pushed them —
 * twelve refused POSTs in an hour, and a screen saying 0 routes / 0 riders
 * while the database held everything. PR #194's guards did not fire because a
 * five-vehicle desk is not all-empty.
 */

import assert from "node:assert/strict";

import type { TransportState } from "./transport";

/* ── A browser: localStorage with a byte ceiling, and the events the shell wires ── */
class FakeStorage {
  private map = new Map<string, string>();
  constructor(private capacity: number) {}
  get length() {
    return this.map.size;
  }
  private used(exceptKey?: string): number {
    let n = 0;
    for (const [k, v] of this.map) if (k !== exceptKey) n += k.length + v.length;
    return n;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.used(k) + k.length + v.length > this.capacity) {
      const err = new Error("QuotaExceededError: quota exceeded");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  clear(): void {
    this.map.clear();
  }
}

function install(capacity: number): FakeStorage {
  const store = new FakeStorage(capacity);
  const win = {
    localStorage: store,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    setTimeout,
    clearTimeout,
  };
  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.localStorage = store;
  g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };
  return store;
}

async function main() {
  // Installed BEFORE the module loads: transport.ts's dependencies read window
  // at import time.
  install(1_000_000);

  const { loadTransport, seedTransportIfEmpty, writeTransportLocalRaw } =
      await import("./transport");
  const {
    recordTransportDeskAnswer,
    resetTransportDeskAnswer,
    serverTransportDeskIsEmpty,
  } = await import("./transportHydrationState");
  const { whyDeskIsUnsendable } = await import("./transportNormalizedClient");

  console.log("transportPhoneEmptyDesk.selftest.ts");

  function deskWith(routes: number, vehicles: number, assignments: number): TransportState {
    const base = loadTransport();
    return {
      ...base,
      routes: Array.from({ length: routes }, (_, i) => ({
        id: `r${i}`,
        code: `R-${i}`,
        name: `Route ${i}`,
        vehicleId: "",
        stops: [],
        shifts: [],
        isActive: true,
      })) as unknown as TransportState["routes"],
      vehicles: Array.from({ length: vehicles }, (_, i) => ({
        id: `v${i}`,
        registrationNo: `UP65 AB ${1000 + i}`,
        seatCapacity: 0,
      })) as unknown as TransportState["vehicles"],
      assignments: Array.from({ length: assignments }, (_, i) => ({
        id: `a${i}`,
        studentId: `stu_${i}`,
        routeId: "r0",
        stopId: "",
        effectiveFrom: "2026-04-01",
        effectiveTo: "",
      })) as unknown as TransportState["assignments"],
    };
  }

  /* ── Unknown is not empty: before the server answers, nothing is seeded ── */
  {
    const store = install(1_000_000);
    resetTransportDeskAnswer();
    assert.equal(serverTransportDeskIsEmpty(), null);

    const out = seedTransportIfEmpty();
    assert.equal(out.vehicles.length, 0, "no fleet may be invented before the server answers");
    assert.equal(out.routes.length, 0);
    assert.equal(
      store.getItem("bhb_transport_v2"),
      null,
      "and nothing was written, so nothing can be pushed",
    );
  }

  /* ── THE BUG: server holds data, the cache cannot hold it — the desk still reads back ── */
  {
    // Room for the meta and not much else: the desk write below will be dropped.
    const store = install(600);
    resetTransportDeskAnswer();
    recordTransportDeskAnswer({ routes: 6, vehicles: 6, assignments: 174 });
    assert.equal(serverTransportDeskIsEmpty(), false);

    const hydrated = deskWith(6, 6, 174);
    writeTransportLocalRaw(hydrated);
    assert.equal(
      store.getItem("bhb_transport_v2"),
      null,
      "precondition: the cache write really was dropped for quota",
    );

    const read = loadTransport();
    assert.equal(read.routes.length, 6, "a dropped cache must not read as no routes");
    assert.equal(read.assignments.length, 174, "…or as no riders");

    const seeded = seedTransportIfEmpty();
    assert.equal(seeded.routes.length, 6, "and the seed leaves a loaded desk alone");
    assert.equal(seeded.vehicles.length, 6, "no invented fleet on top of the real one");
  }

  /* ── Cache present and later evicted by another desk: memory still answers ── */
  {
    const store = install(1_000_000);
    resetTransportDeskAnswer();
    recordTransportDeskAnswer({ routes: 2, vehicles: 1, assignments: 3 });
    writeTransportLocalRaw(deskWith(2, 1, 3));
    assert.ok(store.getItem("bhb_transport_v2"), "precondition: cached");
    store.removeItem("bhb_transport_v2"); // evictUntilItFits making room for fees
    assert.equal(loadTransport().routes.length, 2, "eviction by another desk is not a deletion");
  }

  /* ── A genuinely new tenant still gets the starter fleet ── */
  {
    install(1_000_000);
    resetTransportDeskAnswer();
    recordTransportDeskAnswer({ routes: 0, vehicles: 0, assignments: 0 });
    assert.equal(serverTransportDeskIsEmpty(), true);
    // The memory copy from the previous section is module state; start clean.
    writeTransportLocalRaw(deskWith(0, 0, 0));
    const out = seedTransportIfEmpty();
    assert.ok(out.vehicles.length > 0, "when the server says empty, seeding is allowed");
  }

  /* ── The push guard: shapes a lost cache produces are refused ── */
  {
    const serverHas = { routeCount: 6, assignmentCount: 174 };
    const serverEmpty = { routeCount: 0, assignmentCount: 0 };

    assert.ok(
      whyDeskIsUnsendable(deskWith(0, 0, 0), serverEmpty),
      "all-empty is never sent (PR #194)",
    );
    assert.ok(
      whyDeskIsUnsendable(deskWith(0, 5, 0), serverHas),
      "vehicles-only against a server with routes is the 14 Sep shape and is refused",
    );
    assert.ok(
      whyDeskIsUnsendable(deskWith(6, 6, 0), serverHas),
      "routes without assignments while the server holds 174 is a lost cache, not a deletion",
    );
    assert.equal(
      whyDeskIsUnsendable(deskWith(0, 5, 0), serverEmpty),
      null,
      "a new tenant recording its first vehicles may push",
    );
    assert.equal(
      whyDeskIsUnsendable(deskWith(6, 6, 174), serverHas),
      null,
      "a full desk is sent",
    );
    assert.equal(
      whyDeskIsUnsendable(deskWith(6, 6, 170), serverHas),
      null,
      "fewer assignments than the server is not refused here — ending a rider keeps the row, and pruning is the server's call",
    );
  }

  console.log("ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
