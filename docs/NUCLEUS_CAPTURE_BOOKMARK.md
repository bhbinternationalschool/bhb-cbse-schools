# The "Send papers to ERP" bookmark

The publisher's papers and answer keys are public files: once the ERP knows a
file's address it fetches it itself, for as long as that file exists. What it
cannot do is find the addresses, because they live behind the Nucleus login,
and that login is behind a captcha with no API to go around it.

So one person, once a term, does the one thing only a signed-in person can:
opens Nucleus and clicks a bookmark. The bookmark reads the addresses of every
paper the school has, copies them to the clipboard, and downloads nothing. The
ERP does the rest — see **Exams → Question papers → Get papers from Nucleus**.

It takes about twelve minutes for a full term of 108 papers, and far less when
only a few are new. It is safe to stop it at any point by closing the tab:
nothing in Nucleus is changed and nothing is saved to the computer.

## Setting it up, once

1. In Chrome, show the bookmarks bar (⇧⌘B).
2. Right-click the bar → **Add page…**
3. Name: `Send papers to ERP`
4. URL: paste the whole line from `nucleus-capture-bookmarklet.txt` — it begins
   `javascript:` and is one very long line.
5. Save.

Chrome sometimes strips the leading `javascript:` when pasting. If the bookmark
does nothing, edit it and check that the address still starts with `javascript:`.

## Using it

1. Open <https://nucleus.leadgroup.co.in> and sign in.
2. Go to **Assessments & Answer key** and let the table finish loading.
3. Click **Send papers to ERP** in the bookmarks bar.
4. A small panel appears at the top right with progress: *Reading 14 of 108…*
   Leave the tab in front until it says it has copied.
5. Switch to the ERP → **Exams → Question papers → Get papers from Nucleus →
   Paste a capture**, paste (⌘V), press **Read capture**, check the table, then
   press **Get**.

## What it does, and does not do

It visits each paper's own page in the same tab — exactly what a person would
do by hand — and reads the addresses the page already holds. It never downloads
a paper, never saves a file, and never sends anything anywhere: the only output
is text on the clipboard.

It reads only what the page says about the paper it has just opened, and checks
that the page really is showing that paper before believing it. An early
version of this did not, and produced a list in which one class's answer key
was filed against another class's paper. That check is why it is a little slow.
