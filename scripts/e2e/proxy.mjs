#!/usr/bin/env node
/**
 * The Supabase gateway, as far as the e2e stack needs one.
 *
 * supabase-js calls `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/<table>` and
 * `/rest/v1/rpc/<fn>`. On Supabase, Kong strips `/rest/v1` and hands the rest
 * to PostgREST. This does the same for a local PostgREST, passing every
 * header through (apikey, Authorization, Prefer, Range, Accept-Profile,
 * Content-Profile) and the response back untouched.
 *
 * Everything else Supabase serves — Auth, Storage, Edge Functions, Realtime,
 * GraphQL — answers 501 with a JSON reason, so a test that reaches one fails
 * at once and says why, instead of hanging on a connection nobody answers.
 *
 * Like Kong, a request with neither `apikey` nor `Authorization` is refused
 * (401) — except a CORS preflight, which carries neither by design.
 *
 * Env: E2E_PROXY_PORT (listen, 127.0.0.1 only), E2E_POSTGREST_URL (upstream,
 * must be http://127.0.0.1:<port>). One line per request on stdout.
 */
import http from "node:http";

const port = Number(process.env.E2E_PROXY_PORT || "");
const upstream = new URL(process.env.E2E_POSTGREST_URL || "http://invalid");
if (!port || upstream.hostname !== "127.0.0.1" || upstream.protocol !== "http:") {
  console.error("proxy: E2E_PROXY_PORT and an http://127.0.0.1:<port> E2E_POSTGREST_URL are required");
  process.exit(2);
}

const NOT_SERVED = {
  "/auth/v1": "Supabase Auth",
  "/storage/v1": "Supabase Storage",
  "/functions/v1": "Supabase Edge Functions",
  "/realtime/v1": "Supabase Realtime",
  "/graphql/v1": "Supabase GraphQL",
};

function log(req, status, started) {
  process.stdout.write(
    `${new Date().toISOString()} ${req.method} ${req.url} ${status} ${Date.now() - started}ms\n`,
  );
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "access-control-allow-origin": "*",
  });
  res.end(text);
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const url = req.url || "/";
  const path = url.split("?")[0];

  const prefix = Object.keys(NOT_SERVED).find((p) => path === p || path.startsWith(`${p}/`));
  if (prefix) {
    json(res, 501, {
      code: "E2E_NOT_SERVED",
      message:
        `${NOT_SERVED[prefix]} (${prefix}) is not part of the e2e stack — it serves PostgREST ` +
        `(/rest/v1) only. In production this request would reach ${NOT_SERVED[prefix]}.`,
      path,
    });
    log(req, 501, started);
    return;
  }

  if (path !== "/rest/v1" && !path.startsWith("/rest/v1/")) {
    json(res, 404, { code: "E2E_NO_ROUTE", message: `no route for ${path}`, path });
    log(req, 404, started);
    return;
  }

  if (req.method !== "OPTIONS" && !req.headers.apikey && !req.headers.authorization) {
    json(res, 401, { message: "No API key found in request" });
    log(req, 401, started);
    return;
  }

  const target = url.slice("/rest/v1".length) || "/";
  const headers = { ...req.headers, host: upstream.host };
  const up = http.request(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: target.startsWith("/") ? target : `/${target}`,
      headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
      upRes.on("end", () => log(req, upRes.statusCode || 502, started));
    },
  );
  up.on("error", (e) => {
    if (!res.headersSent) json(res, 502, { code: "E2E_UPSTREAM", message: `PostgREST unreachable: ${e.message}` });
    else res.destroy(e);
    log(req, 502, started);
  });
  req.pipe(up);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`proxy listening on http://127.0.0.1:${port} -> ${upstream.origin}\n`);
});
// Nothing to flush: exit at once rather than wait on keep-alive sockets.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
