/**
 * Has this WhatsApp message already been handled?
 *
 * Meta re-delivers a webhook it did not get a prompt answer for. Every
 * message was cheap enough that a repeat went unnoticed — until a voice note
 * arrived, which costs a media download, a paid transcription and about six
 * seconds. A retry of one of those is a second reply to the parent, a second
 * row in the hub and a second bill.
 *
 * So a message id is remembered the moment it is picked up, before the work
 * rather than after. That makes this at-most-once: a message whose processing
 * then fails is not retried by Meta either. That is the right way round here —
 * a parent seeing the same answer twice is a visible fault, and the failure
 * branches already hand the thread to a person rather than dropping it.
 */

/**
 * How long an id is worth remembering. Meta's retries are minutes apart at
 * most; six hours is generous and still small enough to keep the map tidy.
 */
export const HANDLED_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Hard cap, so a burst cannot grow the store without bound. Oldest go first.
 * The store is one JSON blob — an unbounded map in it would eventually cost
 * every message a bigger read and write.
 */
export const HANDLED_MAX = 500;

export type HandledMap = Record<string, number>;

/** Already picked up, and recently enough that a retry is what this is. */
export function isHandledMessage(
  handled: HandledMap | undefined,
  waMessageId: string | undefined,
  nowMs: number,
): boolean {
  if (!waMessageId) return false;
  const at = handled?.[waMessageId];
  if (typeof at !== "number") return false;
  return nowMs - at < HANDLED_TTL_MS;
}

/**
 * Record the id and prune in the same pass, so the map is tidied by ordinary
 * traffic and never needs a sweep of its own.
 */
export function rememberHandledMessage(
  handled: HandledMap | undefined,
  waMessageId: string | undefined,
  nowMs: number,
): HandledMap {
  if (!waMessageId) return handled ?? {};
  const next: HandledMap = {};
  for (const [id, at] of Object.entries(handled ?? {})) {
    if (typeof at === "number" && nowMs - at < HANDLED_TTL_MS) next[id] = at;
  }
  next[waMessageId] = nowMs;

  const ids = Object.keys(next);
  if (ids.length <= HANDLED_MAX) return next;
  // Oldest first, but never drop the one just recorded — that would make the
  // next retry of this very message look new.
  ids.sort((a, b) => next[a]! - next[b]!);
  for (const id of ids.slice(0, ids.length - HANDLED_MAX)) {
    if (id !== waMessageId) delete next[id];
  }
  return next;
}
