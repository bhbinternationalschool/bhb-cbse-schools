# Staff GPS presence (2026-08-20)

**Where:** Staff → **GPS presence** (admin: live board, incidents, settings) and Staff → **My presence** (each staff member's sharing card).

**What it does:** during school timing on working days, enrolled staff phones send a GPS ping every few minutes from the open staff page. A server tick (Cloud Scheduler, every 5 min) evaluates everyone:
- outside the campus geofence beyond the grace period → **"Left premises"** incident;
- no ping for longer than the stale threshold (page closed, location off, phone off) → **"Location off"** incident;
- recovery → "Returned" / "Sharing resumed".
Each state change WhatsApps the configured recipients (owner, admin, principal) **once** — no repeat spam — and is logged with the alert delivery result.

**Mobile app (recommended, 2026-08-20):** the BHB staff app now has **School presence** (teacher home card / principal quick action). Staff tap "I agree — start sharing" once; an Android **foreground service** then pings every few minutes **even with the app closed and the screen off**, showing a permanent "School presence — sharing" notification (on-premises / distance / last-sent). The service reads the school's config each tick: outside school timing it does not touch the GPS at all; if the school disables the feature it idles; a logged-out session stops it; it restarts after a phone reboot. Staff must choose **"Allow all the time"** for location (Android 10+). Battery-saver settings on some phones (Xiaomi/Oppo/Vivo) can kill background services — staff should exempt the app from battery optimisation; a killed service simply looks like "location off" and is flagged, so the incentive is aligned. iOS is best-effort (foreground + short background).

**Honest limitation (web):** a phone browser only reports location while the page is open. Staff must keep the "My presence" page open (it takes a screen wake-lock). A closed page is indistinguishable from location-off — and is flagged as exactly that, which is the behaviour asked for. Thresholds (default: 20 min stale, 10 min outside grace, 150 m radius + 60 m GPS tolerance) absorb short phone locks; tighten or relax in settings.

**Privacy / DPDP (built in, deliberate):**
- Consent screen on each staff member's own phone before the first ping is accepted; consent list visible to admin.
- Tracking only inside the timing window on working days; staff marked absent/leave are skipped (toggleable).
- The server stores each staff member's **latest** position + incidents — not a movement trail.
- Staff see a visible "SHARING LOCATION" badge and can stop any time (stopping during school timing raises the location-off incident).
- Exempt list for management / staff on outdoor duty.
- **Inform staff in writing before enabling** — this is workplace attendance monitoring.

**Setup:**
1. Staff → GPS presence → set radius/timing/thresholds, add recipient mobiles, tick **Enable**, Save.
2. Ask staff to sign in to the **BHB staff app** and tap School presence → "I agree — start sharing" (choose "Allow all the time"), or use the web page Staff → My presence (page must stay open); their login must be linked to their staff record (Staff → Login).
3. `bash scripts/setup-cloud-scheduler.sh` (adds `bhb-staff-geo-tick`, every 5 min).

Tables: `staff_geo_last` (one row per staff, upserted), `staff_geo_incidents`; settings/consents in `module_local_state("staff_geo_settings")`. Migration `20260820090000_staff_geo` applied to prod.

**Anti-spoofing (2026-08-20) — honest scope:**
- WhatsApp punches: a searched/saved **place pin is rejected** (only a live "Send your current location" share, which carries no name/address, is accepted); GPS accuracy limit; geofence distance.
- App pings & app punches: Android's **mock-location flag is rejected** (fake-GPS apps set it; the app also refuses to start sharing while it is on) and a refused stream shows up as "location off" — flagged during school timing.
- **Teleport guard**: a ping implying > 150 km/h over ≥ 2 km versus the previous ping is rejected as spoofing.
- **Not covered** (nothing client-side honestly can): a rooted phone with a system-level spoofer that hides the mock flag, or a second phone left at school signed in. Mitigations are procedural: occasional physical checks, and the incident log showing patterns (e.g. always exactly on the fence edge).

