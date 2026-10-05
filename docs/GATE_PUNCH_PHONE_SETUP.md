# Gate punch phone — one-time setup

A spare Android phone at the gate shows the staff punch QR. It opens and closes
by itself (Attendance → Staff → Manage → **Gate punch hours**, default
06:45–18:00, Mon–Sat). Nobody has to open it each morning.

## 1. Prepare the phone (5 minutes)
1. Charge it and keep it **on the charger at the gate** permanently. Connect it to the school Wi-Fi (or a SIM with data).
2. **Settings → Display → Screen timeout**: the longest available.
3. **Keep the screen on while charging**: Settings → About phone → tap *Build number* 7 times → back → Developer options → **Stay awake** ON.
4. **Location**: Settings → Location ON, mode *High accuracy*. The QR is shown only inside the school.
5. **Battery**: Settings → Apps → Chrome → Battery → *Unrestricted* (so Android does not put it to sleep).

## 2. Switch it on as the QR screen (no sign-in on the gate phone)
1. On the **gate phone**, open Chrome (or Fully Kiosk) → **bhbinternational.school/punch-screen**. Allow location when asked. It shows "Switch this phone on as the punch QR screen" and a code box.
2. On the **office** phone or computer: Attendance → Staff → **Manage** → *Punch phones & QR screens* → name it "Gate phone" → **Pair a gate screen**. A 6-digit code appears (valid 10 minutes, once).
3. Type that code on the gate phone → **Pair this phone**. It now shows the QR (or a clock and "Punch QR opens at 06:45").
   - Nobody signs in on the gate phone, and it can only show the QR — no ERP menus or data.
   - Lost or replaced phone: Manage → QR screens → **Switch off**.
4. Chrome menu → **Add to Home screen**, so a reboot is one tap to reopen. (Using Fully Kiosk: do steps 1–3 inside Fully — it keeps its own storage.)

## 3. Lock it to that screen (recommended)
- **Free:** Settings → Security → **App pinning / Screen pinning** ON, then pin Chrome on the QR page. Nobody can leave the page without the phone's PIN.
- **Better (≈ ₹600 once):** *Fully Kiosk Browser* from the Play Store → start URL = the QR page, *Launch on boot* ON, *Keep screen on* ON, *Enable geolocation* ON. It reopens itself after a power cut.

## 4. Printed backup QR
Attendance → Staff → Manage → **Printed gate QR** → tick *Allow punching with the printed QR* → **Print gate QR**. Laminate it and paste it beside the gate phone.
- Punches with it need the staff member's own registered phone, GPS within ±50 m inside the campus and the punch hours, and show as **"Printed gate QR"** in the register.
- **Every month** (or if a photo of it is shared): **New printed QR** → print → replace. Old prints stop working at once.

## If something is wrong
| The gate phone shows | Do this |
|---|---|
| "Switch this phone on as the punch QR screen" | Repeat step 2 with a new pairing code (the office switched it off, or the browser's data was cleared). |
| "Punch QR not available here" | Location is off or poor — turn Location on, move the phone nearer a window. |
| A clock and "opens at …" | Normal outside punch hours. |
| "No connection" | Check the Wi-Fi / data; the code returns by itself. |
