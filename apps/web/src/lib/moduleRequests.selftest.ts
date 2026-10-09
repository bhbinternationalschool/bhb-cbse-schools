import assert from "node:assert/strict";
import {
  addModuleRequest,
  decideModuleRequest,
  emptyModuleRequestsState,
  normalizeModuleRequestsState,
  recordStuckSignal,
  soundsLikeChangeRequest,
  type ModuleRequest,
} from "./moduleRequests";
import { parseModuleRequestDraft } from "./moduleRequestDraft";
import { MORE_PAGE_GUIDES, resolveErpAiPageGuide } from "./erpAiPageGuides";

console.log("moduleRequests.selftest.ts");

/* ── requests: add, decide, never built unapproved ── */
const req = (id: string): ModuleRequest => ({
  id, createdAt: "2026-10-09T10:00:00Z", byStaffId: "s1", byName: "Neha", byRole: "teacher",
  module: "homework", pathname: "/homework", tab: "", pageLabel: "Homework", kind: "change",
  title: "Copy homework to section B", problem: "Same homework typed twice", wanted: "Post once for A and B",
  suggestion: "Add a 'Also post to' section picker", transcript: [], status: "new",
  decidedAt: "", decidedBy: "", directorNote: "", prUrl: "",
});
let st = addModuleRequest(emptyModuleRequestsState(), req("mr_1"));
st = addModuleRequest(st, req("mr_2"));
assert.deepEqual(st.requests.map((r) => r.id), ["mr_2", "mr_1"], "newest first");

const d = decideModuleRequest(st, { id: "mr_1", status: "approved", suggestion: "Add an 'Also post to' picker listing the teacher's own sections", by: "Director", now: "2026-10-09T18:00:00Z" });
assert.ok(d.ok);
if (d.ok) {
  const r = d.state.requests.find((x) => x.id === "mr_1")!;
  assert.equal(r.status, "approved");
  assert.equal(r.decidedBy, "Director");
  assert.match(r.suggestion, /teacher's own sections/, "the director's edit is what gets built");
}
assert.equal(decideModuleRequest(st, { id: "nope", status: "approved", by: "x", now: "" }).ok, false);
assert.equal(decideModuleRequest(st, { id: "mr_1", status: "shipped" as never, by: "x", now: "" }).ok, false);

/* ── normalize: garbage in, safe shape out ── */
const n = normalizeModuleRequestsState({ requests: [{ id: "x", status: "weird", kind: "?", transcript: Array(40).fill({ role: "user", text: "a" }) }, null], stuck: "no" });
assert.equal(n.requests.length, 1);
assert.equal(n.requests[0]!.status, "new");
assert.equal(n.requests[0]!.kind, "change");
assert.equal(n.requests[0]!.transcript.length, 12);
assert.deepEqual(n.stuck, []);

/* ── stuck: counted per screen + message, users once ── */
let s2 = emptyModuleRequestsState();
s2 = recordStuckSignal(s2, { module: "fees", pathname: "/fees?tab=x", message: "Amount must be positive", user: "A", now: "t1" });
s2 = recordStuckSignal(s2, { module: "fees", pathname: "/fees", message: "amount must be positive", user: "A", now: "t2" });
s2 = recordStuckSignal(s2, { module: "fees", pathname: "/fees", message: "Amount must be positive", user: "B", now: "t3" });
assert.equal(s2.stuck.length, 1);
assert.equal(s2.stuck[0]!.count, 3);
assert.deepEqual(s2.stuck[0]!.users, ["A", "B"]);

/* ── what sounds like a request ── */
assert.equal(soundsLikeChangeRequest("there is no option to print two receipts"), true);
assert.equal(soundsLikeChangeRequest("यहाँ सेक्शन B का ऑप्शन होना चाहिए"), true);
assert.equal(soundsLikeChangeRequest("how do I collect fees"), false);

/* ── the drafting reply: question, card, or nothing ── */
assert.deepEqual(parseModuleRequestDraft('{"ready":false,"question":"Which class?"}'), { ready: false, question: "Which class?" });
const card = parseModuleRequestDraft('text {"ready":true,"kind":"bug","title":"Save fails","problem":"x","wanted":"y","suggestion":"z"} end');
assert.ok(card && card.ready && card.kind === "bug");
assert.equal(parseModuleRequestDraft('{"ready":true,"title":"t"}'), null, "no change text, no card");
assert.equal(parseModuleRequestDraft("not json"), null);

/* ── a guide on every screen ── */
const ids = new Set<string>();
for (const g of MORE_PAGE_GUIDES) {
  assert.ok(!ids.has(g.id), `duplicate guide id ${g.id}`);
  ids.add(g.id);
  assert.ok(g.steps.length >= 2 && g.paths.length >= 1, g.id);
}
for (const path of ["/staff", "/store", "/trust", "/vault", "/library", "/visitors", "/ptm", "/events", "/certificates", "/my-pay", "/my-class", "/online-classes", "/teaching", "/complaints", "/health", "/id-cards", "/reports", "/documents"]) {
  assert.ok(resolveErpAiPageGuide(path, null), `no guide for ${path}`);
}
assert.equal(resolveErpAiPageGuide("/store", "counter")?.id, "store-counter", "a tab gets its own guide");
assert.equal(resolveErpAiPageGuide("/fees", null)?.id, "fees", "the original module guides still answer");
assert.equal(resolveErpAiPageGuide("/attendance", "leave")?.id, "student-leave");

console.log("moduleRequests.selftest: all assertions passed");
