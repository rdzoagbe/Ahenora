# TikTok flyers — text, captions and hashtags

Five flyers, five different reasons someone downloads this app. Each one is
tied to a feature that actually ships; nothing here promises something the
app does not do.

The rule these follow: **TikTok rewards specificity over polish.** "Organise
your family life" scrolls past. "I thought YOU were picking her up" stops a
thumb, because a real person has said that sentence out loud in their own
kitchen. Every hook below is a moment, not a benefit.

The rendered PNGs live in `docs/store-assets/tiktok/`, 1080x1920, ready to
post. Build them with:

```
python3 scripts/make_flyer_shots.py <web_port> <api_port>   # photograph the app
python3 scripts/make_flyers.py                              # typeset the flyers
```

Edit the copy in `scripts/make_flyers.py` and re-run rather than retouching an
exported image, so the files and this document never drift apart.

## How they are built

They follow the printed A4 flyer's design language rather than inventing a
second one:

- **Orange rules top and bottom**, cream-to-peach gradient between them.
- **The dot-and-caps logo lockup**, top left.
- **An upright Playfair headline with one phrase in orange.** The printed
  flyer puts *chaos* in orange and nothing else; these do the same with the
  turn of the joke. Black sets up, orange lands.
- **A grey Inter supporting line** — one sentence, naming the mechanism.
- **A photograph of the real app**, in a dark device frame, running off the
  bottom edge of the frame. A screen that continues past the edge reads as a
  real screen rather than a cutout.
- **Everything readable sits in the top 1440px.** TikTok stacks its caption,
  username, sound and buttons over the bottom quarter of every video — that
  region is somebody else's furniture, not a design decision.

### On screenshots

The first version of these was type only, on the argument that a screenshot
asks a viewer to squint at a UI they have no reason to care about yet. That
was wrong for this product, and the printed flyer already knew it: three
phones running the real thing is the most persuasive object on that page,
because you can see the household before you have one.

The screenshots are taken by `scripts/make_flyer_shots.py` against a seeded
backend that looks like a household two weeks in — a co-parent, a child,
tasks with real dates, a shopping list, documents, stars earned. **An empty
account photographs as an empty account.** Same reason first-run tips are
marked seen before the shot: they are the largest thing on a screen precisely
because they are meant to be read once.

## Posting notes

- One flyer per post. Bundling them dilutes the hook.
- Post the **privacy** one first — it is the sharpest and the most argued-with
  in the comments, and arguments are reach.
- Read the two lines aloud over the still, with a 1.5s pause before the orange
  phrase. A static image with a voice beats a static image.
- Reply to comments with the specific feature, not a sales line. "It's per
  item — you tick 'share' or you don't" outperforms "check out our privacy
  features!"

---

## 1. Mental load

> **THE INVISIBLE JOB**
>
> You're not disorganised. *You're the only one who remembers.*
>
> — Tasks, dates and the school letter in your bag — in one place both parents can see.

Shows: the feed.

**Caption**

> Nobody in this house is lazy. One person is just holding all of it in their head, all the time. That's the bit that's tiring. 🧡

**Hashtags**

```
#mentalload #invisiblelabour #momlife #parentingtips #familyorganisation
#householdmanagement #defaultparent #weaponisedincompetence #sharetheload
#organisedhome
```

---

## 2. Privacy

> **PRIVATE BY DEFAULT**
>
> He can see the shopping list. *Not my therapy appointment.*
>
> — Every task and document is private until you share it.

Shows: the vault, documents marked Private.

**Caption**

> Shared calendar ≠ shared life. Some things go on the family board. Some things are mine. Both should be possible in the same app. 🔒

**Hashtags**

```
#privacymatters #familyapp #sharedcalendar #boundaries #momsoftiktok
#coparenting #dataprivacy #familyorganisation #householdmanagement
#appsyouneed
```

> Post this one first. It is the one people argue about in the comments, and
> a comment thread is worth more than a like.

---

## 3. Hand-off

> **WHO IS ACTUALLY DOING IT**
>
> "I thought YOU were picking her up." *Assign it. They get told.*
>
> — It lands on their phone, not in a group chat — with a name against it.

Shows: the family calendar, with today's pick-up against Tom.

**Caption**

> The group chat is where jobs go to be scrolled past. Assign it, they get a notification, and there's a name against it. No more "I never saw that". 📱

**Hashtags**

```
#familylife #parentinghumour #coparenting #sharedresponsibility #momlife
#dadsoftiktok #familyorganisation #tasksharing #householdmanagement
#relatable
```

---

## 4. Offline

> **WORKS OFFLINE**
>
> No signal in the shop. *The list was still there.*
>
> — Basement aisle, no bars. The list, the tasks, the lot — ticks catch up when you're back.

Shows: the shopping list, sorted by aisle.

**Caption**

> Half the supermarkets in this country are a dead zone and every shopping list app forgets that. This one doesn't need the internet to show you a list you already wrote. 📶❌

**Hashtags**

```
#shoppinglist #offlineapp #groceryshopping #lifehack #momhacks
#familyapp #organisedmum #appsthatwork #mealplanning #householdmanagement
```

---

## 5. Kid mode

> **THEIR OWN LITTLE APP**
>
> He tidied his room. Without being asked. *Twice.*
>
> — Their chores, their stars, their PIN. Nothing else in the house.

Shows: the Kids screen, stars earned and rewards in reach.

**Caption**

> Hand them the tablet, they see their own list and their own stars — and nothing else in the house. Stars are worryingly effective. ⭐

**Hashtags**

```
#chorechart #kidsroutine #positiveparenting #parentinghacks #choresforkids
#rewardchart #momsoftiktok #familyroutine #screentime #householdmanagement
```

---

## A note on hashtag mix

Each set deliberately blends three tiers:

1. **Broad reach** (`#momlife`, `#relatable`) — huge, competitive, cheap to enter.
2. **Topic** (`#chorechart`, `#sharedcalendar`) — where people actually search.
3. **Feeling** (`#mentalload`, `#defaultparent`) — small, loyal, high-intent.

The third tier is where installs come from. Do not drop it in favour of more
of the first.
