# Ahenora 🏡

**Run your household, calmly.** Ahenora is a family-organisation app: shared tasks and
reminders, a family calendar, kids' chores with star rewards, document scanning with AI,
a secure document vault, meal planning, shopping lists and grocery spending — all in one
private place.

Built for every shape of family — solo parents, co-parents and busy households.

Available in **English, French, Spanish and German**.

## 📲 Get it

- **Android:** [Google Play](https://play.google.com/store/apps/details?id=com.householdcoo.app)
- **Any browser:** [ahenora.com](https://ahenora.com) — the same app, no install

## ✨ What it does

- **Smart Feed** — the household's day at a glance: overdue, due today, what's ahead
- **Family calendar** — shared events, optional Google and Outlook import, alternating custody
- **Kids & chores** — assign chores, award stars, redeem rewards, optional child PINs and a
  kid-only mode on a shared phone
- **Teen accounts** — a teenager gets their own login and sees only their own life
- **AI document scan** — photograph a school letter, bill or appointment card and it becomes
  a task with a date
- **Secure vault** — household documents by category, with expiry alerts and per-item privacy
- **Meal planner & shopping list** — plan the week, send the ingredients to the list, or
  photograph a paper list and have it read
- **Grocery spending** — scan a receipt and it reads the shop, the total and every line, so the
  shopping list can say where a thing is cheaper per kilo
- **Handoff notes, announcements and chat** — keep the household, and a co-parent, in the loop
- **Carpool, gift pots and Secret Santa** — the seasonal jobs a family actually has
- **Morning digest** — a daily notification with what is due today
- **Works offline** — tick things off with no signal; it syncs when you are back

## 💳 Plans

Every parent is always free. Metering is on household size, never on the features that keep a
family coordinated. Prices in euros; pay by card on the web or through Google Play in the app.

| | Free | Premium | Household |
|---|---|---|---|
| | €0 | €6.99 / mo · €49.99 / yr | €14.99 / mo · €149.99 / yr |
| People | 2 adults + 2 children | up to 12, 5 children | up to 20, 10 children |
| Tasks, calendar, lists | ✅ | ✅ | ✅ |
| Chores, stars, rewards | ✅ | ✅ | ✅ |
| Meal planner & recipe AI | — | ✅ | ✅ |
| Pocket money & weekly report | — | ✅ | ✅ |
| Carpool | — | ✅ | ✅ |
| Document vault | 25 MB | 500 MB | 10 GB |
| AI scans / month | 5 | 100 | unlimited |
| Helper & nanny accounts | — | — | ✅ |
| More than one property | — | — | ✅ |
| Priority support | — | — | ✅ |

## 🛠 Tech

- **App:** React Native + Expo (SDK 57), TypeScript, expo-router — one codebase for Android
  and the web
- **Backend:** FastAPI + MongoDB, deployed on Railway
- **Billing:** RevenueCat for Google Play, Stripe Checkout for the web
- **Delivery:** every merge to `main` reaches all three destinations by itself — the website,
  production app users, and the preview channel
- **Checks:** ~800 backend tests, a frontend suite, and 15 browser harnesses that drive the
  real web build in Chromium

## 📄 Legal

- [Privacy Policy](https://ahenora.com/privacy.html)
- [Terms](https://ahenora.com/terms.html)
- [Delete your account](https://ahenora.com/delete-account.html)
- Contact: rolanddzoagbe@gmail.com
