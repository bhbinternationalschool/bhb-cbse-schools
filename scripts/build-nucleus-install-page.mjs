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
 * It also builds the bookmarklet itself. That used to be stripped of comments
 * and indentation by hand, which meant `nucleus-capture.js` and the address
 * people installed could drift apart with nobody the wiser — and they had, by
 * about 1,200 characters, before this script existed. Both now come from the
 * one readable source. The address carries the comments with it, which costs
 * a few kilobytes in a bookmark nobody reads and buys the guarantee that what
 * the office runs is what the repository says it runs.
 *
 *   node scripts/build-nucleus-install-page.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const SRC = join(docs, "nucleus-capture.js");
const BOOKMARKLET = join(docs, "nucleus-capture-bookmarklet.txt");
const OUT = join(docs, "nucleus-capture-install.html");

const source = readFileSync(SRC, "utf8").trim();
// A page that installs a broken bookmark is worse than no page: the failure
// surfaces later, on the Nucleus tab, as silence.
try {
  new vm.Script(source);
} catch (e) {
  throw new Error(`${SRC} does not parse as JavaScript: ${e.message}`);
}
const href = `javascript:${encodeURIComponent(source)}`;
if (decodeURIComponent(href.slice("javascript:".length)) !== source) {
  throw new Error("the encoded bookmarklet does not decode back to the source");
}
writeFileSync(BOOKMARKLET, `${href}\n`);

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
  <li>Click <strong>Send to ERP</strong> on the bookmarks bar. <strong>That is the last thing you
      do.</strong></li>
</ol>
<p>The ERP opens in its own tab straight away and waits. The Nucleus tab counts through the list
(<em>Reading 14 of 108&hellip;</em>) &mdash; about twelve minutes for a full term, instant for
timeliness &mdash; then hands the reading across by itself. The ERP files the new papers, fetches
their answer keys and writes the answers in, without being asked. Nothing is copied and nothing is
pasted.</p>
<p>Leave the Nucleus tab in front while it counts. Nothing is downloaded to the computer, nothing in
Nucleus is changed, and closing the tab part-way through is always safe.</p>
<div class="note"><strong>Stay signed in to the ERP in the same browser.</strong> If the ERP tab lands
on the login screen it cannot take the reading, so the bookmark falls back to copying it &mdash; sign
in, then paste it in by hand.</div>

<h2>If the bookmark will not install</h2>
<div class="fallback">You can run it without a bookmark. On the Nucleus page press
<kbd>&#8997;</kbd><kbd>&#8984;</kbd><kbd>J</kbd> to open the Console, open
<code>nucleus-capture.js</code>, copy all of it, click the <code>&gt;</code> line and paste.
If Chrome answers <em>&ldquo;Type &lsquo;allow pasting&rsquo;&rdquo;</em>, type those two words, press
Return, and paste again &mdash; it asks only once. Then press Return.</div>
</body></html>
`,
);
console.log(`wrote ${BOOKMARKLET} (${href.length} characters)`);
console.log(`wrote ${OUT} (${readFileSync(OUT).length} bytes)`);
