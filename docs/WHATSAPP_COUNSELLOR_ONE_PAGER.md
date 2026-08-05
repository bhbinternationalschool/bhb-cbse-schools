# Admissions WhatsApp — counsellor one-pager

**BHB International School · Admissions CRM**

Print or share with every counsellor / calling agent.

---

## Your inbox

| | |
|---|---|
| **Where** | ERP → **Admissions** → **CRM parent chat** → channel **WhatsApp** |
| **What it is** | Parents *seeking admission* messaging the school WhatsApp number |
| **Not for** | Enrolled families (they use Parent portal / SIS bot) |

**Unread badge** = parent waiting. Reply from the inbox — do not use personal WhatsApp for official replies.

---

## What the bot does before you

When a parent texts the school number, the bot auto-replies with keywords:

| Parent types | Bot sends |
|--------------|-----------|
| **FEE** | Registration fee info + online pay link |
| **REGISTER** | Link to registration form |
| **DOCS** | Document checklist |
| **STATUS** | Their enquiry number & stage (if mobile matches CRM) |
| **VISIT** | Campus visit info |
| **HUMAN** | “Connecting to admissions…” → **you** get the thread |
| **MENU** | Main school menu |

**New numbers:** bot auto-creates a CRM lead (`source: WhatsApp`). You must add **child name** and **class sought** after first contact.

---

## Your 5-step workflow

1. **Open inbox** daily — clear unread WhatsApp threads first  
2. **Read** bot transcript — know what parent already asked  
3. **Reply** in the text box → goes from **school WhatsApp** (not your phone)  
4. **Update lead** — child name, class, assign counsellor, next follow-up date  
5. **Log calls** — Field app → Lead calling, or follow-up on lead record  

---

## 24-hour rule (important)

| Situation | What to do |
|-----------|------------|
| Parent messaged **today / yesterday** | Free-text reply from inbox ✅ |
| **No parent message for 24+ hours** | Use **approved template** only (Masters → WhatsApp templates → Sync from Meta) |
| First contact cold outreach | Template campaign — not free text |

Meta blocks free-text outside the 24h window.

---

## Quick replies (copy-paste ideas)

**After HUMAN escalation:**  
> Namaste, this is [Name] from BHB Admissions. Please share child name, class sought, and your question — I will assist you.

**Visit scheduled:**  
> Your campus visit is noted for [date/time]. Please bring Aadhaar and birth certificate. Address: [school address].

**Registration nudge:**  
> Please complete registration here: https://bhbinternational.school/register?src=wa_bot — fee is shown per child.

---

## Escalation & quality

- **Wrong number / enrolled parent** → politely ask them to use Parent portal; close thread  
- **Angry / fee dispute** → escalate to office / principal; do not argue on WA  
- **Duplicate leads** → merge in Admissions (same mobile, multiple children = sibling enquiry)  
- **No reply from parent** → log follow-up; use template after 24h if re-contacting  

---

## Test checklist (new counsellor)

- [ ] Can open CRM parent chat → WhatsApp  
- [ ] Sees test thread after `npm run test:wa-webhook` (IT)  
- [ ] Sent one reply; parent received on phone  
- [ ] Updated auto-created lead with real child name  
- [ ] Knows where templates live (Masters → WhatsApp)  

---

## Help

| Issue | Contact |
|-------|---------|
| Inbox empty but parent says they messaged | IT — webhook / deploy |
| Reply fails / red error | 24h window or missing WHATSAPP_TOKEN |
| Lead not matching STATUS | Check mobile on lead = parent WhatsApp number |

Technical guide: [WHATSAPP_ADMISSIONS_GO_LIVE.md](./WHATSAPP_ADMISSIONS_GO_LIVE.md)
