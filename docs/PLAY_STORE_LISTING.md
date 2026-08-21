# Ahenora — Google Play Store Listing Pack

Everything you need to paste into the Google Play Console. Sections map 1:1 to
the Console screens.

---

## 1. Main store listing

**App name** (max 30 chars) — brand + the strongest head term, so it ranks for
something people actually search (the brand alone ranks for nothing).
```
Ahenora: Family Organizer
```
*(25 chars. Alternatives: `Ahenora: Family Calendar` / `Ahenora — Family Planner`.)*

**Short description** (max 80 chars) — second-heaviest ranking field; packs four
high-volume search terms plus the "calm" brand promise.
```
Family calendar, chore chart, tasks & meal planner — one calm, shared home.
```

**Full description** (max 4000 chars) — keyword-rich but readable; the head terms
(family organizer, family calendar, chore chart, meal planner, co-parenting,
single parent) recur naturally, front-loaded in the first two lines.
```
Ahenora is the calm family organizer that keeps your whole household running from one shared, private place — the family calendar, the kids' chores, the meal plan, and the paperwork, all in one app.

Stop juggling sticky notes, group chats, and half-remembered reminders. Whether you're two parents, a single parent, or co-parents across two homes, Ahenora brings everyone onto the same page.

WHAT AHENORA DOES

• Shared family calendar — See everyone's week at a glance. Import your Google Calendar so events become tasks you can actually act on.
• Tasks & reminders — Capture to-dos, permission slips, and appointments, assign them, and get nudged before they're due.
• Kids' chores & rewards — A simple chore chart with stars kids actually want to earn, plus pocket-money tracking.
• Teen accounts — Give a 13–17-year-old their own private login: just their tasks and schedule, nothing else. They tick it off, you approve, everyone stays in sync.
• Meal planner & shopping list — Plan the week's meals and build a shared shopping list that updates for everyone.
• Scan documents — Snap a school letter or bill and turn it into a task or a saved document.
• Secure vault — Keep important household paperwork organised by category.
• Handoff notes & announcements — Leave a note for your partner and keep the whole family in the loop.

BUILT FOR REAL FAMILIES

Ahenora is made for busy parents and guardians — two-parent homes, single parents, and co-parenting families managing life across two houses. Invite your partner, a grandparent, or a carer so everyone stays coordinated.

PRIVATE BY DESIGN

We don't sell your data. Everything is encrypted in transit, and you're always in control — manage notifications, delete content, or delete your account any time from Settings.

Start free with the Village plan. Bring calm to your household — try Ahenora today.
```

**App category:** Parenting (keep — broad discovery + your audience; don't switch to Productivity)

**Tags:** family organizer, household, chores, calendar, tasks, family calendar, chore chart, meal planner, co-parenting

*(Play has no separate keyword field — ranking comes from the title + short + full
description above, so that copy is where the keyword work actually lands.)*

**Contact email:** rolanddzoagbe@gmail.com

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

1. Feed / "today" view — caption: "Your whole family, one calm home"
2. Shared calendar — caption: "Everyone's week at a glance"
3. Kids' chores + stars — caption: "Chores kids actually want to do"
4. Teen account screen — caption: "Teens get their own private space"
   (newest, most differentiating feature — competitors don't have it; give it a slot)
5. Meal planner — caption: "Plan the week, shop in one tap"
6. Scan a document — caption: "Snap a letter, make it a task"

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
(in-app Account deletion screen + email request to rolanddzoagbe@gmail.com).

**Data types collected** (all used for App functionality / Account management,
**not** for advertising or third-party marketing):

| Category | Data type | Collected | Shared | Purpose |
|----------|-----------|-----------|--------|---------|
| Personal info | Name | Yes | No | App functionality, Account management |
| Personal info | Email address | Yes | No | App functionality, Account management |
| Personal info | User IDs (Google account id) | Yes | No | Account management |
| Photos and videos | Photos (scanned docs, vault images) | Yes | No | App functionality |
| App activity | Other user-generated content (tasks, notes, cards, meals, lists) | Yes | No | App functionality |
| Device or other IDs | Device push token | Yes | No | App functionality (notifications) |

Notes for the form:
- **Sharing = No** for all: data is processed by service providers (hosting,
  database, email delivery, authentication, AI processing) **on your behalf** to
  run the app — it is not shared with third parties for their own use, and is
  not sold.
- If asked about **AI features**: scans/AI assist are optional and user-initiated.
- Do **not** declare analytics or crash-reporting SDKs — the app doesn't ship any.

---

## 6. Privacy Policy URL (required)

Google requires a **publicly reachable URL**. The in-app policy text isn't
enough. Easiest free option — publish `docs/privacy.html` (included in this repo)
via GitHub Pages:

1. Push this repo (already done).
2. On GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**.
3. Save. Your URL becomes: `https://rdzoagbe.github.io/Ahenora/privacy.html`
4. Paste that URL into the Play Console "Privacy Policy" field.

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
