# BHB International School — Google Play Store submission pack

> **Read first (2026-09-04): the app that goes on Play is the PARENT app.**
> The codebase now builds two apps (commit 590f17c). Only the parent one is
> submitted to Play; the staff app stays on the download page as an APK,
> because its background-location, microphone and camera use would put every
> release through Play's restricted-permission review.
>
> | | Parent app (Play) | Staff app (download page) |
> |---|---|---|
> | Package | `school.bhbinternational.parent` | `school.bhbinternational.cbse_school_mobile` |
> | Label | BHB School — Parents | BHB School — Staff |
> | Build | `scripts/build.sh parent appbundle` | `scripts/build.sh staff apk` |
> | Permissions | INTERNET, POST_NOTIFICATIONS only | + location, background location, audio |
>
> Before the first parent build, register the package with Firebase once:
> `scripts/register-parent-firebase-app.sh` (needs a live `gcloud auth login`).
>
> What this changes in the pack below:
> - `app-release.aab` in this folder is the OLD combined app — do not upload
>   it. Upload `build/app/outputs/bundle/parentRelease/app-parent-release.aab`.
> - Section 3, full description: drop the "Teachers get their daily tools"
>   paragraph and its three bullets; the parent app has none of them.
> - Section 4, data safety: drop the **Location** row. The parent app never
>   asks for location, and declaring it invites the review the split avoids.
> - Play's sensitive-permission declaration forms never come up: the parent
>   AAB carries no location, microphone or camera permission.
> - Screenshots: retake from the parent build; teacher screens must not appear.


Everything needed to publish. You create the account and click the buttons;
copy-paste the text below into each field.

---

## 0. What's in this folder

| File | Play Console field |
|---|---|
| `app-release.aab` | **Stale — old combined app.** Upload the parent AAB from `scripts/build.sh parent appbundle` instead |
| `icon-512.png` (512×512) | Store listing → App icon |
| `feature-graphic-1024x500.png` | Store listing → Feature graphic |
| `screenshots/1..5.png` (1080×2400) | Store listing → Phone screenshots |

Privacy policy URL (already live): **https://bhbinternational.school/privacy**

---

## 1. Create the account (you must do this — needs school documents + payment)

1. Go to **play.google.com/console** → sign in with the school's Google account
   (director@bhbinternational.school is fine).
2. Choose **Organization** account (not personal) — a personal account created
   now would force a 14-day / 12-tester closed test before you can go public;
   organization skips that. Organization accounts need a **D-U-N-S number**
   for the school (free from Dun & Bradstreet India, dnb.co.in — can take up to
   30 days, so start this first; if the school/trust already has one, use it).
3. Pay the **one-time US$25** (international card). Identity/organization
   verification can take 1–3 days after documents are submitted.

---

## 2. Create the app

- **App name:** BHB International School
- **Default language:** English (India) – en-IN
- **App or game:** App
- **Free or paid:** Free
- Declarations: it is not a game; you'll accept the developer program policies.

---

## 3. Store listing — copy/paste

**App name (30 char max)**
```
BHB International School
```

**Short description (80 char max)**
```
Fees, attendance, homework, notices & digital ID for BHB parents and staff.
```

**Full description (4000 char max)**
```
The official app of BHB International School, Varanasi — for parents, guardians and staff.

Parents stay on top of school life without a single phone call to the office:

• Fees — see exactly what's due, broken down installment by installment, for each child.
• Attendance — a day-by-day record of your child's presence, updated the moment the class teacher marks the register.
• Homework & diary — every assignment and class-diary note your child's teacher posts, in one feed.
• Notices & news — school circulars and announcements as they're published.
• Parent–teacher meetings — see scheduled PTMs and book your slot in a tap.
• Digital student ID — a QR code of your child's admission number, ready at the school gate, library or fee counter. No more forgotten ID cards.
• Push notifications — homework, absence alerts, fee receipts, notices and messages from the class teacher reach your phone the moment they're posted.

Teachers get their daily tools in their pocket:

• Mark class attendance in seconds — the whole section on one screen, everyone present by default, tap only the exceptions.
• GPS self-attendance — punch in and out from campus, with the app confirming you're on school premises before it submits.
• Post homework to a class, view student rosters, and read staff notices.

Built for BHB International School only. Sign in is secure: parents verify with a one-time code sent to the mobile number registered with the school; staff sign in with their school email. You only ever see your own family's information.

Fees shown in the app can be paid at the school office (cash, UPI or cheque) — online payment is on the way.

Questions or corrections to your records? Contact the school office.
```

