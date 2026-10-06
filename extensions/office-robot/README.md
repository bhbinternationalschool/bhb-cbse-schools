# BHB Office Robot (Chrome extension)

Works beside the UDISE+ Student module (sdms.udiseplus.gov.in). **Every move starts with a person's click.**
A person always signs in to the portal (captcha/OTP) and always presses the portal's own **Save**.
There are no timers and no background work.

## What staff see

After signing in to UDISE+, a panel at the bottom right says how many children still have an incomplete profile.

| Button | What it does |
|---|---|
| **Start robot** | Sends the portal's current-year list to ERP → Students → UDISE+ (review and **Apply** there). Then it opens the first incomplete child's form (GP/EP/FP) and fills the **empty** fields from the ERP, outlined in yellow. |
| **Saved — next child ▶** | After you have checked the form and pressed the portal's Save, this opens and fills the next child. |
| **Skip this child** / **Stop robot** | Moves past a child / clears the queue. |
| **Add missing children to UDISE+** | On the School Dashboard: the ERP children with no PEN **and a valid Aadhaar** (UDISE+ makes Aadhaar mandatory to add a student, rule 4.1.7), only in classes whose **Add Student** button the portal is showing (on 6 Oct 2026: Nursery–Class I). It skips anyone already on the portal by name + birth date or name + father. Before each child it **searches all of UDISE+** (the portal's Global Student Search): by name + Aadhaar last 4 if the ERP has the Aadhaar, and by name + date of birth + father + mother. It only counts hits that agree on the name and on birth date or a parent. If the child is already in our school, it says apply the portal list in the ERP. If the child is at another school, it shows that school, its UDISE code and the PEN, and says to bring the child in by transfer. If there are only near-matches, it lists them and offers "Not the same child — add anyway". If the search fails, it never assumes "not found". Only a child found nowhere gets a fresh Add Student form. It is opened with that class's own dashboard button, because the form takes its class from the button, not the address. The robot checks the form's class header before typing. You check, handle any "similar student" warning, and press Save. **Saved — next child** moves on. |
| **Only send portal list to ERP** | Just the send, no forms. |
| **Fill this form from ERP** | Fills whichever child's form is open, outside the queue. |

Safety rules built in:
- A child is found by **PEN**, and the robot refuses if the portal and ERP first names differ.
- It fills **empty** fields only and never overwrites what is on the portal. Date boxes that do not keep the typed date are cleared and listed for you.
- On 6 Oct 2026 the portal allowed **only the General Profile (GP) to be saved**; EP/FP values the robot types may not save until the portal opens them.
- It types only values the ERP really holds, and lists the rest for you to type.
- Aadhaar stays masked.

## Install

- **From the Chrome Web Store (unlisted link):** click the link the office was given, then **Add to Chrome**.
- **Developer install:** `chrome://extensions` → Developer mode → **Load unpacked** → this folder.

Then sign in to the ERP (https://bhbinternational.school) in the same Chrome profile. Your role needs **Compliance / UDISE · edit**.
Click the robot icon in the toolbar: it should say "✓ ERP login: …".

Works in desktop Chrome, Edge or Brave. Not on phones. The ERP and the portal must be open in the same browser profile.

## Publishing

See `STORE_LISTING.md`. Privacy policy: https://bhbinternational.school/privacy/office-robot (`apps/web/src/app/privacy/office-robot/page.tsx`).

## ERP side

- `POST /api/v1/udise/robot/sync` → `apps/web/src/lib/udiseRobotSync.server.ts`; mapping in `lib/udisePortalApi.ts`
- `GET /api/v1/udise/robot/fill?pen=` → `lib/udisePortalFill.ts`
- The field whitelist in `background.js` must match `UDISE_PORTAL_FIELDS` in `lib/udisePortalApi.ts`.
