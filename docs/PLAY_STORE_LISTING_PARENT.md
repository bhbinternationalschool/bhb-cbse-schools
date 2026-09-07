# Google Play listing — BHB International School (parent app)

Everything below is copy-ready for the Play Console. Fields are in the order
the console asks for them. Character counts are given where Play enforces a
limit, so nothing has to be trimmed at paste time.

Package: `school.bhbinternational.parent`
Bundle: `cbse_school_mobile/build/app/outputs/bundle/parentRelease/app-parent-release.aab`
Version: `1.0.6 (7)`
Signing key: BHB upload key, SHA-256 `D5:34:08:9B:56:01:EE:54:96:75:34:46:F6:C4:40:AD:7B:1F:A8:45:BF:BA:3E:5C:DF:E8:C7:FD:DA:9A:6A:10`, valid to 28 Dec 2053.

---

## 1. Store listing

**App name** (30 max — this uses 24)

```
BHB International School
```

**Short description** (80 max — this uses 76)

```
Fees, attendance, homework and teacher messages for BHB parents, in one app.
```

**Full description** (4000 max — this uses 2,060)

```
BHB International School's official app for parents and guardians.

Sign in with the mobile number registered at the school office and you get your
child's day in one place: what was set as homework, whether they were marked
present, what the school has announced, and what is owed.

WHAT YOU CAN DO

Fees and receipts
• See the exact amount due, broken down by fee head, with due dates
• Pay online by UPI, card or net banking through our payment gateway
• Download every receipt, past and present, as a PDF
• Pay ahead for later instalments if you prefer to clear the year early

School day
• Attendance, day by day, with the month's total
• Homework as the class teacher sets it, subject by subject
• Notices and circulars, pushed to your phone the moment they are issued

Talking to the school
• Message your child's teachers between 8 AM and 8 PM on school days
• Apply for leave and see whether it was approved
• Raise a complaint and follow it to its answer
• Book a parent-teacher meeting slot

More
• Transport route, stop and timing for children who take the school bus
• E-books and reading material for your child's class
• An AI study helper that answers your child's questions on the syllabus, by
  typing or by speaking
• Photographs from school events

MORE THAN ONE CHILD

If you have more than one child in the school, all of them appear under the
same sign-in. Switch between them from the top of the home screen.

WHO CAN USE IT

Only parents and guardians on the school's admission records. Accounts are
created by the school office, not from the app, so there is no sign-up form to
fill in. Staff use a separate app.

ABOUT THE SCHOOL

BHB International School is at Piyamilan Chauraha, Baniyavapar, Ayar,
Varanasi, Uttar Pradesh 221202, and is run by Babu Harbansh Bahadur Singh
Smriti Vidya Nyas, a trust registered at Varanasi. The school is recognised by
the State Government of Uttar Pradesh for Nursery to Class VIII.

Office: Monday to Saturday, 8:00 AM – 3:00 PM IST.
Email: director@bhbinternational.school
Phone: +91 94519 38805
```

> **The trust's name is spelled HARBANSH here, with the h.** That is how the
> deed of declaration spells it and how the D-U-N-S number was allotted, so it
> is the developer name Play prints under the app title. The school's website
> spells it HARBANS, without the h, because that is the PAN spelling and the
> payment gateway verifies the merchant against the Income Tax database. Both
> are the same trust; the About page says so. Do not "fix" either one to match
> the other — correct the PAN first, then the site, then this.

**App icon** — 512×512 PNG, the school crest already used as the launcher icon.

**Feature graphic** — 1024×500 PNG. Not yet made. Crest on the school's deep
blue with the line "One app for fees, attendance and homework".

**Phone screenshots** — 2 minimum, 8 allowed, 16:9 or 9:16, min 320 px on the
short edge. Capture these from the parent app running on a device or emulator:
home with a child selected, fee dues, a receipt, attendance, homework, teacher
chat, transport.

**Category** — Education
**Tags** — Education, Parenting
**Contact details** — email `director@bhbinternational.school`, phone
`+91 94519 38805`, website `https://bhbinternational.school`
**Privacy policy** — `https://bhbinternational.school/privacy`

---

## 2. App content declarations

### Privacy policy
`https://bhbinternational.school/privacy`

### Data deletion
Play requires a URL, reachable without signing in, for account and data
deletion requests:
`https://bhbinternational.school/data-deletion`

Answer "users can request account deletion" and give that URL. There is no
in-app delete button; the page explains that requests go to the office, which
is permitted as long as the URL is published.

### Ads
No ads. The app carries no advertising and no ad SDK.

