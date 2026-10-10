/**
 * Build a text/event-stream Response for a streaming chat route. The
 * producer gets `send` for deltas and must return the terminal event; a
 * thrown error becomes an `error` event so the client never hangs.
 *
 * The headers stop every proxy between Cloud Run and the browser from
 * buffering the body; without `X-Accel-Buffering: no` a reply can arrive
 * all at once at the end, which is worse than not streaming.
 */
import "server-only";
import { encodeSseEvent, type AiStreamEvent } from "@/lib/aiStream";

export function aiStreamResponse<TDone extends object>(
  produce: (
    send: (event: AiStreamEvent<TDone>) => void,
  ) => Promise<({ type: "done" } & TDone) | { type: "error"; error: string }>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AiStreamEvent<TDone>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        } catch {
          closed = true; // the client went away; keep the model call going so the audit row is complete
        }
      };
      try {
        send(await produce(send));
      } catch (e) {
        send({
          type: "error",
          error: e instanceof Error ? e.message : "stream failed",
        });
      } finally {
        if (!closed) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** A client asks for a stream with the standard Accept header. */
export function wantsAiStream(req: Request): boolean {
  return (req.headers.get("accept") || "").includes("text/event-stream");
}
