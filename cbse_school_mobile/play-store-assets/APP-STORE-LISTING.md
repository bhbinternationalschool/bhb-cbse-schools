# BHB International School — Apple App Store submission pack

The iOS counterpart to the Play Store pack. Same app, Apple's process.
You create the account and (with me) run the Xcode build; copy-paste the
text below into App Store Connect.

---

## 0. What's ready in this folder

| File | App Store Connect field |
|---|---|
| `ios-screenshots/1..5.png` (1290×2796, 6.7") | App Store → Screenshots (iPhone 6.7") |
| `icon-512.png` → export 1024 from `assets/icon` | icon is embedded in the build; a 1024 marketing icon is auto-pulled from the app |

The iOS app icon (crest) and display name ("BHB International School") are
already set in the project. Bundle ID: **school.bhbinternational.cbseSchoolMobile**.
Privacy policy (live): **https://bhbinternational.school/privacy**

> Note on screenshots: the app is Flutter — the iOS UI is pixel-identical to
> what's shown. If Apple's reviewer asks for true on-device captures, we can
> reshoot on the iOS Simulator once the account exists; these framed 6.7"
> images are correctly sized and represent the app faithfully.

---

## 1. Apple Developer account — you must do this (slowest step, start now)

1. **developer.apple.com/programs/enroll** — **$99/year**.
2. Enrol as an **Organization** (shows the school as seller, not a person).
   This requires a **D-U-N-S number** for the school — free from Dun &
   Bradstreet but can take **days to a couple of weeks** in India. Check if
   the trust already has one before requesting a new one.
   - Faster alternative: enrol as an **Individual** (your name as seller) —
     no D-U-N-S, approved in ~1 day. You can't easily change seller type
     later, so decide up front. For a school, Organization is the right look.
3. Once approved, accept the latest agreements in **App Store Connect**.

---

## 2. Create the app record (App Store Connect → Apps → +)

- **Platform:** iOS
- **Name:** BHB International School
- **Primary language:** English (India)
- **Bundle ID:** school.bhbinternational.cbseSchoolMobile (select/register it)
- **SKU:** bhb-school-app-001 (any unique string)

---

## 3. App Store listing — copy/paste

**Name (30 char max)**
```
BHB International School
```

**Subtitle (30 char max)**
```
Fees, homework & school ID
```

**Promotional text (170 char, editable anytime)**
```
Stay connected with BHB International School — fees, attendance, homework, notices, PTM bookings and your child's digital ID, all in one place.
```

**Description (4000 char max)**
```
The official app of BHB International School, Varanasi — for parents, guardians and staff.

Parents stay on top of school life without a single call to the office:

• Fees — see exactly what's due, broken down installment by installment, for each child.
• Attendance — a day-by-day record of your child's presence, updated the moment the class teacher marks the register.
• Homework & diary — every assignment and class-diary note your child's teacher posts, in one feed.
• Notices & news — school circulars and announcements as they're published.
• Parent–teacher meetings — see scheduled PTMs and book your slot in a tap.
• Digital student ID — a QR code of your child's admission number, ready at the school gate, library or fee counter.

Teachers get their daily tools in their pocket:

• Mark class attendance in seconds — the whole section on one screen, everyone present by default, tap only the exceptions.
• GPS self-attendance — punch in and out from campus, with the app confirming you're on school premises before it submits.
• Post homework to a class, view student rosters, and read staff notices.

Built for BHB International School only. Sign-in is secure: parents verify with a one-time code sent to the mobile number registered with the school; staff sign in with their school email. You only ever see your own family's information.

Fees shown in the app can be paid at the school office (cash, UPI or cheque) — online payment is on the way.

Questions or corrections to your records? Contact the school office.
```

**Keywords (100 char max, comma-separated)**
```
school,parent,student,attendance,homework,fees,BHB,education,PTM,report card,varanasi,teacher
```

**Support URL:** https://bhbinternational.school
**Marketing URL:** https://bhbinternational.school
**Privacy Policy URL:** https://bhbinternational.school/privacy
**Category:** Primary **Education**, Secondary (optional) Productivity

---

## 4. App Privacy (App Store Connect → App Privacy) — the "nutrition labels"

Declare data collected. Mirror of the Play data-safety answers:

- **Contact Info → Phone Number** — Linked to identity. Used for **App
  Functionality** (OTP sign-in, linking to household). Not used for tracking.
- **Contact Info → Name** — Linked. **App Functionality**.
- **Location → Precise Location** — Linked. **App Functionality** (staff
  on-campus attendance punch, only when the user taps punch). Not tracking.
- **Financial Info → Other Financial Info** (fee dues/receipts; NO card data)
  — Linked. **App Functionality**.
- **Identifiers → User ID** (household/staff id in the session) — Linked. **App
  Functionality**.

**Tracking:** No. **Data used to track you:** None. **Third-party ads:** No.
**Data is encrypted in transit:** Yes.

---

## 5. Age rating

Answer the questionnaire **No** to all mature-content items → results in
**4+**. This is not a "Kids Category" app (it's used by parents/staff); do
NOT tick the Kids Category.

---

## 6. Sign-in info for App Review (App Store Connect → App Review Information)

Apple's reviewer must be able to log in. They can't get a WhatsApp OTP, so
provide the review credential:
1. Before submitting, I set `REVIEW_LOGIN_MOBILE` / `REVIEW_LOGIN_CODE` /
   `REVIEW_LOGIN_HOUSEHOLD_ID` on the Cloud Run service (say the word).
2. In App Review Information → **Sign-in required** → provide:
   - User name: the REVIEW_LOGIN_MOBILE value
   - Password: the REVIEW_LOGIN_CODE value
   - Notes: "Select 'Parent', enter the mobile number in the field, tap Send
     OTP is not needed — enter the code above. This is a demo review household."
   (If the current app requires tapping Send OTP first, tell the reviewer to
   use the exact mobile+code pair, which bypasses OTP server-side.)

**Export Compliance:** the app uses only standard HTTPS encryption →
answer "Yes" to encryption, then "Yes, exempt" (standard iOS exemption).

---

## 7. Building & uploading the .ipa (needs the account + this Mac)

This is the part that can't be done until the Apple account exists, because
Apple requires signing certificates tied to the account. Once enrolled:
1. On this Mac: `open ios/Runner.xcworkspace` (Xcode), sign in with the Apple
   account under Signing & Capabilities, let it auto-manage signing.
2. `flutter build ipa --dart-define=API_BASE_URL=https://bhbinternational.school`
3. Upload the `.ipa` via **Xcode → Organizer** or **Transporter** app.
4. In App Store Connect, attach the uploaded build to the version, then
   **Submit for Review**. First review is typically 1–3 days (often one
   round of feedback).

I can drive steps 2–4 with you once the account is live.

---

## 8. Faster path: TestFlight first (recommended)

Same uploaded build, but distribute as a **beta** before the public store:
- **Internal testing:** up to 100 people on your team, no Apple review, instant.
- **External testing:** up to **10,000** parents via a public TestFlight link;
  needs a light "beta review" (~1 day). Builds expire after 90 days (re-upload).

TestFlight lets the whole school try the iPhone app within days of the account
being ready, while the full App Store review proceeds in parallel.

---

## 9. Reality check on timing

The **D-U-N-S + Developer enrolment is the long pole** (days–weeks). Everything
Apple-side downstream (listing, build, review) is fast once that clears. Start
the enrolment today; the rest waits on it.