### App access
All functionality is behind a sign-in, and accounts are issued by the school.
Play needs working credentials to review it. Provide, in the "App access"
section: a real parent mobile number and its one-time password path, or a
demo parent account created for the purpose. **Create a dedicated review
account rather than handing over a real family's login.**

### Content rating (IARC questionnaire)
Answer "no" to violence, sexuality, language, controlled substances, gambling,
and user-generated content shared publicly. Teacher messaging is private
one-to-one messaging with school staff, not a public social feature.
Expected outcome: **Everyone / PEGI 3 / rated for all ages.**

### Target audience and content
Target age group: **18 and over.** The app is for parents and guardians. It is
not designed for or directed at children, so it is not in the Families
programme and does not need a Families ad-policy declaration. Say "no" to
"could the app be appealing to children".

### News app
No.

### COVID-19 contact tracing and status apps
No.

### Data safety

Collected, linked to the user, **not** shared with third parties for
advertising, all encrypted in transit, deletion can be requested:

| Data type | Collected | Purpose | Optional? |
|---|---|---|---|
| Name | Yes | App functionality, account management | Required |
| Email address | Yes | App functionality, account management | Required |
| Phone number | Yes | App functionality, account management | Required |
| Address | Yes | App functionality | Required |
| Other personal info (student profile: class, roll, admission no., date of birth) | Yes | App functionality | Required |
| Purchase history (fee payments and receipts) | Yes | App functionality | Required |
| Photos | Yes | App functionality (documents and complaint attachments the parent chooses to upload) | Optional |
| Voice or sound recordings | **No** | Speech is transcribed by the device's own speech service; no recording is sent to or stored by the school | — |
| App interactions / diagnostics | No | — | — |
| Location | **No** | The parent app declares no location permission at all | — |

Financial info: answer **no** to "payment info". Card numbers, UPI PINs and
net-banking credentials are entered on the payment gateway's own PCI-DSS page
and never reach the app or the school. Only the transaction outcome and its
reference come back, and that is declared above as purchase history.

Say **yes** to "data is encrypted in transit" and **yes** to "users can
request that data be deleted".

### Permissions the bundle actually declares

Verified against the merged manifest of the submitted bundle, so the answers
above can be defended if a reviewer asks:

| Permission | Why |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | Talking to the school's server |
| `POST_NOTIFICATIONS`, `VIBRATE`, `com.google.android.c2dm.permission.RECEIVE` | Push notices and fee reminders |
| `RECORD_AUDIO` | Asking the AI study helper a question out loud. Prompted at the mic tap, never in the background |

No location permission of any kind, no camera, no storage, no background
service. The staff app declares location; this one does not, which is why they
are separate builds.

### Financial features
Declare: **none of the listed financial features.** The app is not a lending,
banking, investment, insurance, crypto or money-transmission app. Fee payment
is a school collecting its own tuition.

### Government apps
No.

### Health apps
No.

---

## 3. Payments — why Play Billing does not apply

School fees buy a real-world service delivered off the app: tuition,
transport, examinations. Google Play's payments policy exempts payments for
physical goods and real-world services from Play Billing, so collecting them
through our own payment gateway is allowed and no service fee is due. Nothing
in the app sells digital content.

The AI study helper is the one thing to watch. Its passes are digital content,
so if they are ever **sold** in the app they fall under Play Billing. Today
they are not sold to parents through the Play build, and the app must not
offer them for sale until that is resolved. Check this before each release.

---

## 4. Release

Track: **Internal testing first**, with the school's own staff as testers, then
closed testing with a handful of parents, then production. Do not go straight
to production on a first submission.

Release name: `1.0.6 (7)`

Release notes (500 max):

```
First release for parents.

• Fees, dues by head, and online payment
• Every receipt as a downloadable PDF
• Attendance, homework, notices and timetable
• Messaging with your child's teachers
• Leave, complaints and PTM booking
• Transport route and stop
• E-books and an AI study helper
• School photographs
```

---

## 5. Before submitting — open items

- [ ] Create the reviewer's demo parent account and put it in "App access"
- [ ] Make the 1024×500 feature graphic
- [ ] Capture at least four phone screenshots
- [ ] Deploy the site so `https://bhbinternational.school/data-deletion` is live
      (the listing is rejected if the URL 404s)
- [ ] Install `cmdline-tools` in the Android SDK so `flutter build appbundle`
      exits 0 instead of failing its own post-build symbol check
- [ ] Confirm the organisation account's D-U-N-S verification has completed in
      the Play Console before creating the app
