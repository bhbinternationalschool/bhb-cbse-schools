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

## 2. Switch it on as the QR screen
1. On that phone, open Chrome → **bhbinternational.school**, sign in with an **office / principal** login.
2. Attendance → Staff → **Manage** → *Punch phones & QR screens* → name it "Gate phone" → **Open QR screen on this device**. Allow location when asked.
3. It now shows the QR (or a clock and "Punch QR opens at 06:45"). You can sign out of the ERP; the screen keeps working (it has its own key).
4. Chrome menu → **Add to Home screen**, so a reboot is one tap to reopen.

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
| "This screen is not switched on" | Repeat step 2 (the office switched it off, or Chrome data was cleared). |
| "Punch QR not available here" | Location is off or poor — turn Location on, move the phone nearer a window. |
| A clock and "opens at …" | Normal outside punch hours. |
| "No connection" | Check the Wi-Fi / data; the code returns by itself. |
