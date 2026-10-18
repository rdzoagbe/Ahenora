# Ahenora — App Store listing pack

Everything to paste into App Store Connect. The Play Store equivalent is
`PLAY_STORE_LISTING.md`; the two stores work differently and the copy is not
interchangeable.

`tests/test_store_listing.py` reads this file and fails the build if a field is
over Apple's limit, repeats a word already spent in the name or subtitle, or
carries a duplicate keyword. A listing that quietly exceeds a limit is not
rejected — it is **truncated**, silently, and the tail simply never ranks.

---

## How the App Store actually ranks you

Different from Play in the way that matters most:

- Apple indexes the **name (30)**, the **subtitle (30)** and a hidden
  **keyword field (100)** — *together*. A word in the name is wasted in the
  keyword field.
- Apple does **not** index the description. Writing keywords into it does
  nothing for search; it only has to read well.
- Apple builds phrases by combining your terms itself, so multi-word entries
  waste characters. `agenda` + `familial` already covers "agenda familial".
- Commas separate. **A space after a comma is a wasted character.**
- Every localisation gets its **own** 100-character field. Adding French does
  not split the English budget — it adds a second one.
- The character counters in App Store Connect show characters **remaining**,
  not used.

Accents cost nothing: Apple counts characters, so `coparentalité` and
`coparentalite` are both 13. Use the accented form — it is what people type.

---

## English (U.S.) — live

#### Name
```
Ahenora: Family Chore Chart
```

#### Subtitle
```
Stars, pocket money, calendar
```

#### Keywords
```
coparenting,custody,planner,kid,reward,allowance,shopping,list,reminder,school,teen,nanny,meal,task
```

#### Promotional Text
```
The chore chart kids actually want to do: stars for jobs done, a weekend treat to earn, pocket money paid on time. Free for 14 days, no card.
```

#### Description
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

### Why these terms (October 2026: the kids' wedge)

The app had downloads and no subscriptions. Children are what Family is paid
for — chores, stars, the weekend treat, pocket money, kid mode, teen accounts,
two homes — and the listing sold a general family organizer with the kids'
side as the third bullet. From 2026-10-18 the name, subtitle, promotional text,
description and the first screenshot all lead with the kids' week.

**The name spends "chore chart"** instead of "organizer": a category parents
search by name, narrow enough for a new app to place for, and the thing this
app is now sold on. "Family" stays. The conservative alternative, if "chore
chart" turns out not to place in 30 days, is `Ahenora: Family Organizer` with
the subtitle `Chores, stars, pocket money`.

**The subtitle** names what sits under the chart: stars, pocket money, and the
calendar around them. `calendar` was in no indexed field before.

**Keywords** (99/100): `chart` left the field because the name now spends it;
`organizer` left with the name; `reward`, `meal` and `task` came in for
features that had no term anywhere. `allowance`, `teen` and `nanny` stay for
the reasons given in September.

**The description is not indexed by Apple**, so it is the Play full
description word for word: one text to keep true in two places is still one
text.

**What is NOT claimed here** is unchanged: none of this is backed by
search-volume data. The honest way to settle it is the next 30 days of
impressions and page views against September's 34 → 13 → 5.

**These fields do not change on their own.** Name, Subtitle and Keywords can
only be edited as part of a **new version submission** — they ride the next
release. Promotional Text is the only field editable without review, so it
can carry the kids' wedge today.

### Why the September terms were what they were

Four days of iOS data said the funnel is fine and the top of it is empty: **34
impressions to 13 page views (38%) to 5 downloads (38%)**. People who find the
listing install it. Almost nobody finds it. That makes the keyword field the
only lever worth pulling — screenshots and copy cannot fix a listing that is
never shown.

Three terms were dropped then, each paying for breadth this app cannot win:

- `household` — parents search "family organizer", not "household organizer".
- `routine` — real, but it puts us against every habit tracker on the store.
- `shared` — mostly buys "shared calendar", where a new listing places behind
  Google Calendar and Cozi regardless of what it says.

Three were added, each naming something the app actually does that had no
term anywhere: `teen` (the gated 13-17 account), `nanny` (helper accounts are a
paid feature), `allowance` (stars and pocket money had no term).

---

## French (France) — the primary market

Not yet added: Apple freezes the localisation set once a version is submitted,
so this rides the next version. Adding it needs its own screenshots.

#### Name
```
Ahenora : Tableau de corvées
```

#### Subtitle
```
Étoiles, argent de poche
```

#### Keywords
```
coparentalité,garde,alternée,organiseur,maison,courses,liste,rappel,partage,école,agenda,enfant,ado
```

**Since 2026-10-18 the name is the chore chart** ("tableau de corvées" is what a
French parent types), the subtitle the stars and pocket money under it, and the
description leads with the kids' week. `corvée` left the keywords because the name
now spends it; `agenda`, `enfant` and `ado` came in (99/100).

**`planning` is deliberately absent.** "Planning familial" is the French term
for a family-planning clinic, not a family schedule. Ranking for it would bring
people looking for something else entirely.

#### Promotional Text
```
Le tableau de corvées que les enfants ont envie de remplir : des étoiles, une récompense le week-end, l'argent de poche versé à l'heure. 14 jours gratuits, sans carte.
```

