# Chrome Web Store — BHB Office Robot

Upload `bhb-office-robot-<version>.zip`. Build it from this folder:
`zip -r bhb-office-robot-1.0.0.zip manifest.json background.js content.js content.css options.html options.js icons`.

Developer dashboard: https://chrome.google.com/webstore/devconsole. It needs a Google account and Google's
one-time US$5 developer registration fee. Register with the school's Workspace account so the listing belongs to the school.

## Store listing

- **Name:** BHB Office Robot
- **Summary (≤132):** For BHB International School staff: fills government portal forms (UDISE+ first) from the school ERP. You check and save.
- **Category:** Workflow & Planning
- **Language:** English
- **Description:**

  A staff tool for BHB International School (Varanasi). It saves office staff from re-typing details from the school ERP into government portals. It starts with the UDISE+ Student module; more portals will be added in later versions.

  How it works on UDISE+:
  1. Sign in to the school ERP and to UDISE+ yourself. The robot never signs in for you.
  2. On UDISE+, the robot's panel shows how many children still have an incomplete profile.
  3. Press "Start robot". It sends the portal's student list to the ERP, opens the first incomplete child's form, and fills the EMPTY fields from the ERP, outlined in yellow.
  4. Check the page, type what the ERP does not have, and press the portal's own Save. Then "Saved — next child".

  The robot never saves or submits on the portal, never runs in the background, and sends data only between UDISE+ and the school's own ERP. It is useful only to the school's staff.

- **Icon:** `icons/icon128.png`
- **Screenshots (1280×800, at least one):** take after installing. Suggested shots: the panel on the UDISE+ dashboard showing the count, and a form with yellow-filled fields. Blur children's names before uploading.

## Privacy practices tab

- **Single purpose:** Fill the school's government-portal forms (currently UDISE+) from the school's own ERP, and send the portal's records back to that ERP, when a staff member clicks.
- **Permission justification:**
  - `storage`: remembers the time of the last send and the list of children still to fill while staff work through them.
  - Host `https://bhbinternational.school/*`: the school's ERP, which supplies form values and receives the portal list, using the staff member's existing ERP sign-in.
  - Content script on `https://sdms.udiseplus.gov.in/g1/*`: shows the panel, reads the portal's own student list, and fills the open form.
- **Remote code:** No. All code ships in the package.
- **Data usage:** tick **Personally identifiable information** and **Website content**; leave every other type unticked. The data is used only for the extension's single purpose and is not sold or transferred to third parties.
- **Certify** the three statements (no sale, no unrelated use, no creditworthiness use).
- **Privacy policy URL:** https://bhbinternational.school/privacy/office-robot

## Distribution

- **Visibility: Unlisted.** Only people with the link can find it. Share the link with office staff.
  "Private" would limit it to the school's Google Workspace accounts, which works only if every office Chrome is signed in with an @bhbinternational.school account.
- **Regions:** India.

After review (usually a few days) the listing link looks like
`https://chromewebstore.google.com/detail/bhb-office-robot/<id>`.
Adding a portal = a new version: add its site under `content_scripts`, update the privacy page and this file, then raise `version` in `manifest.json`, rebuild the zip and upload it from the same dashboard.
