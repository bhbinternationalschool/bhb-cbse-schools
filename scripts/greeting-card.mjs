#!/usr/bin/env node
/**
 * Greeting card PNG for a staff member (birthday, farewell, thank-you).
 *
 * The birthday flow in the ERP covers students only — it reads dates of birth
 * from the student register and messages families. A teacher's birthday has no
 * such record behind it, so this is deliberately a small offline generator:
 * give it a name and a wish, get a card the office can send on WhatsApp today,
 * with no deploy and no data in the system.
 *
 * Usage:
 *   node scripts/greeting-card.mjs --name "Vishnu Om Tripathi" \
 *     --role "Teacher" --wish "..." --signer "A Name"
 *
 * Options: --audience staff|student (who it is signed by — Director for staff,
 *   Principal for students; default staff), --signer (the name above that
 *   office), --from (replaces the whole signature line), --occasion (default
 *   "Happy Birthday"), --date (default today, IST), --format square|story
 *   (default square, repeatable), --out <dir>.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Colours sampled from the official crest — kept in step with lib/types.ts TENANT. */
const BRAND = {
  school: "BHB INTERNATIONAL SCHOOL",
  schoolTitle: "BHB International School",
  tagline: "Tradition of excellence",
  navy: "#203050",
  navyMid: "#384870",
  gold: "#C5A028",
  cream: "#F8F8F0",
};

const FORMATS = {
  square: { width: 1080, height: 1080, label: "Square 1:1 (WhatsApp / Instagram)" },
  story: { width: 1080, height: 1920, label: "Story 9:16 (WhatsApp status)" },
};

/**
 * Who a card is signed by depends on who receives it, which is a decision
 * rather than a preference: a card for a colleague comes from the Director,
 * a card for a child and their family comes from the Principal — the person
 * the school itself puts in front of students. --signer names them; --from
 * still overrides the whole line when an occasion needs different words.
 */
const AUDIENCES = {
  staff: { office: "Director", lead: "With warm regards" },
  student: { office: "Principal", lead: "With warm wishes" },
};

function signatureLine(audience, signer) {
  const a = AUDIENCES[audience];
  const who = [signer, a.office].filter(Boolean).join(", ");
  return `${a.lead} — ${who}, ${BRAND.schoolTitle}`;
}

/**
 * Chromium ships with the image; --chrome overrides it on a different machine.
 * headless_shell first on purpose: the full chrome binary reserves ~95px of the
 * window for UI it never draws, so the page is squeezed and the bottom of the
 * card is cut off. headless_shell gives the viewport the exact window size.
 */
const CHROME_CANDIDATES = [
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
];

