/**
 * The fee counter's concession grants and their revoke on a voided receipt
 * (data-layer 2.2e, review fixes 27 Oct 2026), through the server:
 * POST /api/fees/counter-grants — the server reads the STORED grants,
 * refuses duplicates, decides approval from the session, and writes a
 * receipt's grants only once that receipt is in the database (and revokes
 * them only once its void is). A fees · edit clerk may do both (director,
 * 27 Oct); nothing else about concessions.
 *
 * "The receipt is not in the database yet" (the counter's fee push still on
 * its way) is waited out — asked again every 2 s for up to a minute. Anything
 * that still fails is KEPT in this browser and retried the next time Fee Take
 * opens (retryQueuedCounterGrants), and the clerk is told in a toast that
 * stays — never dropped silently.
 */
import type { CounterGrantRequest } from "@/lib/counterConcession";

type GrantOutcome =
  | { ok: true; granted: number; skipped: number; pending: number; ruleLabels: string[]; blocked: string[] }
  | { ok: false; error: string };

type QueueEntry =
  | { kind: "grant"; body: CounterGrantRequest; at: string; lastError: string }
  | { kind: "revoke"; body: { voucherId: string; receiptNo: string }; at: string; lastError: string };

const QUEUE_KEY = "bhb.counterGrantQueue.v1";
const WAIT_MS = 60_000;
const STEP_MS = 2_000;

type Answer = { status: number; body: { ok?: boolean; kind?: string; message?: string; [k: string]: unknown } | null };

async function post(body: Record<string, unknown>, deps: Deps): Promise<Answer> {
  try {
    const res = await deps.fetch("/api/fees/counter-grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Answer["body"] };
  } catch (e) {
    return { status: 0, body: { ok: false, kind: "network", message: e instanceof Error ? e.message : "Network request failed" } };
  }
}

export type Deps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  say: (message: string) => void;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
};

function browserDeps(): Deps {
  return {
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    say: (message) => {
      void import("@/components/shell/Toast")
        .then(({ pushToast }) => pushToast({ kind: "error", message, durationMs: 0 }))
        .catch(() => undefined);
    },
    storage: (() => {
      try {
        return typeof window !== "undefined" ? window.localStorage : null;
      } catch {
        return null;
      }
    })(),
  };
}

/** Ask until the receipt is in the database (or the wait runs out). */
async function postWaiting(body: Record<string, unknown>, deps: Deps): Promise<Answer> {
  const until = deps.now() + WAIT_MS;
  for (;;) {
    const a = await post(body, deps);
    const waitable = a.status === 409 && a.body?.kind === "receipt_pending";
    // One quick retry after a conflict (another counter wrote meanwhile): the
    // server plans again on what is stored and skips what is already there.
    const conflict = a.status === 409 && a.body?.kind === "conflict";
    if (!waitable && !conflict) return a;
    if (deps.now() >= until) return a;
    await deps.sleep(STEP_MS);
  }
}

function readQueue(deps: Deps): QueueEntry[] {
  try {
    const raw = deps.storage?.getItem(QUEUE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(deps: Deps, q: QueueEntry[]): void {
  try {
    deps.storage?.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* said in the toast; nothing more to do */
  }
}

function enqueue(deps: Deps, e: QueueEntry): void {
  const q = readQueue(deps).filter(
    (x) => !(x.kind === e.kind && JSON.stringify(x.body) === JSON.stringify(e.body)),
  );
  writeQueue(deps, [...q, e]);
}

const message = (a: Answer) => String(a.body?.message ?? (a.status ? `HTTP ${a.status}` : "no answer"));
/** A refusal that a retry cannot change (authority, a bad request): not queued. */
const final = (a: Answer) => a.status === 403 || a.status === 400 || a.status === 404;

export async function recordCounterGrants(body: CounterGrantRequest, deps: Deps = browserDeps()): Promise<GrantOutcome> {
  const a = await postWaiting({ action: "grant", ...body }, deps);
  if (a.status === 200 && a.body?.ok) {
    const b = a.body as unknown as Extract<GrantOutcome, { ok: true }>;
    return { ok: true, granted: b.granted ?? 0, skipped: b.skipped ?? 0, pending: b.pending ?? 0, ruleLabels: b.ruleLabels ?? [], blocked: b.blocked ?? [] };
  }
  const why = message(a);
  if (!final(a) && body.sourceVoucherId) {
    enqueue(deps, { kind: "grant", body, at: new Date(deps.now()).toISOString(), lastError: why });
    deps.say(
      `The standing discount for receipt ${body.sourceReceiptNo ?? ""} was NOT recorded yet (${why}). ` +
        `It is kept and tried again when Fee Take opens — or record it in Masters → Concessions.`,
    );
  }
  return { ok: false, error: why };
}

export async function revokeCounterGrants(
  voucher: { id: string; receiptNo: string },
  deps: Deps = browserDeps(),
): Promise<{ ok: true; revoked: number } | { ok: false; error: string }> {
  const body = { voucherId: voucher.id, receiptNo: voucher.receiptNo };
  const a = await postWaiting({ action: "revoke", ...body }, deps);
  if (a.status === 200 && a.body?.ok) return { ok: true, revoked: Number(a.body.revoked ?? 0) };
  const why = message(a);
  if (!final(a)) enqueue(deps, { kind: "revoke", body, at: new Date(deps.now()).toISOString(), lastError: why });
  deps.say(
    `Receipt ${voucher.receiptNo} was voided, but the discount it granted was NOT ended yet (${why}). ` +
      (final(a) ? "End it in Masters → Concessions." : "It is kept and tried again when Fee Take opens — or end it in Masters → Concessions."),
  );
  return { ok: false, error: why };
}

/** Try every kept grant / revoke once more (Fee Take on open). Returns how many are still waiting. */
export async function retryQueuedCounterGrants(deps: Deps = browserDeps()): Promise<number> {
  const q = readQueue(deps);
  if (q.length === 0) return 0;
  const left: QueueEntry[] = [];
  for (const e of q) {
    const a = await post({ action: e.kind, ...e.body }, deps);
    if (a.status === 200 && a.body?.ok) continue;
    if (final(a)) {
      deps.say(`A kept ${e.kind === "grant" ? "standing discount" : "discount end"} for receipt ${e.kind === "grant" ? (e.body.sourceReceiptNo ?? "") : e.body.receiptNo} was refused (${message(a)}) — do it in Masters → Concessions.`);
      continue;
    }
    left.push({ ...e, lastError: message(a) });
  }
  writeQueue(deps, left);
  if (left.length) {
    deps.say(`${left.length} concession change(s) from earlier receipts are still not recorded — they are tried again each time Fee Take opens.`);
  }
  return left.length;
}

export const COUNTER_GRANT_QUEUE_KEY = QUEUE_KEY;
