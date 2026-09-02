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
Ahenora: Family Organizer
```

#### Subtitle
```
Chores, calendar & meals
```

#### Keywords
```
coparenting,custody,planner,household,kid,chart,routine,shopping,grocery,list,reminder,shared,school
```

The subtitle previously read "The family home base". Warm, and it ranked for
nothing — the subtitle is indexed as heavily as the name, so those characters
were doing no work.

---

## French (France) — the primary market

Not yet added: Apple freezes the localisation set once a version is submitted,
so this waits until 1.1.0 is approved. Adding it needs its own screenshots.

#### Name
```
Ahenora : Agenda Familial
```

#### Subtitle
```
Tâches, repas et enfants
```

#### Keywords
```
coparentalité,garde,alternée,organiseur,maison,ménage,corvée,courses,liste,rappel,partage,école
```

**`planning` is deliberately absent.** "Planning familial" is the French term
for a family-planning clinic, not a family schedule. Ranking for it would bring
people looking for something else entirely.

#### Promotional Text
```
Nouveau : l'agenda, les corvées des enfants et les repas de la semaine au même endroit. Gratuit pour commencer.
```

Promotional Text is the one field editable **without a review** — the place for
seasonal copy ("La rentrée arrive", "Organisez Noël sans y penser").

#### Description
```
Ahenora est l'organiseur familial qui fait tourner toute la maison depuis un seul espace partagé et privé : l'agenda familial, les corvées des enfants, les repas de la semaine et les papiers de l'école.

Fini les post-it, les conversations de groupe et les rappels que personne ne retient. Que vous soyez deux parents, un parent solo, ou coparents entre deux maisons, Ahenora met tout le monde sur la même page.

CE QUE FAIT AHENORA

• Agenda familial partagé — Toute la semaine de la famille d'un coup d'œil. Importez votre agenda Google ou Outlook : chaque événement vous est proposé, vous gardez ce qui compte.
• Tâches et rappels — Notez les mots à signer, les rendez-vous et les corvées, attribuez-les, et recevez un rappel avant l'échéance.
• Corvées et récompenses — Un tableau de corvées simple, avec des étoiles que les enfants ont envie de gagner et un suivi de l'argent de poche.
• Comptes ado — Votre 13-17 ans a son propre espace privé : seulement ses tâches et les événements partagés, rien d'autre de la famille. Il coche, vous validez.
• Repas et liste de courses — Planifiez les dîners de la semaine et transformez-les en une liste de courses partagée qui se met à jour pour tout le monde.
• Scannez vos papiers — Photographiez un mot de l'école ou une facture : Ahenora en lit la date et vous propose de créer l'événement dans l'agenda.
• Coffre sécurisé — Rangez les documents importants du foyer, classés par catégorie.
• Notes de passage de relais — Laissez un mot à votre conjoint et tenez toute la famille au courant.

PENSÉ POUR LES VRAIES FAMILLES

Ahenora est fait pour les parents et les proches qui gèrent beaucoup : familles à deux parents, parents solos, et coparents qui organisent la vie entre deux maisons. Invitez votre conjoint, un grand-parent ou une nounou pour que tout le monde reste coordonné.

PRIVÉ PAR PRINCIPE

Nous ne vendons pas vos données. Tout est chiffré pendant le transport, et vous gardez la main : gérez les notifications, supprimez un contenu ou supprimez votre compte à tout moment depuis les Réglages.

Commencez gratuitement avec la formule Village. Un abonnement facultatif ouvre le planificateur de repas, l'argent de poche et un coffre plus grand.

Ramenez le calme à la maison — essayez Ahenora.
```

> **Do not publish this description until iOS has the calendar release.**
> Two lines describe behaviour that shipped to **Android only**: "chaque
> événement vous est proposé" (the review queue) and "Ahenora en lit la date et
> vous propose de créer l'événement" (scan → calendar). The iOS binary under
> review predates both, because the OTA was deliberately held to
> `--platform android` while Apple had the build.
>
> Order: approve → flip the workflow back to `--platform all` → let iOS take the
> OTA → then publish. Describing a feature the binary lacks is how a listing
> earns a Guideline 2.3 rejection for inaccurate metadata.
>
> If it must go out sooner, use `Importez votre agenda Google ou Outlook.` and
> `Photographiez un mot de l'école ou une facture et rangez-le.`

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
