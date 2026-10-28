#!/usr/bin/env node
/**
 * Mint the e2e stack's keys: a fresh random JWT secret for this run, and the
 * anon + service_role keys signed with it (HS256), shaped like the keys a
 * Supabase project hands out. PostgREST verifies them with the same secret
 * and switches to the `role` claim for every request.
 *
 * Prints JSON {jwtSecret, anonKey, serviceRoleKey} on stdout. No dependency:
 * node:crypto only.
 *
 * Usage: node scripts/e2e/mint-keys.mjs
 */
import { createHmac, randomBytes } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function signJwt(claims, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

// PostgREST wants at least 32 characters; 64 hex characters = 256 bits.
const jwtSecret = randomBytes(32).toString("hex");
const iat = Math.floor(Date.now() / 1000);
// Ten years: the stack is torn down long before; nothing here should expire mid-run.
const exp = iat + 10 * 365 * 24 * 3600;
const key = (role) => signJwt({ iss: "bhb-e2e-local", ref: "e2e-local", role, iat, exp }, jwtSecret);

process.stdout.write(
  JSON.stringify({ jwtSecret, anonKey: key("anon"), serviceRoleKey: key("service_role") }) + "\n",
);
