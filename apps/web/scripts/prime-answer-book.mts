/**
 * Prime the two shelves the parent bot reads from.
 *
 * Why (director, 21 Sep 2026): "is our AI training working or not". Nothing
 * is trained — the bot is grounded, and both of its sources were empty:
 *
 *   school_kb_chunks   0 rows, with 2 notices published. The indexer exists
 *                      but was staff-triggered and called by nothing, so it
 *                      had never run once.
 *   wa_answer_book     0 rows. It shipped on 19 Sep (#266) and captures a
 *                      question only when a parent asks one the bot cannot
 *                      answer, so it holds nothing from before that date.
 *
 * With both empty the model is told, correctly, that it knows nothing about
 * this school beyond the family's own children and dues — and so it declines
 * everything else. That is the bot obeying its instructions, not failing.
 *
 * This fills both from what the school already has: the published notices,
 * and every question in the stored WhatsApp history that the bot could not
 * answer. The office then writes each answer once, in the Comms desk, and
 * an approved answer becomes a chunk the bot quotes for ever after.
 *
 * NOTHING IS ANSWERED BY THIS SCRIPT. Every captured question lands as
 * PROPOSED with a blank answer — a question a parent asked is not the
 * school speaking, and only an approved entry ever reaches a parent.
 *
 * `server-only` is aliased by Next and is not a real package, so tsx needs a
 * stub. From apps/web:
 *
 *   mkdir -p /tmp/so/server-only
 *   echo '{"name":"server-only","main":"index.js"}' > /tmp/so/server-only/package.json
 *   echo 'module.exports = {};' > /tmp/so/server-only/index.js
 *
 * Then, still from apps/web:
 *   NODE_PATH=/tmp/so npx tsx scripts/prime-answer-book.mts
 *       Dry run: prints the notices it would index and every question it
 *       would file. Writes nothing.
 *   ALLOW_LOCAL_PROD_WRITES=1 NODE_PATH=/tmp/so npx tsx scripts/prime-answer-book.mts --apply
 *
 * Idempotent: re-indexing a notice replaces its chunk, and a question
 * already in the book is merged into the entry that is there (its
 * asked_count goes up) rather than duplicated.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const k = t.slice(0, i);
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const APPLY = process.argv.includes("--apply");

const { getServerTenantContext } = await import("../src/lib/serverTenant.ts");
const { indexPublishedNotices, schoolKbStats } = await import("../src/lib/schoolKb.server.ts");
const { captureAnswerPair, listAnswerBook } = await import("../src/lib/answerBook.server.ts");
const { worthRecording, questionKey } = await import("../src/lib/answerBook.ts");

/**
 * The bot's own words when it could not answer.
 *
 * Matched on the reply rather than guessed at from the question: the bot
 * saying "I don't have that information" is the only unambiguous record
 * that it could not answer, and it is the same sentence in both languages.
 */
const GAVE_UP = [
  "I don't have that information",
  "इसकी जानकारी मेरे पास नहीं है",
];

type Msg = { role?: string; text?: string; at?: string };
type Thread = { mobile?: string; messages?: Msg[] };

console.log(`prime-answer-book — ${APPLY ? "APPLY" : "dry run"}\n`);

/* ── 1. The shelf: published notices ──────────────────────────────── */

const before = await schoolKbStats();
console.log(`Knowledge base: ${before.chunkCount} chunks, embeddings ${before.embeddingsConfigured ? "configured" : "NOT configured"}`);
if (!before.embeddingsConfigured) {
  console.log("  OPENAI_API_KEY is needed to embed. Skipping the notices.");
} else if (!APPLY) {
  console.log("  (dry run — would index every published notice)");
} else {
  const r = await indexPublishedNotices();
  console.log(r.ok ? `  indexed ${r.indexed}, skipped ${r.skipped}, removed ${r.removed}` : `  FAILED: ${r.error}`);
  const after = await schoolKbStats();
  console.log(`  knowledge base now: ${after.chunkCount} chunks`);
}

/* ── 2. The book: questions the bot could not answer ──────────────── */

const ctx = await getServerTenantContext();
if (!ctx) throw new Error("no tenant context — check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");

const { data, error } = await ctx.sb
  .from("wa_desk_bot_slices")
  .select("payload")
  .eq("tenant_id", ctx.tenantId)
  .eq("slice_key", "sis")
  .maybeSingle();
if (error) throw new Error(`could not read the parent threads: ${error.message}`);

const threads = ((data?.payload as { threads?: Thread[] })?.threads ?? []) as Thread[];
console.log(`\nParent threads in the store: ${threads.length}`);

/** The parent's message immediately before each give-up. */
const found: { mobile: string; at: string; question: string }[] = [];
for (const th of threads) {
  const msgs = th.messages ?? [];
  for (let i = 1; i < msgs.length; i++) {
    const bot = msgs[i];
    if (bot?.role !== "bot") continue;
    const text = String(bot.text ?? "");
    if (!GAVE_UP.some((g) => text.startsWith(g))) continue;
    const asked = msgs[i - 1];
    if (asked?.role !== "parent") continue;
    const question = String(asked.text ?? "").trim();
    if (!question) continue;
    found.push({ mobile: String(th.mobile ?? ""), at: String(asked.at ?? ""), question });
  }
}

// The book's own rule about what is worth an office's attention: "ok", a
// stray digit, a media placeholder are not questions, and a book full of
// those is a book nobody opens.
const worth = found.filter((f) => worthRecording(f.question));
const skipped = found.length - worth.length;

// Two parents asking the same thing is one entry. captureAnswerPair merges
// on its own, but doing it here too keeps the dry run honest about how many
// rows the office will actually see.
const byKey = new Map<string, { question: string; times: number }>();
for (const f of worth) {
  const k = questionKey(f.question) || f.question.toLowerCase();
  const seen = byKey.get(k);
  if (seen) seen.times += 1;
  else byKey.set(k, { question: f.question, times: 1 });
}

const existing = await listAnswerBook();
const already = new Set(existing.map((e) => questionKey(e.question)));

console.log(`Gave up on ${found.length} messages · ${skipped} not questions · ${byKey.size} distinct questions`);
console.log(`Already in the book: ${existing.length} entries\n`);

let filed = 0;
let merged = 0;
for (const [key, { question, times }] of byKey) {
  const mark = already.has(key) ? "merge" : "file ";
  console.log(`  ${mark} ${times > 1 ? `(asked ${times}×) ` : ""}${question.slice(0, 90)}`);
  if (!APPLY) continue;
  // Capture once per asking, so asked_count reflects how often the school
  // was asked — that is the order the office should answer them in.
  for (let n = 0; n < times; n++) {
    const r = await captureAnswerPair({ question, source: "unanswered", sourceRef: "history:2026-09-21" });
    if (!r.ok) {
      console.log(`         ! ${r.error}`);
      break;
    }
    if (n === 0) {
      if (r.merged) merged += 1;
      else filed += 1;
    }
  }
}

console.log(
  APPLY
    ? `\nFiled ${filed} new questions, merged ${merged} into entries already there.`
    : `\nDry run — nothing written. Re-run with ALLOW_LOCAL_PROD_WRITES=1 … --apply`,
);
console.log("Next: Comms desk → Answer book. Write each answer, then approve it.");
