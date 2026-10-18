# Ahenora — Google Play Store Listing Pack

Everything you need to paste into the Google Play Console. Sections map 1:1 to
the Console screens.

---

## 1. Main store listing

**App name** (max 30 chars) — brand + the strongest head term, so it ranks for
something people actually search (the brand alone ranks for nothing).
```
Ahenora: Family Chore Chart
```
*(27 chars. Leads with the kids' wedge: "chore chart" is a category parents search by name, and "family" stays. The conservative alternative is `Ahenora: Family Organizer`, with the wedge carried by the short description alone.)*

**Short description** (max 80 chars) — second-heaviest ranking field. Since 2026-10-18
it sells the kids' week first (chores, stars, treat, pocket money) and the calendar
last: the wedge families pay for, in the field they read in the search results.
```
Chores kids want to do: stars, a weekly treat, pocket money, the family calendar
```

**Full description** (max 4000 chars) — keyword-rich but readable; the head terms
(family organizer, chore chart, pocket money, family calendar, meal planner,
co-parenting, single parent) recur naturally, front-loaded in the first two lines.
The kids' week comes first and the rest of the household second: every line under
THE KIDS' WEEK describes something the app does today (stars, the weekend treat and
full-week bonus, pocket money with a due date and a reminder, kid mode with a PIN,
teen accounts, custody weeks), checked against the code on 2026-10-18.
```
Ahenora is the family organizer that runs the kids' week: a chore chart with stars kids actually want to earn, rewards you set, a weekend treat to work towards, and pocket money paid on time — with the family calendar, meals and paperwork around it.

Stop juggling sticky notes, group chats and half-remembered reminders. Whether you're two parents, a single parent, or co-parents across two homes, Ahenora puts the whole household on the same page.

THE KIDS' WEEK

• Chore chart with stars — Give stars for chores done. Stars build up and get swapped for rewards you decide on: screen time, a treat, pocket money. You decide what a star is worth.
• A good week earns a treat — Stars earned this week count towards a weekend treat, and a full week of jobs earns a bonus star. The count starts fresh each Monday; saved stars stay theirs.
• Pocket money — Set an allowance with a due date, get reminded the day before, and record it when paid. Every star and every payment sits in a ledger both parents can see.
• Kid mode — Hand over your phone and it shows only that child's chores and stars, with a PIN to get back out.
• Teen accounts — Give a 13–17-year-old their own private login: just their tasks and the shared calendar. They tick it off, you approve.
• Two homes — Co-parents see the same custody weeks and the same chores, whichever house the child is in this week.

AROUND IT, THE REST OF THE HOUSEHOLD

• Shared family calendar — Everyone's week at a glance. Import your Google or Outlook calendar, all-day events included.
• Tasks & reminders — Capture to-dos, permission slips and appointments, assign them, and get nudged before they're due.
• Meal planner & shopping list — Plan the week's dinners, with step-by-step recipes, and a shared shopping list that sorts itself into aisles.
• Scan documents — Snap a school letter or bill and turn it into a calendar event or a saved document.
• Secure vault — Keep the household's paperwork organised by category.
• Family chat & handoff notes — Leave a note for your partner and keep everyone in the loop.

BUILT FOR REAL FAMILIES

Ahenora is made for busy parents and guardians — two-parent homes, single parents, and co-parenting families managing life across two houses. Invite your partner, a grandparent or a carer so everyone stays coordinated.

PRIVATE BY DESIGN

We don't sell your data. Everything is encrypted in transit, and you're always in control — manage notifications, delete content, or delete your account any time from Settings.

Every new household gets the whole app free for 14 days, with no card. After that, Free keeps two adults organised, and Family brings the kids' side — up to five children — with meal planning and unlimited scans. Bring calm to the kids' week — try Ahenora today.
```

