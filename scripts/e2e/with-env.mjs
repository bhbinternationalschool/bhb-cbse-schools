#!/usr/bin/env node
/**
 * Run a command with apps/web/.env.e2e as its ONLY configuration.
 *
 *   node scripts/e2e/with-env.mjs <env-file> -- <command> [args...]
 *
 * The repo has no dotenv-cli dependency, and this does more than it would:
 *
 *  - The child's environment is the env file plus a short allowlist of
 *    process basics (PATH, HOME, TMPDIR, locale, NODE_OPTIONS, CI). Nothing
 *    else from the calling shell reaches it, so a production key exported in
 *    someone's terminal cannot ride along into a test run.
 *  - NEXT_PUBLIC_SUPABASE_URL must be http://127.0.0.1:<port>, and no value
 *    may name the production project. Otherwise it refuses.
 *  - It refuses to run in a directory holding .env, .env.local,
 *    .env.production or .env.production.local: Next.js loads those files by
 *    itself, and apps/web/.env.local is PRODUCTION. Use a git worktree, which
 *    has none. As a second lock it sets __NEXT_PROCESSED_ENV, which makes
 *    Next.js skip its own env-file loading.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRODUCTION_PROJECT_REF = "ymamhlcrjsuilzdonkzl";
const INHERITED = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP",
  "LANG", "LC_ALL", "TERM", "NODE_OPTIONS", "CI", "GITHUB_ACTIONS",
  "npm_config_cache", "XDG_CACHE_HOME", "XDG_CONFIG_HOME",
];

function die(msg) {
  console.error(`with-env: ${msg}`);
  process.exit(2);
}

const sep = process.argv.indexOf("--");
const envFile = process.argv[2];
if (!envFile || sep !== 3 || sep === process.argv.length - 1) {
  die("usage: with-env.mjs <env-file> -- <command> [args...]");
}
const command = process.argv[sep + 1];
const args = process.argv.slice(sep + 2);

if (!existsSync(envFile)) die(`${envFile} not found — run \`bash scripts/e2e-stack.sh up\` first`);

const fromFile = {};
for (const raw of readFileSync(envFile, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq <= 0) die(`malformed line in ${envFile}: ${line.slice(0, 40)}`);
  fromFile[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
}

const url = fromFile.NEXT_PUBLIC_SUPABASE_URL || "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
  die(`NEXT_PUBLIC_SUPABASE_URL must be http://127.0.0.1:<port>, got "${url}" — refusing`);
}
for (const [k, v] of Object.entries(fromFile)) {
  if (v.includes(PRODUCTION_PROJECT_REF) || /supabase\.co\b/.test(v)) {
    die(`${k} in ${envFile} points at a hosted Supabase project — refusing`);
  }
}

const cwd = process.cwd();
for (const f of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  if (existsSync(resolve(cwd, f))) {
    die(
      `${resolve(cwd, f)} exists. Next.js would load it, and apps/web/.env.local is ` +
        "PRODUCTION. Run the e2e stack from a git worktree (it has no env files).",
    );
  }
}

const env = {};
for (const k of INHERITED) if (process.env[k] !== undefined) env[k] = process.env[k];
Object.assign(env, fromFile, { __NEXT_PROCESSED_ENV: "true", NEXT_TELEMETRY_DISABLED: "1" });

const child = spawn(command, args, { stdio: "inherit", env, cwd });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("error", (e) => die(`could not start ${command}: ${e.message}`));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
