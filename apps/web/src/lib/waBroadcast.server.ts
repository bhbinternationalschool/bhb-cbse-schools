/**
 * Sending one approved template to many mobiles, server-side.
 *
 * Opt-out filtering, chunking and the dispatch hand-off, extracted from the
 * staff broadcast route so the ERP command desk sends parents exactly what
 * that route sends them — through the same queue, with the same STOP list
 * honoured. Nothing here decides *who* the audience is; that stays with the
 * caller, where the permission rules live.
 */

import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { POST as dispatchPost } from "@/app/api/wa/dispatch/route";

/** Meta caps a dispatch batch; the route has used 100 since it was written. */
const CHUNK_SIZE = 100;

export type BroadcastTemplate = {
  name: string;
  language: string;
  components?: unknown[];
};

export type BroadcastResult = {
  recipientCount: number;
  skippedOptOut: number;
  sent: number;
  failed: number;
  results: unknown[];
};

export async function broadcastTemplateToMobiles(opts: {
  mobiles: string[];
  template: BroadcastTemplate;
  /** Dispatch bucket, for the delivery log. */
  module: string;
  dryRun?: boolean;
  /** Any request from the running server, for the dispatch URL's origin. */
  originUrl: string;
}): Promise<BroadcastResult> {
  const unique = Array.from(new Set(opts.mobiles.filter(Boolean)));
  const optedOut = await listOptedOutSet(unique).catch(() => new Set<string>());
  const kept: string[] = [];
  let skippedOptOut = 0;
  for (const mobile of unique) {
    if (optedOut.has(toE164India(mobile))) skippedOptOut++;
    else kept.push(mobile);
  }
  if (!kept.length) {
    return { recipientCount: 0, skippedOptOut, sent: 0, failed: 0, results: [] };
  }

  const dispatchSecret = process.env.WA_DISPATCH_SECRET?.trim();
  const dispatchUrl = new URL("/api/wa/dispatch", opts.originUrl).toString();
  const results: unknown[] = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < kept.length; i += CHUNK_SIZE) {
    const chunk = kept.slice(i, i + CHUNK_SIZE);
    const req = new Request(dispatchUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(dispatchSecret ? { "x-wa-dispatch-secret": dispatchSecret } : {}),
      },
      body: JSON.stringify({
        module: opts.module,
        dryRun: !!opts.dryRun,
        messages: chunk.map((mobile) => ({ mobile, template: opts.template })),
      }),
    });
    const res = await dispatchPost(req);
    const json = (await res.json()) as {
      results?: unknown[];
      sent?: number;
      failed?: number;
    };
    if (Array.isArray(json.results)) results.push(...json.results);
    sent += json.sent ?? 0;
    failed += json.failed ?? 0;
  }

  return { recipientCount: kept.length, skippedOptOut, sent, failed, results };
}
