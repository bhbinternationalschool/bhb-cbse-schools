# BHB UDISE+ Bridge (Chrome extension)

Browser bridge between the school ERP and **UDISE+ SDMS**. Autofills login from the ERP encrypted vault, leaves CAPTCHA for manual entry, and captures **Students_Details** Excel exports back into SIS.

## Install (unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder:  
   `apps/udise-bridge-extension`
4. Copy the **Extension ID** (32-char string on the card)
5. In ERP: **Students → UDISE+ → Bridge** → paste Extension ID → **Save bridge settings** → **Detect extension**

## ERP vault (required)

1. On the same Bridge panel, enter UDISE username, password, school UDISE code
2. Choose a **passphrase** (not stored — only encrypts the vault)
3. **Save encrypted vault** → **Unlock** when starting office work (session ~45 min)

Credentials stay in the browser: ciphertext in `localStorage`, plaintext only in `sessionStorage` while unlocked.

## Workflow

### Open login (autofill)

1. Unlock vault in ERP
2. Click **Open UDISE+ (autofill)**  
   Extension opens `https://sdms.udiseplus.gov.in/p2/v1/login`, fills username/password
3. **Solve CAPTCHA manually** → Sign in

### Pull Students_Details

1. After login, go to **Students List** on SDMS
2. Click **Export / Download** (Excel) as you normally would
3. Extension intercepts the spreadsheet response and posts it to the ERP tab
4. ERP runs the same sync as manual file upload (`applyUdiseStudentDetailsSync`)

Or click **Pull Students_Details via bridge** first — it focuses SDMS and arms capture; then export from the portal.

## Network probe (discovery)

Toggle **Network probe** in ERP or the extension popup. While browsing SDMS, URLs are logged (no passwords) to help map internal endpoints. See [docs/sdms-endpoints.md](docs/sdms-endpoints.md).

## Security notes

- Use only your **school’s own** UDISE+ account
- CAPTCHA is **never** automated
- Passphrase is never sent to the extension; only username/password during an unlocked session
- Extension is `externally_connectable` only to localhost and `*.bhbinternational.school`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Extension not detected | Reload extension; verify Extension ID; use Chrome (not Safari) |
| Autofill empty | Unlock vault; re-open login from ERP |
| No sync after export | Stay on ERP tab; export again; check SDMS export is `.xlsx` |
| Wrong passphrase | Re-save vault with new passphrase (needs password re-entered) |

## Development

- MV3 service worker: `background/service-worker.js`
- Message protocol: `lib/bridge-protocol.js` (keep in sync with `apps/web/src/lib/udiseBridge.ts`)
