/**
 * Run: npx tsx src/lib/waDeliveryLog.selftest.ts
 *
 * Exercises only parseMetaStatusUpdates(), the pure body-parsing logic.
 * recordDeliveryStatuses() needs a live Supabase service-role client, so
 * it's excluded here and verified live against the real webhook instead.
 */
import assert from "node:assert/strict";

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

console.log("OK — waDeliveryLog.selftest.ts");
