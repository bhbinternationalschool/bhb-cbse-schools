/**
 * Self-test: SSE framing for the streaming tutor / chat routes.
 * Run: npx tsx apps/web/src/lib/aiStream.selftest.ts
 */
import assert from "node:assert/strict";
import {
  consumeAiStream,
  createSseParser,
  encodeSseEvent,
  parseAiStreamEvent,
  readGeminiStreamChunk,
  readOpenAiStreamChunk,
  type AiStreamEvent,
} from "@/lib/aiStream";

// --- parser: events split across chunks, CRLF, comments, multi-line data
{
  const p = createSseParser();
  assert.deepEqual(p.feed("data: {\"a\":1}\n\nda"), ['{"a":1}']);
  assert.deepEqual(p.feed("ta: {\"b\":2}\r\n\r\n"), ['{"b":2}'], "a payload split mid-word joins up");
  assert.deepEqual(p.feed(": keep-alive\n\ndata: x\ndata: y\n\n"), ["x\ny"], "multi-line data joins with \\n; comments dropped");
  assert.deepEqual(p.feed("data: tail"), [], "a partial trailing line waits");
  assert.deepEqual(p.flush(), ["tail"], "flush closes the last event");
  assert.deepEqual(p.flush(), [], "flush is idempotent");
}

// --- our own event framing round-trips
{
  const wire = encodeSseEvent({ type: "delta", text: "नमस्ते 👋" });
  assert.equal(wire, 'data: {"type":"delta","text":"नमस्ते 👋"}\n\n');
  const p = createSseParser();
  const [payload] = p.feed(wire);
  assert.deepEqual(parseAiStreamEvent(payload!), { type: "delta", text: "नमस्ते 👋" });
  assert.equal(parseAiStreamEvent("[DONE]"), null);
  assert.equal(parseAiStreamEvent('{"type":"other"}'), null, "unknown types are ignored, not thrown");
  assert.equal(parseAiStreamEvent("not json"), null);
}

// --- provider chunk readers
{
  const oa = readOpenAiStreamChunk('{"choices":[{"delta":{"content":"Hel"}}]}');
  assert.deepEqual(oa, { text: "Hel" });
  const oaLast = readOpenAiStreamChunk('{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":7}}');
  assert.deepEqual(oaLast, { text: "", usage: { promptTokens: 12, completionTokens: 7 } });
  assert.equal(readOpenAiStreamChunk("[DONE]"), null);
  assert.equal(readOpenAiStreamChunk('{"error":{"message":"quota"}}')?.error, "quota");
  assert.equal(readOpenAiStreamChunk('{"choices":[{"delta":{"content":null}}]}')?.text, "", "a null delta is empty, not 'null'");

  const g = readGeminiStreamChunk('{"candidates":[{"content":{"parts":[{"text":"Try "},{"text":"this"}]}}]}');
  assert.deepEqual(g, { text: "Try this" });
  const gLast = readGeminiStreamChunk('{"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":40,"candidatesTokenCount":9}}');
  assert.deepEqual(gLast, { text: "", finishReason: "STOP", usage: { promptTokens: 40, completionTokens: 9 } });
  assert.equal(readGeminiStreamChunk('{"error":{"message":"blocked"}}')?.error, "blocked");
}

// --- browser consumer: a streamed Response, then a JSON error Response
void (async () => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(encodeSseEvent({ type: "delta", text: "one " })));
      // a delta split across two network chunks
      const second = encodeSseEvent({ type: "delta", text: "two" });
      c.enqueue(enc.encode(second.slice(0, 10)));
      c.enqueue(enc.encode(second.slice(10)));
      c.enqueue(enc.encode(encodeSseEvent({ type: "done", engine: "openai", reply: "one two" })));
      c.close();
    },
  });
  const res = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const seen: AiStreamEvent<{ engine: string; reply: string }>[] = [];
  await consumeAiStream<{ engine: string; reply: string }>(res, (e) => seen.push(e));
  assert.deepEqual(seen, [
    { type: "delta", text: "one " },
    { type: "delta", text: "two" },
    { type: "done", engine: "openai", reply: "one two" },
  ]);

  const err = new Response(JSON.stringify({ error: "Login required" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
  const seenErr: AiStreamEvent[] = [];
  await consumeAiStream(err, (e) => seenErr.push(e));
  assert.deepEqual(seenErr, [{ type: "error", error: "Login required" }], "a JSON error becomes one error event");

  console.log("aiStream.selftest: ok");
})();
