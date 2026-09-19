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

1. In Chrome, show the bookmarks bar (⇧⌘B).
2. Right-click the bar → **Add page…**
3. Name: `Send to ERP`
4. URL: paste the whole line from `nucleus-capture-bookmarklet.txt` — it begins
   `javascript:` and is one very long line.
5. Save.

Chrome sometimes strips the leading `javascript:` when pasting. If the bookmark
does nothing, edit it and check that the address still starts with `javascript:`.

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
