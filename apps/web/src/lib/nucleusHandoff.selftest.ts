import assert from "node:assert/strict";
import {
  HANDOFF_CAPTURE,
  HANDOFF_PATH,
  urlAsksForTab,
  HANDOFF_MAX_CHARS,
  NUCLEUS_ORIGIN,
  readHandoffMessage,
} from "./nucleusHandoff";

console.log("nucleusHandoff.selftest.ts");

const good = { kind: HANDOFF_CAPTURE, page: "papers", payload: '{"papers":[]}' };

{
  const r = readHandoffMessage(NUCLEUS_ORIGIN, good, "papers");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.page, "papers");
    assert.equal(r.payload, '{"papers":[]}');
  }
}

{
  // A look-alike host is the whole reason this is an equality and not a
  // suffix test: `endsWith(".leadgroup.co.in")` would accept the first of
  // these and `includes()` the second.
  for (const origin of [
    "https://nucleus.leadgroup.co.in.example.com",
    "https://evil.example.com/?x=https://nucleus.leadgroup.co.in",
    "http://nucleus.leadgroup.co.in",
    "https://nucleus.leadgroup.co.in:8443",
    "null",
    "",
  ]) {
    const r = readHandoffMessage(origin, good, "papers");
    assert.equal(r.ok, false, `${origin} must be refused`);
    if (!r.ok) assert.equal(r.speak, false, "a stranger's message is not worth a complaint");
  }
}

{
  // Extensions and framework chatter post to every window all day.
  for (const data of [null, undefined, "hello", 42, { kind: "webpackHotUpdate" }, {}]) {
    const r = readHandoffMessage(NUCLEUS_ORIGIN, data, "papers");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.speak, false);
  }
}

{
  // The right capture at the wrong desk: quiet, because both screens listen
  // and exactly one of them is meant to take it.
  const r = readHandoffMessage(NUCLEUS_ORIGIN, { ...good, page: "timeliness" }, "papers");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.speak, false);
    assert.match(r.why, /belongs on another screen/);
  }
}

{
  // From Nucleus, shaped like a capture, but unusable — this one the office
  // must hear about, or the click looks like it simply did nothing.
  const cases: Array<[unknown, RegExp]> = [
    [{ kind: HANDOFF_CAPTURE, page: "papers", payload: "" }, /arrived empty/],
    [{ kind: HANDOFF_CAPTURE, page: "papers", payload: "   " }, /arrived empty/],
    [{ kind: HANDOFF_CAPTURE, page: "papers", payload: 42 }, /arrived empty/],
    [{ kind: HANDOFF_CAPTURE, page: "papers" }, /arrived empty/],
    [{ kind: HANDOFF_CAPTURE, page: "elsewhere", payload: "x" }, /which screen/],
    [
      { kind: HANDOFF_CAPTURE, page: "papers", payload: "x".repeat(HANDOFF_MAX_CHARS + 1) },
      /past the/,
    ],
  ];
  for (const [data, why] of cases) {
    const r = readHandoffMessage(NUCLEUS_ORIGIN, data, "papers");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.speak, true);
      assert.match(r.why, why);
    }
  }
}

{
  // The limit is a ceiling, not a target: a full term must pass with room.
  const term = "x".repeat(HANDOFF_MAX_CHARS);
  const r = readHandoffMessage(NUCLEUS_ORIGIN, { ...good, payload: term }, "papers");
  assert.equal(r.ok, true, "exactly at the limit is still a capture");
}

{
  const r = readHandoffMessage(NUCLEUS_ORIGIN, { ...good, page: "timeliness" }, "timeliness");
  assert.equal(r.ok, true);
}

{
  assert.equal(urlAsksForTab("?tab=papers", "papers"), true);
  assert.equal(urlAsksForTab("?tab=papers&x=1", "papers"), true);
  assert.equal(urlAsksForTab("", "papers"), false);
  assert.equal(urlAsksForTab("?tab=nucleus", "papers"), false);
  assert.equal(urlAsksForTab("?tab=PAPERS", "papers"), false, "an exact name, not a guess");
  assert.equal(urlAsksForTab("?tab=papers", "nucleus"), false);
  // The paths the bookmark opens must ask for the tab they claim to open.
  assert.ok(urlAsksForTab(HANDOFF_PATH.papers.split("?")[1] ? "?" + HANDOFF_PATH.papers.split("?")[1] : "", "papers"));
  assert.ok(urlAsksForTab("?" + HANDOFF_PATH.timeliness.split("?")[1], "nucleus"));
}

console.log("OK — nucleusHandoff.selftest.ts");
