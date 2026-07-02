# Household COO — Google Play Store Listing Pack

Everything you need to paste into the Google Play Console. Sections map 1:1 to
the Console screens.

---

## 1. Main store listing

**App name** (max 30 chars)
```
Household COO
```

**Short description** (max 80 chars)
```
Organise family tasks, calendars, kids' chores, and documents in one place.
```

**Full description** (max 4000 chars)
```
Household COO is your family's operations hub — a calm, organised home for the tasks, plans, and paperwork that keep a household running.

Stop juggling sticky notes, group chats, and half-remembered reminders. Household COO brings everything into one shared, private space for your whole family.

WHAT YOU CAN DO

• Tasks & cards — Capture to-dos, sign slips, and RSVPs. Assign them to family members, set due dates and reminders, and watch your "today" list stay clear.
• Recurring routines — Set tasks to repeat daily, weekly, or monthly and they come back automatically when completed.
• Shared calendar — See what's coming up across the household. Import your Google Calendar so events become actionable cards.
• Scan documents — Snap a photo of a school letter, appointment card, or bill and turn it into a task or a saved document.
• Secure vault — Keep important household documents in one place, organised by category.
• Kids & chores — Give children chores, track stars and rewards, set allowances, and keep routines running.
• Meal planning & shopping — Plan meals for the week and build a shared shopping list.
• Expense splitting — Track shared household costs and see who owes what.
• Handoff notes & announcements — Leave notes for your partner or the family and keep everyone in the loop.
• Reminders & notifications — Get nudged about what needs doing, when it matters.

BUILT FOR FAMILIES

Household COO is designed for parents and guardians organising a busy home. Invite your partner or family members so everyone stays coordinated. Your household data stays inside your account.

PRIVACY FIRST

We don't sell your personal data. Authentication is secured with encrypted device storage, and you're always in control — sign out, manage notifications, delete content, or request full account deletion any time from Settings.

PLANS

Household COO is free to use with the Village plan. Additional plans with more members and features are coming soon.

Bring calm to your household. Try Household COO today.
```

**App category:** Parenting (alternate: Productivity)

**Tags:** family organizer, household, chores, calendar, tasks

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

Suggested screenshots to capture (portrait, from a preview build with sample data):
1. Feed / "today" list with a few cards
2. A card detail sheet open
3. Calendar view
4. Kids / chores with stars
5. Vault documents
6. Add-card / scan screen

Tip: add a short caption band at the top of each screenshot (e.g. "Your whole
day at a glance") for a more polished listing — optional.

---

## 3. Content rating questionnaire

Answer honestly; for Household COO the expected answers are:

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

- **Target age group:** Select adult brackets (e.g. 18+). Household COO is used
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
3. Save. Your URL becomes: `https://rdzoagbe.github.io/Household-COO/privacy.html`
4. Paste that URL into the Play Console "Privacy Policy" field.

---

## 7. App access (required — login-gated app)

Because Household COO requires sign-in, Google's reviewers need working test
credentials. In **App content → App access**, choose "All or some functionality
is restricted" and add:

```
Instructions: Open the app, tap "Create an account with email", or use the
demo login below.

Login method: Email + password
Email: reviewer@householdcoo.app        (create this test account first)
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
