# The "Send to ERP" bookmark

The publisher's papers and answer keys are public files: once the ERP knows a
file's address it fetches it itself, for as long as that file exists. What it
cannot do is find the addresses, because they live behind the Nucleus login,
and that login is behind a captcha with no API to go around it.

So one person does the one thing only a signed-in person can: opens Nucleus
and clicks a bookmark. It reads whichever page it is on, copies the reading to
the clipboard, and downloads nothing.

| Page | What it reads | Where it is pasted |
|---|---|---|
| Assessments & Answer key | every paper's question-paper and answer-key address, plus what the publisher has and has not prepared | Exams → Question papers → **Get papers from Nucleus** |
| Teacher Timeliness | the day-plan table, cell by cell | Teaching → Nucleus → the timeliness box |

The timeliness reading is worth taking this way rather than copying the table:
the bookmark hands over the numbers themselves — 50 required, 10 done, out of
140 — instead of the sentence "36% Course (50/140 day plans)" for the ERP to
pull them back out of. Both still work; the paste box takes either.

It takes about twelve minutes for a full term of 108 papers, and far less when
only a few are new. It is safe to stop it at any point by closing the tab:
nothing in Nucleus is changed and nothing is saved to the computer.

## Setting it up, once

Open `nucleus-capture-install.html` in Chrome and drag the blue button onto the
bookmarks bar. That is the whole installation.

**Press ⇧⌘B first and check the bookmarks bar is actually visible.** If it is
not, there is nowhere for the button to land and the drag silently does
nothing — which looks exactly like a broken bookmarklet. This cost an afternoon
on 19 Sep 2026.

Dragging is preferred over copying the address out of
`nucleus-capture-bookmarklet.txt` because Chrome often strips the leading
`javascript:` on paste, and the bookmark then does nothing with no explanation.
If you do paste it, edit the bookmark afterwards and check the address still
begins `javascript:`.

If the bookmark will not install at all, the script runs perfectly well from
the Console: open `nucleus-capture.js`, copy it, press ⌥⌘J on the Nucleus page,
paste at the `>` line and press Return. Chrome asks you to type
`allow pasting` the first time on a site, and never again.

### Changing the script

Three files, one program:

| File | What it is |
|---|---|
| `nucleus-capture.js` | the readable source — comments and indentation |
| `nucleus-capture-bookmarklet.txt` | the same program stripped and percent-encoded; **this is what the office installs** |
| `nucleus-capture-install.html` | generated; carries the .txt as a draggable link |

The .txt is not generated from the .js — it was stripped by hand — so edit the
.js, rebuild the .txt, and then run:

```
node scripts/build-nucleus-install-page.mjs
```

which rebuilds the page from the .txt and refuses to write one if the
bookmarklet does not parse. Never generate the page from the .js: it would hand
the office a bookmark nobody has run.

## Using it

1. Open <https://nucleus.leadgroup.co.in> and sign in.
2. Go to the page you want — **Assessments & Answer key** or **Teacher
   Timeliness** — and let it finish loading.
3. Click **Send to ERP** in the bookmarks bar.
4. A small panel appears at the top right. On the papers page it walks the
   list (*Reading 14 of 108…*) and takes about twelve minutes; on the
   timeliness page it is instant. Leave the tab in front until it says it has
   copied.
5. Paste into the ERP and press the button there.

## What it does, and does not do

On the timeliness page it only reads the table already on screen. On the
papers page it visits each paper's own page in the same tab — exactly what a person would
do by hand — and reads the addresses the page already holds. It never downloads
a paper, never saves a file, and never sends anything anywhere: the only output
is text on the clipboard.

It reads only what the page says about the paper it has just opened, and checks
that the page really is showing that paper before believing it. An early
version of this did not, and produced a list in which one class's answer key
was filed against another class's paper. That check is why it is a little slow.

## When the clipboard is blocked

Running the script from the Console instead of the bookmark can end with
*"Done. Clipboard blocked — copy window.__nucleusCapture from the console."*
Nothing is lost: the browser refuses `clipboard.writeText` while the Console —
not the page — holds focus. Type `copy(window.__nucleusCapture)` at the `>`
line and press Return; DevTools' own `copy()` is not subject to that rule.

Clicking the bookmark leaves focus on the page, so this never arises. It is
the reason the bookmark is worth installing even though the Console works.