function parseArgs(argv) {
  const out = { format: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
    if (key === "format") out.format.push(value);
    else out[key] = value;
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function istToday() {
  // Cards are dated in the school's timezone whatever the machine is set to.
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function crestDataUri() {
  const file = path.join(ROOT, "apps", "web", "public", "logo-crest.png");
  if (!existsSync(file)) return "";
  return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
}

function findChrome(override) {
  const list = override ? [override, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;
  const found = list.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`No Chromium found. Tried:\n  ${list.join("\n  ")}\nPass --chrome /path/to/chrome.`);
  }
  return found;
}

function buildHtml(card, size) {
  const story = size.height > size.width;
  const scale = story ? 1.18 : 1;
  const px = (n) => `${Math.round(n * scale)}px`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${size.width}px; height: ${size.height}px; overflow: hidden; }
  html { background: ${BRAND.navy}; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at 50% 30%, ${BRAND.navyMid} 0%, ${BRAND.navy} 62%, #16223a 100%);
    font-family: "DejaVu Serif", "Liberation Serif", Georgia, serif;
    color: ${BRAND.cream};
  }
  .frame {
    position: absolute; inset: ${px(38)};
    border: 2px solid rgba(197, 160, 40, 0.75); border-radius: ${px(14)};
  }
  .frame::after {
    content: ""; position: absolute; inset: ${px(12)};
    border: 1px solid rgba(197, 160, 40, 0.35); border-radius: ${px(8)};
  }
  .card {
    position: relative; width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: ${px(96)} ${px(86)}; text-align: center;
  }
  .crest { width: ${px(126)}; height: ${px(126)}; object-fit: contain; }
  .school {
    margin-top: ${px(18)}; font-size: ${px(25)}; letter-spacing: ${px(5)};
    color: ${BRAND.gold}; font-weight: 700;
  }
  .tagline {
    margin-top: ${px(6)}; font-size: ${px(18)}; letter-spacing: ${px(3)};
    color: rgba(248, 248, 240, 0.62); font-style: italic;
  }
  .rule {
    width: ${px(180)}; height: 1px; margin: ${px(34)} 0 ${px(30)};
    background: linear-gradient(90deg, transparent, ${BRAND.gold}, transparent);
  }
  .occasion {
    font-size: ${px(58)}; letter-spacing: ${px(6)}; color: ${BRAND.gold};
    text-transform: uppercase; line-height: 1.2;
  }
  .name {
    margin-top: ${px(24)}; font-size: ${px(64)}; font-weight: 700; line-height: 1.16;
    color: ${BRAND.cream};
  }
  .role {
    margin-top: ${px(14)}; font-size: ${px(25)}; letter-spacing: ${px(2)};
    color: rgba(248, 248, 240, 0.78);
  }
  .wish {
    margin-top: ${px(36)}; max-width: ${px(760)}; font-size: ${px(27)}; line-height: 1.62;
    color: rgba(248, 248, 240, 0.9);
  }
  .foot {
    margin-top: ${px(44)}; display: flex; flex-direction: column; gap: ${px(8)};
    font-size: ${px(21)}; letter-spacing: ${px(2)}; color: rgba(248, 248, 240, 0.66);
  }
  .from { color: ${BRAND.gold}; letter-spacing: ${px(3)}; }
</style></head>
<body>
  <div class="frame"></div>
  <div class="card">
    ${card.crest ? `<img class="crest" src="${card.crest}" alt="">` : ""}
    <div class="school">${escapeHtml(BRAND.school)}</div>
    <div class="tagline">${escapeHtml(BRAND.tagline)}</div>
    <div class="rule"></div>
    <div class="occasion">${escapeHtml(card.occasion)}</div>
    <div class="name">${escapeHtml(card.name)}</div>
    ${card.role ? `<div class="role">${escapeHtml(card.role)}</div>` : ""}
    ${card.wish ? `<div class="wish">${escapeHtml(card.wish)}</div>` : ""}
    <div class="foot">
      ${card.from ? `<div class="from">${escapeHtml(card.from)}</div>` : ""}
      ${card.dateLabel ? `<div>${escapeHtml(card.dateLabel)}</div>` : ""}
    </div>
  </div>
</body></html>`;
}

function render(chrome, html, size, outFile) {
  const tmp = `${outFile}.html`;
  writeFileSync(tmp, html, "utf8");
  const res = spawnSync(
    chrome,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${size.width},${size.height}`,
      `--screenshot=${outFile}`,
      `file://${tmp}`,
    ],
    { encoding: "utf8" },
  );
  const ok = res.status === 0 && existsSync(outFile);
  rmSync(tmp, { force: true });
  if (!ok) {
    throw new Error(`Chromium failed to render ${outFile}\n${res.stderr || res.stdout || ""}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name;
  if (!name || name === "true") {
    console.error("Missing --name. Example:\n  node scripts/greeting-card.mjs --name \"A Teacher\" --role Teacher");
    process.exit(1);
  }
  const formats = (args.format.length ? args.format : ["square"]).map((f) => {
    const size = FORMATS[f];
    if (!size) throw new Error(`Unknown --format "${f}". Use: ${Object.keys(FORMATS).join(" | ")}`);
    return [f, size];
  });
  const iso = args.date && args.date !== "true" ? args.date : istToday();
  const audience = args.audience && args.audience !== "true" ? args.audience : "staff";
  if (!AUDIENCES[audience]) {
    throw new Error(`Unknown --audience "${audience}". Use: ${Object.keys(AUDIENCES).join(" | ")}`);
  }
  const signer = args.signer && args.signer !== "true" ? args.signer : "";
  const card = {
    name,
    role: args.role && args.role !== "true" ? args.role : "",
    occasion: args.occasion && args.occasion !== "true" ? args.occasion : "Happy Birthday",
    wish: args.wish && args.wish !== "true" ? args.wish : "",
    from: args.from && args.from !== "true" ? args.from : signatureLine(audience, signer),
    dateLabel: dateLabel(iso),
    crest: crestDataUri(),
  };
  const outDir = args.out && args.out !== "true" ? path.resolve(args.out) : path.join(ROOT, "out", "greeting-cards");
  mkdirSync(outDir, { recursive: true });
  const chrome = findChrome(args.chrome && args.chrome !== "true" ? args.chrome : "");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";

  for (const [key, size] of formats) {
    const outFile = path.join(outDir, `${slug}-${iso}-${key}.png`);
    render(chrome, buildHtml(card, size), size, outFile);
    console.log(`${size.label} → ${outFile}`);
  }
}

main();
