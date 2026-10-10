/**
 * Run: npx tsx src/lib/waTransportTrack.selftest.ts
 *
 * This decides who gets to watch a school bus, and for how long. Every
 * assertion below is about the link NOT working when it should not.
 */
import assert from "node:assert/strict";
import {
  TRACK_GRACE_MINUTES,
  TRACK_MAX_TTL_MS,
  packTrackToken,
  trackLinkPath,
  trackLinkUrl,
  trackLinkWindow,
  trackRefusalText,
  unpackTrackToken,
} from "./waTransportTrack";
import { TRIP_WINDOWS_IST, inTripWindow } from "./fleetLivePosition";

console.log("waTransportTrack.selftest.ts");

/** An IST wall-clock time as an epoch. IST is UTC+5:30, no DST. */
function ist(hh: number, mm = 0): number {
  return Date.UTC(2026, 8, 10, hh, mm) - 330 * 60_000;
}

// --- a link is only issued while a bus is out --------------------------
{
  // 07:42 — the morning run, the hour these are actually sent.
  const morning = trackLinkWindow(ist(7, 42));
  assert.equal(morning.ok, true);
  if (!morning.ok) throw new Error("unreachable");
  assert.equal(morning.window, "morning");

  const afternoon = trackLinkWindow(ist(14, 5));
  assert.equal(afternoon.ok, true);

  // The times a bus is parked. A link handed out now would point at the
  // driver's home address.
  for (const [h, m] of [
    [4, 0],
    [5, 59],
    [10, 30],
    [11, 29],
    [16, 0],
    [19, 0],
    [23, 30],
  ] as const) {
    const w = trackLinkWindow(ist(h, m));
    assert.equal(w.ok, false, `${h}:${m} is not a run`);
    if (w.ok) throw new Error("unreachable");
    assert.equal(w.reason, "off-hours");
  }
}

// --- the link dies with the run, not after a fixed few hours -----------
{
  const morningEnd = TRIP_WINDOWS_IST[0]!.to; // 09:30 in IST minutes
  const at = ist(7, 42);
  const w = trackLinkWindow(at);
  if (!w.ok) throw new Error("expected a link inside the morning run");

  const expectedMinutes = morningEnd - (7 * 60 + 42) + TRACK_GRACE_MINUTES;
  assert.equal(
    w.expiresAtMs - at,
    expectedMinutes * 60_000,
    "expiry is the end of THIS run plus the overrun grace",
  );
  // 09:50 — past the run, inside nobody's window.
  assert.equal(inTripWindow(w.expiresAtMs), false);

  // A link issued a minute into the run still dies the same afternoon.
  const early = trackLinkWindow(ist(6, 1));
  if (!early.ok) throw new Error("unreachable");
  assert.ok(
    early.expiresAtMs - ist(6, 1) <= TRACK_MAX_TTL_MS,
    "nothing outlives the hard cap",
  );
}

// --- the last minute of a run still gets a usable link ----------------
{
  // 09:29 — an attendant marking the final child as the run ends. The link
  // must not be born already dead.
  const w = trackLinkWindow(ist(9, 29));
  assert.equal(w.ok, true);
  if (!w.ok) throw new Error("unreachable");
  assert.equal(
    w.expiresAtMs - ist(9, 29),
    (1 + TRACK_GRACE_MINUTES) * 60_000,
    "one minute of run left, plus the grace",
  );
}

// --- the token round-trips, and the URL puts it last ------------------
{
  const token = packTrackToken({ studentId: "stu_7f21", exp: 1789412400, sig: "k3Qw" });
  assert.equal(token, "stu_7f21.1789412400.k3Qw");

  const back = unpackTrackToken(token);
  assert.equal(back.ok, true);
  if (!back.ok) throw new Error("unreachable");
  assert.equal(back.studentId, "stu_7f21");
  assert.equal(back.exp, 1789412400);
  assert.equal(back.sig, "k3Qw");

  // A student id containing a dot must survive: the parse splits from the
  // right, because only the id is opaque.
  const dotted = unpackTrackToken("stu.7f.21.1789412400.k3Qw");
  assert.equal(dotted.ok, true);
  if (!dotted.ok) throw new Error("unreachable");
  assert.equal(dotted.studentId, "stu.7f.21");
  assert.equal(dotted.exp, 1789412400);

  for (const junk of ["", "abc", "abc.def", ".1.2", "stu_1.notanumber.sig", "stu_1.0.sig"]) {
    assert.equal(unpackTrackToken(junk).ok, false, `${junk} is not a token`);
  }
}

// --- Meta needs the variable at the END of the button URL -------------
{
  assert.equal(trackLinkPath("tok"), "/track/bus/tok");
  assert.equal(
    trackLinkUrl("https://school.example", "tok"),
    "https://school.example/track/bus/tok",
  );
  assert.equal(
    trackLinkUrl("https://school.example/", "tok"),
    "https://school.example/track/bus/tok",
    "a trailing slash must not produce a double slash",
  );
}

// --- every refusal is a true sentence, not a spinner -------------------
{
  const reasons = [
    "off-hours",
    "expired",
    "bad-link",
    "no-vehicle",
    "no-feed",
    "too-old",
    "off-trip",
  ] as const;
  for (const r of reasons) {
    const text = trackRefusalText(r);
    assert.ok(text.length > 20, `${r} needs a real sentence`);
    assert.ok(!/undefined|null/.test(text));
  }
  // The two that mean "the bus is parked" must not sound like a fault the
  // parent has to fix, and the two that mean "we cannot see it" must not
  // sound like the bus is missing.
  assert.equal(trackRefusalText("off-hours"), trackRefusalText("off-trip"));
  assert.ok(/too old/.test(trackRefusalText("too-old")));
  assert.ok(/tracker/.test(trackRefusalText("no-feed")));
}

console.log("  ok");