**App category:** Education
**Tags:** education, school, parents
**Contact email:** director@bhbinternational.school
**Website:** https://bhbinternational.school
**Privacy Policy:** https://bhbinternational.school/privacy

---

## 4. Data safety form (Play Console → App content → Data safety)

Answer the questionnaire like this — it matches what the app actually does:

**Does your app collect or share any of the required user data types?** → **Yes**

Data collected:
- **Personal info → Phone number** — Collected, NOT shared. Purpose: **App
  functionality, Account management** (used to send the sign-in OTP and link
  the parent to their household). Not processed ephemerally; required.
- **Personal info → Name** — Collected, NOT shared. Purpose: **App
  functionality** (student/guardian name shown in the app). Required.
- **Location → Approximate/Precise location** — Collected, NOT shared.
  Purpose: **App functionality** (staff attendance punch confirms on-campus).
  **Optional** (only when a staff member chooses to punch). Not for ads.
- **Financial info → Other financial info** (fee dues/receipts, no payment
  card data) — Collected, NOT shared. Purpose: **App functionality**. Required.
- **Device or other IDs** — Collected, NOT shared. Purpose: **App
  functionality** (the Firebase Cloud Messaging push token that lets the school
  send notifications to this phone; deleted on sign-out). Required.

**Is all data encrypted in transit?** → **Yes**
**Do you provide a way to request data deletion?** → **Yes** — via the school
office (state this; accounts are school-provisioned).
**Is data collected only from users you have a relationship with (students of
the school)?** → Yes.

Advertising ID: **No**. Third-party ads: **No**. Data sold: **No**.

---

## 5. Content rating (App content → Content rating)

- Category: **Reference, News, or Educational**
- Answer **No** to all violence/sexual/gambling/drug questions.
- No user-generated content shared publicly (homework/notices are school-posted).
- Expected result: **Rated for 3+ / Everyone**.

## 6. Target audience

- Target age: **18+** (the app is used by parents and staff, not children).
- Do NOT enrol in "Designed for Families" — that triggers a stricter children's
  policy track this app doesn't need. Student records are school records shown
  to adults.

## 7. App access (for the reviewer)

The reviewer can't receive a WhatsApp OTP, so give them the review login:
1. Before submitting, set these env vars on the Cloud Run service
   `school-erp-web` (I can do this on your go):
   `REVIEW_LOGIN_MOBILE`, `REVIEW_LOGIN_CODE`, `REVIEW_LOGIN_HOUSEHOLD_ID`.
2. In Play Console → App access → **All functionality requires sign-in**, add:
   - Instructions: "Choose Parent, enter the mobile number and OTP below."
   - Username: the REVIEW_LOGIN_MOBILE value
   - Password: the REVIEW_LOGIN_CODE value

---

## 8. Release

1. **Production → Create new release.**
2. Play App Signing: **accept** (Google manages the app signing key; the
   keystore in this repo is your *upload* key). Keep the upload keystore backed
   up — see below.
3. Upload **app-release.aab**.
4. Release name: `1.0.1 (2)`. Release notes: "First release — fees,
   attendance, homework, notices, PTM, digital student ID, staff attendance,
   push notifications."
5. Review summary → **Start rollout to Production.** Review is usually 1–7 days.

**Tip:** consider **Testing → Internal testing** first — same AAB, a private
link for up to 100 people, installs like the real store, live in minutes. Good
for trying it with a few families before the public rollout.

---

## 9. CRITICAL — back up the signing keystore

`cbse_school_mobile/android/upload-keystore.jks` + `key.properties` are your
**upload key**. If this Mac is lost and these aren't backed up, you can still
recover via Play App Signing (Google holds the real key), but keep them safe
anyway — store both in the school's password manager. Never commit them to git.


## Microphone (parent app, added 2026-09-05)

The parent app now requests `RECORD_AUDIO` at runtime, only when a parent taps the mic in the AI tutor to speak a question. Recognition uses the phone's own speech service (Google speech recogniser); the app does not record, store or upload audio. Data safety form: no audio collected by the app. No Play permission declaration form is required for the microphone.