Promotional Text is the one field editable **without a review** — the place for
seasonal copy ("La rentrée arrive", "Organisez Noël sans y penser").

#### Description
```
Ahenora est l'organiseur familial qui fait tourner la semaine des enfants : un tableau de corvées avec des étoiles qu'ils ont envie de gagner, des récompenses que vous choisissez, une récompense du week-end à mériter, et l'argent de poche versé à l'heure — avec l'agenda familial, les repas et les papiers autour.

Fini les post-it, les conversations de groupe et les rappels que personne ne retient. Que vous soyez deux parents, un parent solo, ou coparents entre deux maisons, Ahenora met tout le monde sur la même page.

LA SEMAINE DES ENFANTS

• Tableau de corvées et étoiles — Donnez des étoiles pour les corvées faites. Elles s'accumulent et s'échangent contre les récompenses que vous décidez : du temps d'écran, une sortie, de l'argent de poche. C'est vous qui fixez ce que vaut une étoile.
• Une bonne semaine mérite une récompense — Les étoiles gagnées dans la semaine comptent pour une récompense du week-end, et une semaine complète rapporte une étoile bonus. Le compteur repart chaque lundi ; les étoiles économisées restent à l'enfant.
• Argent de poche — Fixez un montant et une échéance, recevez un rappel la veille, notez le versement. Chaque étoile et chaque versement sont dans un carnet que les deux parents peuvent lire.
• Mode enfant — Tendez votre téléphone : il n'affiche que les corvées et les étoiles de cet enfant, avec un code PIN pour en sortir.
• Comptes ado — Votre 13-17 ans a son propre espace privé : seulement ses tâches et l'agenda partagé. Il coche, vous validez.
• Deux maisons — Les coparents voient les mêmes semaines de garde et les mêmes corvées, quelle que soit la maison où l'enfant est cette semaine.

AUTOUR, LE RESTE DU FOYER

• Agenda familial partagé — Toute la semaine de la famille d'un coup d'œil. Importez votre agenda Google ou Outlook, journées entières comprises.
• Tâches et rappels — Notez les mots à signer, les rendez-vous et les courses à faire, attribuez-les, et recevez un rappel avant l'échéance.
• Repas et liste de courses — Planifiez les dîners de la semaine, avec des recettes pas à pas, et une liste partagée qui se range toute seule par rayon.
• Scannez vos papiers — Photographiez un mot de l'école ou une facture : Ahenora en lit la date et vous propose de créer l'événement dans l'agenda.
• Coffre sécurisé — Rangez les documents importants du foyer, classés par catégorie.
• Discussion et notes de passage de relais — Laissez un mot à votre conjoint et tenez toute la famille au courant.

PENSÉ POUR LES VRAIES FAMILLES

Ahenora est fait pour les parents et les proches qui gèrent beaucoup : familles à deux parents, parents solos, et coparents qui organisent la vie entre deux maisons. Invitez votre conjoint, un grand-parent ou une nounou pour que tout le monde reste coordonné.

PRIVÉ PAR PRINCIPE

Nous ne vendons pas vos données. Tout est chiffré pendant le transport, et vous gardez la main : gérez les notifications, supprimez un contenu ou supprimez votre compte à tout moment depuis les Réglages.

Chaque nouveau foyer profite de toute l'app gratuitement pendant 14 jours, sans carte. Ensuite, la formule Gratuite garde deux adultes organisés, et Famille apporte le côté enfants — jusqu'à cinq enfants — avec les repas et les scans illimités.

Ramenez le calme dans la semaine des enfants — essayez Ahenora.
```

> Both lines that were once held back — the calendar review queue and the
> scan-to-event — ship on both platforms now: the production OTA has published
> `--platform all` since the 3.0.0 runtime, and `tests/test_workflow_publish_steps.py`
> keeps it that way. Nothing in this description is Android-only.

---

## Spanish (Spain)

#### Name
```
Ahenora: Agenda Familiar
```

#### Subtitle
```
Comidas, hijos y recados
```

#### Keywords
```
coparentalidad,custodia,organizador,hogar,casa,tarea,rutina,compra,lista,recordatorio,compartido
```

---

## German

#### Name
```
Ahenora: Familienkalender
```

#### Subtitle
```
Aufgaben, Essen & Kinder
```

#### Keywords
```
getrennt,sorgerecht,haushalt,planer,putzplan,routine,einkauf,liste,erinnerung,geteilt,schule,kita
```

**`amme` is deliberately absent.** It means wet nurse, not childminder. `kita`
is the word a German parent searches for.

---

## Where each field lives in App Store Connect

| Field | Page |
|---|---|
| Name, Subtitle | **General → App Information**, under *Localizable Information* |
| Keywords, Promotional Text, Description | the **version page** (`iOS App 1.1.0`), above *Support URL* |
| Add a localisation | the **version page** language dropdown → *Add Language* |

Editing metadata while a version is *Waiting for Review* keeps its place in the
queue. Removing the **build** from review is what costs the queue position —
they are different actions.

---

## Still to do

- [ ] Add French (France) once 1.1.0 is approved
- [ ] Screenshots with the app in French (the same re-shoot the website's phone
      mockups need)
- [ ] Restore the two held-back description lines after iOS takes the calendar OTA