**App category:** Parenting (keep — broad discovery + your audience; don't switch to Productivity)

**Tags:** chore chart, family organizer, chores, pocket money, allowance, family calendar, tasks, meal planner, co-parenting

*(Play has no separate keyword field — ranking comes from the title + short + full
description above, so that copy is where the keyword work actually lands.)*

**Contact email:** support@ahenora.com

**Website** (optional): your GitHub Pages URL or leave blank

**Privacy Policy URL:** *(required — see Section 6 below to publish one)*

---

## 2. Graphics assets

| Asset | Requirement | Status |
|-------|-------------|--------|
| App icon | 512×512 PNG | ✅ In project (`assets/images/icon.png`) — Console pulls from the build |
| Feature graphic | 1024×500 PNG/JPG | ✅ Provided (`feature-graphic.png`) |
| Phone screenshots | 2–8, min 320px, ratio between 16:9 and 9:16 | ⏳ Capture from the running app (see Section 7) |
| Tablet screenshots | Optional | Skip unless you support tablets |

Order screenshots by what SELLS, not by app navigation, and put a short benefit
caption band on each. The first two do ~80% of the browse→install conversion —
make them your strongest. (Portrait, from a preview build with sample data.)

Since 2026-10-18 the kids' week leads, because it is what Family is paid for
and the first two screenshots decide the install:

1. Kids' chores + stars — caption: "Chores kids want to finish"
2. Feed / "today" view — caption: "The whole family's day, sorted"
3. Shared calendar — caption: "One shared family calendar"
4. Meal planner — caption: "The week's meals, planned in minutes"
5. Quick add — caption: "Capture anything in a single tap"
6. Household — caption: "Everything a household needs"

The capture script (`scripts/store_capture.py`) and the framing script
(`scripts/frame_store.py`) number the shots in this order; re-run both before
uploading so the files on disk match.

---

## 3. Content rating questionnaire

Answer honestly; for Ahenora the expected answers are:

- Category: **Utility, Productivity, Communication, or Other**
- Violence: **No**
- Sexual content: **No**
- Profanity: **No**
- Controlled substances (drugs/alcohol/tobacco): **No**
- Gambling: **No**
- User-generated content shared with others: **Yes** (family members share cards/notes within a private household) — but not public/social
- Users can interact / share content: within a private family group only

Expected result: **Everyone / PEGI 3**.

---

## 4. Target audience & content

- **Target age group:** Select adult brackets (e.g. 18+). Ahenora is used
  by **parents/guardians**, not directed at children.
- **Is your app designed for children / appealing to children?** **No.** It
  contains "kids" management features, but the app is operated by adults for
  household organization. Selecting "No" keeps you out of Google's Families
  program requirements.
- **Ads:** No ads. Answer "No, my app does not contain ads."

---

## 5. Data safety form

Answers based on how the app actually works.

**Does your app collect or share any of the required user data types?** Yes (collect).

**Is all data encrypted in transit?** Yes (all API traffic is HTTPS).

**Do you provide a way for users to request that their data be deleted?** Yes
(in-app Account deletion screen + email request to privacy@ahenora.com).

**Data types collected** (all used for App functionality or Account management,
**not** for advertising or marketing, never sold). Checked against the code on
24 September 2026 — the earlier version of this table left out health data,
messages, calendar events, contacts, files, money and diagnostics, all of which
the app collects:

| Category | Data type | Required? | Purpose |
|----------|-----------|-----------|---------|
| Personal info | Name | Required | Account management, App functionality |
| Personal info | Email address | Required | Account management, App functionality |
| Personal info | User IDs (Google / Apple account id) | Required | Account management |
| Personal info | Other info (children's names and ages, school, sizes) | Optional | App functionality |
| Health and fitness | Health info (allergies, conditions, medicines, vaccinations, blood group) | Optional | App functionality |
| Financial info | Purchase history (subscription status) | Required for paid plans | App functionality |
| Financial info | Other financial info (household spending, pocket money) | Optional | App functionality |
| Messages | Other in-app messages (family chat) | Optional | App functionality |
| Photos and videos | Photos (scans, vault images) | Optional | App functionality |
| Files and docs | Files and docs (vault documents) | Optional | App functionality |
| Calendar | Calendar events (imported and created) | Optional | App functionality |
| Contacts | Contacts (people invited to imported calendar events) | Optional | App functionality |
| App activity | Other user-generated content (tasks, notes, meals, lists) | Optional | App functionality |
| App info and performance | Crash logs, Diagnostics (error reports, app version) | Required | Analytics (fixing faults) |
| Device or other IDs | Device push token | Optional | App functionality (notifications) |

Notes for the form:

- **Sharing = No** for all: data is processed by service providers (hosting,
  database, email, sign-in, notifications, AI, payments) **on your behalf** — it
  is not shared with third parties for their own use, and is not sold.
- **AI features** are user-initiated: scans, recipes, meal suggestions and the
  Sunday brief. Suggesting who a task is for runs on our own server, not an AI.
- The app ships **no third-party** analytics or crash SDK. Error reports and
  usage counts are first-party — they still have to be declared above.
- **Is all data encrypted in transit?** Yes. **Can users request deletion?** Yes
  (in-app, immediate; or by email).

## 6. Privacy Policy URL (required)

Google requires a **publicly reachable URL**. The in-app policy text isn't
enough. Easiest free option — publish `docs/privacy.html` (included in this repo)
via GitHub Pages:

1. Push this repo (already done).
2. On GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**.
3. The policy is live at **`https://ahenora.com/privacy.html`** — that is the URL for the Play Console "Privacy Policy" field.

---

## 7. App access (required — login-gated app)

Because Ahenora requires sign-in, Google's reviewers need working test
credentials. In **App content → App access**, choose "All or some functionality
is restricted" and add:

```
Instructions: Open the app, tap "Create an account with email", or use the
demo login below.

Login method: Email + password
Email: reviewer@ahenora.com        (create this test account first)
Password: <set a password and put it here>
```

Create that account once in the app before submitting so it exists in the
backend.

---

## 8. Automating the binary upload (eas submit)

The **app bundle** can be uploaded automatically; the listing above is a
one-time manual setup in the Console.

1. In Google Play Console, create the app and do the first manual upload (Play
   requires the first AAB to be uploaded by hand, and the listing to be filled).
2. Create a Google Cloud **service account** with Play Console access and
   download its JSON key. (Play Console → Setup → API access.)
3. Reference it in `eas.json` (already scaffolded under `submit.production`).
4. Then each release is one command:
   ```
   eas build --platform android --profile production
   eas submit --platform android --profile production --latest
   ```

`eas submit` uploads the binary to your chosen track. It does **not** change the
store listing text/graphics — those persist in the Console once set.

---

## Release checklist

- [ ] Feature graphic uploaded (1024×500)
- [ ] 2+ phone screenshots uploaded
- [ ] Short + full description pasted
- [ ] Category set to Parenting
- [ ] Content rating questionnaire completed
- [ ] Target audience set to adults, "not designed for children"
- [ ] Data safety form completed
- [ ] Privacy Policy URL published and pasted
- [ ] App access test credentials added
- [ ] Production AAB uploaded
- [ ] Send for review
