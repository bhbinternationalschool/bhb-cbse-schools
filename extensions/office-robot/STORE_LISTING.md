# Chrome Web Store — BHB Office Robot (version 1.5.0)

Developer dashboard: https://chrome.google.com/webstore/devconsole → BHB Office Robot
(item id `kajdmnaicmdapckbapocgjkbjmejiioh`).

**To publish a new version:** Package → Upload new package → `bhb-office-robot-<version>.zip`
(build it from this folder: `zip -r bhb-office-robot-1.5.0.zip manifest.json background.js content.js
content-teacher.js content-profile.js content-propel.js content-erp.js portal-fields.js content.css options.html options.js icons`),
then update the Store listing and Privacy practices tabs below, then "Submit for review".
The listing link and the installs stay the same; Chrome updates installed copies by itself after approval.

## Store listing tab

- **Name** (from the manifest): BHB Office Robot
- **Summary** (from the manifest, ≤132): BHB International School staff: syncs UDISE+ and Propel with the ERP, and checks Pinnacle books' chapters. You check and save.
- **Category:** Workflow & Planning
- **Language:** English
- **Description** (paste):

```
A staff tool for BHB International School (Varanasi). It saves the school office from re-typing between the school's own ERP and the UDISE+ portals — in both directions — and it never presses Save or Submit on the portal.

On the UDISE+ Student module:
• Start robot: opens each incomplete child's profile and fills the EMPTY boxes from the ERP, outlined in yellow.
• One-click: you press the portal's own Save; the robot closes the message, goes to the next step, then opens and fills the next child.
• Add missing children (where the portal allows it), after searching the whole of UDISE+ so no child is entered twice.
• APAAR: fills the consent page for children whose family consented in the ERP.
• Fetch all children's details to ERP: brings each child's UDISE+ record into the ERP, where staff review what is missing or different and apply only what they tick.
• Find PENs: searches UDISE+ for ERP children without a PEN.
• Check the children on this page: marks each row of a release-request or Dropbox list with what the ERP says (still studying here / left).

On the UDISE+ Teacher module: compares the staff list with the ERP, brings teacher details into the ERP for review, fills empty boxes, and helps add staff missing from the portal.

On the UDISE+ School Profile module: copies each section into the ERP and fills empty boxes from the ERP or last year's answers, marked for checking.

On the school's Propel / LEAD Nucleus portal: checks the academic calendar and staff list against the ERP, then — after you confirm the list on screen — adds the missing holidays, exams (as Offline assessments) and teacher logins; fills Propel's own student upload sheet for you to upload; and brings Propel's question papers, their chapters and each teacher's course progress into the ERP. It never edits, deactivates or deletes anything already on Propel.

On Pinnacle Smart Teach (the publisher's teacher site for the school's books): reads each book's table of contents in the Book Library and shows which chapters differ from the school ERP's book list. It saves nothing on Smart Teach.

You sign in yourself; the robot never signs in, never presses Save / Submit / Approve on UDISE+, saves on Propel only what you confirm, runs nothing in the background, and sends data only between these portals and the school's own ERP. It is useful only to the school's staff.
```

- **Icon:** `icons/icon128.png`
- **Screenshots** (1280×800): the existing one is fine; optional new ones — the panel on the UDISE+ dashboard and the ERP's "Robot — Portal ↔ ERP" review. Blur children's names.

## Privacy practices tab

- **Single purpose** (paste):
  `Moves the school's own records between the UDISE+ portals (Student, Teacher and School Profile modules), the school's Propel / LEAD Nucleus portal, the Pinnacle Smart Teach book library and the school's ERP, in both directions, only when a staff member clicks — so office staff do not re-type them.`
- **Permission justification:**
  - `storage`: remembers the last send time, the list of children still to do while staff work through them, and whether One-click is on.
  - Host `https://bhbinternational.school/*`: the school's ERP — it supplies form values and receives the portal's records for staff review, using the staff member's own ERP sign-in; on ERP pages the extension only marks its version so the ERP can show it is installed.
  - Content scripts on `https://sdms.udiseplus.gov.in/g1/*`, `https://teacher.udiseplus.gov.in/*`, `https://profile.udiseplus.gov.in/*`: show the panel, read the school's own records that the portal shows the signed-in staff member, and fill the open form.
  - Content script on `https://nucleus.leadgroup.co.in/*` (the school's Propel / LEAD Nucleus portal): shows the panel, reads the school's calendar, staff list, subject list, blank student sheet, question papers and Teacher Timeliness through the portal's own API in the staff member's session, and — only after they confirm — adds the missing calendar entries and teacher logins.
  - Content script on `https://teacher.pinnaclelearning.in/*` (Pinnacle Smart Teach): shows the panel and, when the staff member clicks, reads the Book Library's book list and each book's table of contents (the e-book contents files on books-cdn.leadschool.in). Saves nothing there.
- **Remote code:** No. All code ships in the package.
- **Data usage — tick:** Personally identifiable information · Personal communications? **No** · **Website content** · leave health, financial, authentication, location, web history, user activity UNticked.
  (Staff mobile numbers and emails, children's names, dates of birth and parents' names are "personally identifiable information".)
- **Certify** the three statements (not sold; used only for the single purpose; not for creditworthiness).
- **Privacy policy URL:** https://bhbinternational.school/privacy/office-robot — deploy the ERP BEFORE submitting, so the page Google reads already describes this version.

## Distribution tab

- **Visibility: Unlisted** (only people with the link). **Regions:** India.
- Install link for staff: https://chromewebstore.google.com/detail/kajdmnaicmdapckbapocgjkbjmejiioh
  (also behind the "Install BHB Office Robot" button in ERP → Students → UDISE+).
- Every office computer at once: Google Admin → Devices → Chrome → Apps & extensions → Users & browsers →
  staff group → "+" → Add by ID `kajdmnaicmdapckbapocgjkbjmejiioh` → Force install.

Adding a portal = a new version: add its site under `content_scripts`, update the privacy page and this file,
raise `version` in `manifest.json`, rebuild the zip, upload, submit.
