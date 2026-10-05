# BHB UDISE Robot (Chrome extension)

Works beside the UDISE+ Student module (sdms.udiseplus.gov.in). It acts **only when someone clicks**:
there are no timers and no background pulls. A person always logs in to the portal
(captcha/OTP) and always presses the portal's own **Save**.

| Button (bottom-right of portal pages) | What it does |
|---|---|
| **Send portal list to ERP** | Reads the portal's current-year student list in your logged-in tab and sends it to ERP → Students → UDISE+. There you review it and press **Apply**, the same as with an uploaded Excel. The full APAAR ID comes through (the Excel export masks it). Aadhaar arrives masked. |
| **Fill this form from ERP** | On a child's profile form (GP/EP/FP), finds the child by PEN, checks the portal name matches the ERP, then types the ERP's values into **empty** fields only and outlines each one in yellow. It lists what it left alone and what the ERP does not know. It never saves. |

## Install (once per office computer)

1. Chrome → `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → choose this `extensions/udise-robot` folder.
3. Log in to the ERP (https://bhbinternational.school) in the same Chrome. The robot uses that login.
   Your role needs **Compliance · edit**.
4. Click the robot icon: it should say "✓ ERP login: …".

## Where the ERP side lives

- `POST /api/v1/udise/robot/sync` → `apps/web/src/lib/udiseRobotSync.server.ts`; mapping in `lib/udisePortalApi.ts`
- `GET /api/v1/udise/robot/fill?pen=` → `lib/udisePortalFill.ts`
- The field whitelist in `background.js` must match `UDISE_PORTAL_FIELDS` in `lib/udisePortalApi.ts`.
