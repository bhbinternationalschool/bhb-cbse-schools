/**
 * Run: npx tsx src/lib/waDeliveryLog.selftest.ts
 *
 * Exercises only parseMetaStatusUpdates(), the pure body-parsing logic.
 * recordDeliveryStatuses() needs a live Supabase service-role client, so
 * it's excluded here and verified live against the real webhook instead.
 */
import assert from "node:assert/strict";
import {
  countStage,
  emptyTally,
  resolveRowStage,
} from "./waSentMessages";
import { stageLabel } from "./waDeliveryStatusShape";

import { parseMetaStatusUpdates } from "./waDeliveryLog.server";

console.log("waDeliveryLog.selftest.ts");

// --- a realistic Meta statuses payload extracts one event per status -----
{
  const body = {
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              statuses: [
                {
                  id: "wamid.ABC123",
                  status: "delivered",
                  timestamp: "1755000000",
                  recipient_id: "919876543210",
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const events = parseMetaStatusUpdates(body);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.waMessageId, "wamid.ABC123");
  assert.equal(events[0]!.status, "delivered");
  assert.equal(events[0]!.mobile, "919876543210");
  assert.equal(events[0]!.eventAt, new Date(1755000000 * 1000).toISOString());
}

// --- a failed status carries its error detail through ---------------------
{
  const body = {
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id: "wamid.FAIL1",
                  status: "failed",
                  timestamp: "1755000100",
                  recipient_id: "919876543210",
                  errors: [{ title: "Re-engagement message" }],
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const events = parseMetaStatusUpdates(body);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.status, "failed");
  assert.equal(events[0]!.errorMessage, "Re-engagement message");
}

// --- multiple entries/changes/statuses all get collected ------------------
{
  const body = {
    entry: [
      { changes: [{ value: { statuses: [{ id: "a", status: "sent" }] } }] },
      {
        changes: [
          { value: { statuses: [{ id: "b", status: "delivered" }, { id: "c", status: "read" }] } },
        ],
      },
    ],
  };
  const events = parseMetaStatusUpdates(body);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => e.waMessageId), ["a", "b", "c"]);
}

// --- inbound-message payloads (no statuses) yield nothing, not a crash ---
{
  const body = {
    entry: [{ changes: [{ value: { messages: [{ from: "919876543210", id: "wamid.X" }] } }] }],
  };
  assert.deepEqual(parseMetaStatusUpdates(body), []);
}

// --- malformed / empty bodies are handled without throwing ----------------
{
  assert.deepEqual(parseMetaStatusUpdates(null), []);
  assert.deepEqual(parseMetaStatusUpdates(undefined), []);
  assert.deepEqual(parseMetaStatusUpdates({}), []);
  assert.deepEqual(parseMetaStatusUpdates("not an object"), []);
}

// --- a status missing its id or status is skipped, not pushed as garbage -
{
  const body = {
    entry: [{ changes: [{ value: { statuses: [{ status: "delivered" }, { id: "wamid.OK" }] } }] }],
  };
  assert.deepEqual(parseMetaStatusUpdates(body), []);
}

// --- the sent-message log's own rules ------------------------------------
{
  // A send the school never managed to hand to Meta is Failed whatever the
  // webhooks say — there is no message for a tick to describe.
  assert.equal(resolveRowStage("failed", "read"), "failed");
  assert.equal(resolveRowStage("failed", "unknown"), "failed");

  // Handed over: the ladder decides, and "unknown" stays unknown rather than
  // being rounded down to "sent" (which would have the office chasing a
  // parent over a webhook that simply has not arrived).
  assert.equal(resolveRowStage("sent", "read"), "read");
  assert.equal(resolveRowStage("sent", "delivered"), "delivered");
  assert.equal(resolveRowStage("sent", "sent"), "sent");
  assert.equal(resolveRowStage("sent", "unknown"), "unknown");

  // A message Meta later reported as failed is Failed even though the
  // handoff succeeded — 5 of this school's 23 "sent" rows are exactly this.
  assert.equal(resolveRowStage("sent", "failed"), "failed");
}

// --- every rung is counted, and none is double-counted --------------------
{
  const t = emptyTally();
  for (const stage of [
    "read",
    "read",
    "delivered",
    "sent",
    "failed",
    "unknown",
  ] as const) {
    countStage(t, stage);
  }
  assert.deepEqual(t, {
    total: 6,
    read: 2,
    delivered: 1,
    sent: 1,
    failed: 1,
    unknown: 1,
  });
  assert.equal(
    t.read + t.delivered + t.sent + t.failed + t.unknown,
    t.total,
    "the rungs must add up to the total",
  );
}

// --- labels never overclaim ----------------------------------------------
{
  assert.equal(stageLabel("unknown"), "No update yet");
  assert.notEqual(stageLabel("unknown"), "Not delivered");
  assert.equal(stageLabel("read"), "Read");
  assert.equal(stageLabel("failed"), "Failed");
}

// --- Meta's pricing block is kept, and only when it is real ---------------
{
  const body = {
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id: "wamid.free",
                  status: "delivered",
                  timestamp: "1790900000",
                  recipient_id: "919876543210",
                  pricing: { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "UTILITY" },
                },
                {
                  id: "wamid.paid",
                  status: "sent",
                  timestamp: "1790900000",
                  pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" },
                },
                { id: "wamid.none", status: "failed", timestamp: "1790900000" },
                { id: "wamid.bad", status: "sent", pricing: { billable: "yes", category: "utility" } },
              ],
            },
          },
        ],
      },
    ],
  };
  const [free, paid, none, bad] = parseMetaStatusUpdates(body);
  assert.equal(free!.billable, false);
  assert.equal(free!.pricingCategory, "utility", "lower-cased");
  assert.equal(free!.pricingType, "free_customer_service");
  assert.equal(paid!.billable, true);
  assert.equal(paid!.pricingCategory, "marketing");
  assert.equal(none!.billable, undefined, "a failed message carries no pricing");
  assert.equal(bad!.billable, undefined, "a malformed flag is not read as charged or free");
  assert.equal(bad!.pricingCategory, undefined);
}

console.log("OK — waDeliveryLog.selftest.ts");
