#!/usr/bin/env node
/**
 * Build the drag-to-install page for the "Send to ERP" bookmark.
 *
 * Installing a bookmarklet by copy and paste goes wrong in two ordinary ways:
 * Chrome silently drops the leading `javascript:` on paste, and a person who
 * cannot see the bookmarks bar has nowhere to drop it. Both happened here on
 * 19 Sep 2026 and cost an afternoon. A page with the bookmark already on it,
 * dragged once, avoids the first and names the second.
 *
 * The page is built from `nucleus-capture-bookmarklet.txt` — the artefact the
 * office actually installs — and never from `nucleus-capture.js`, which is the
 * same program kept readable. Generating from the readable copy would let the
 * page offer a bookmark nobody has tested. If you change the script, rebuild
 * the .txt first, then run this.
 *
 *   node scripts/build-nucleus-install-page.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const SRC = join(docs, "nucleus-capture-bookmarklet.txt");
const OUT = join(docs, "nucleus-capture-install.html");

const href = readFileSync(SRC, "utf8").trim();
if (!href.startsWith("javascript:")) {
  throw new Error(`${SRC} does not begin with javascript: — it cannot be a bookmarklet`);
}
// A page that installs a broken bookmark is worse than no page: the failure
// surfaces later, on the Nucleus tab, as silence.
try {
  new vm.Script(decodeURIComponent(href.slice("javascript:".length)));
} catch (e) {
  throw new Error(`the bookmarklet does not parse as JavaScript: ${e.message}`);
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

writeFileSync(
  OUT,
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Install the Send to ERP bookmark</title>
<style>
 body{font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:660px;
   margin:48px auto;padding:0 20px;color:#1a1a1a}
 h1{font-size:23px;margin-bottom:4px} h2{font-size:17px;margin-top:34px}
 p.sub{color:#666;margin-top:0} ol{padding-left:22px} li{margin:10px 0}
 .drag{display:inline-block;margin:24px 0;padding:13px 24px;background:#0b5fff;color:#fff;
   border-radius:8px;text-decoration:none;font-weight:600;cursor:grab;
   box-shadow:0 2px 6px rgba(0,0,0,.2)}
 .note{background:#fff8e1;border-left:4px solid #f0b429;padding:12px 16px;margin:26px 0;font-size:15px}
 .fallback{background:#f5f7fa;border-left:4px solid #9aa5b1;padding:12px 16px;font-size:15px}
 kbd{background:#eee;border:1px solid #ccc;border-radius:4px;padding:1px 5px;font-size:13px}
 code{background:#eef1f4;padding:1px 5px;border-radius:4px}
</style></head><body>
<h1>Install the &ldquo;Send to ERP&rdquo; bookmark</h1>
<p class="sub">One-time setup, about thirty seconds. Nothing to copy or paste.</p>
<ol>
  <li><strong>Press <kbd>&#8679;</kbd><kbd>&#8984;</kbd><kbd>B</kbd> and check you can see a strip of
      bookmarks under the address bar.</strong> If you cannot see it, there is nowhere to drop the
      button and the next step will appear to do nothing.</li>
  <li><strong>Drag the blue button</strong> below up onto that strip, and let go.</li>
  <li>A bookmark named <em>Send to ERP</em> is now on the bar. That is the whole installation.</li>
</ol>
<p><a class="drag" href="${esc(href)}">Send to ERP</a></p>
<div class="note"><strong>Drag it &mdash; do not click it here.</strong> It only does something on a
Nucleus page. On this page, clicking it does nothing at all.</div>

<h2>Using it</h2>
<ol>
  <li>Open <a href="https://nucleus.leadgroup.co.in">nucleus.leadgroup.co.in</a> and sign in.</li>
  <li>Go to <strong>Assessments &amp; Answer key</strong> or <strong>Teacher Timeliness</strong>, and
      let the page finish loading.</li>
  <li>Click <strong>Send to ERP</strong> on the bookmarks bar.</li>
  <li>A panel appears at the top right. On the papers page it counts through the list
      (<em>Reading 14 of 108&hellip;</em>) and takes about twelve minutes; on the timeliness page it is
      instant. Leave that tab in front until it says it has copied.</li>
  <li>In the ERP, paste into <strong>Exams &rarr; Question papers &rarr; Get papers from Nucleus</strong>,
      or into the timeliness box under <strong>Teaching &rarr; Nucleus</strong>.</li>
</ol>
<p>Nothing is downloaded to the computer, nothing in Nucleus is changed, and nothing is sent anywhere:
the only output is text on the clipboard. Closing the tab part-way through is always safe.</p>

<h2>If the bookmark will not install</h2>
<div class="fallback">You can run it without a bookmark. On the Nucleus page press
<kbd>&#8997;</kbd><kbd>&#8984;</kbd><kbd>J</kbd> to open the Console, open
<code>nucleus-capture.js</code>, copy all of it, click the <code>&gt;</code> line and paste.
If Chrome answers <em>&ldquo;Type &lsquo;allow pasting&rsquo;&rdquo;</em>, type those two words, press
Return, and paste again &mdash; it asks only once. Then press Return.</div>
</body></html>
`,
);
console.log(`wrote ${OUT} (${readFileSync(OUT).length} bytes) from a ${href.length}-character bookmarklet`);
