# Household COO — Kids Page UI Layout Spec

## 1. Page purpose

The Kids page helps parents:

- track each child’s stars
- reward good behavior
- manage rewards
- view activity/history
- let children redeem rewards safely

The page should feel warm, modern, easy to understand, parent-friendly, readable for older users, and safe for children to use with supervision.

---

## 2. Primary user goals

### Parent goals

A parent should be able to:

1. quickly switch between children
2. instantly see each child’s current stars
3. add or remove stars
4. create, edit, and delete rewards
5. review recent activity/history
6. allow reward redemption with PIN protection

### Child-facing goals

A child should be able to:

1. see how many stars they have
2. see what rewards are available
3. redeem a reward
4. feel motivated and encouraged

---

## 3. Core page structure

The page should be a vertical mobile layout with this order:

1. Header
2. Child selector
3. Selected child summary card
4. Quick star actions
5. Activity/history preview
6. Rewards section
7. Parent controls section
8. Bottom spacing for the tab bar

---

## 4. Section layout

## Section 1 — Header

### Purpose

Introduce the page clearly and warmly.

### Layout

At the top of the page:

- large title
- short supporting subtitle
- optional top-right action buttons

### Content

**Title:** Kids Rewards

**Subtitle:** Encourage good habits, track stars, and celebrate progress.

### Optional header actions

- Add Child
- New Reward

### Design notes

- Title should be large and very readable.
- Subtitle should be softer but still high contrast.
- Buttons should be rounded and easy to tap.
- The page should have generous top padding.

---

## Section 2 — Child selector row

### Purpose

Allow fast switching between children.

### Layout

Horizontal scrollable row of child cards.

### Card content

Each child card shows:

- avatar or initials
- child name
- current stars
- optional short status line

### Example

**Emma**  
45 stars

**Noah**  
20 stars

### Interaction

- Tap card = select child.
- Selected card gets stronger highlight.
- Cards should remain compact but easy to read.

### Empty state

If there are no children:

- show an empty card
- CTA: Add first child

---

## Section 3 — Selected child summary card

### Purpose

This is the main hero section of the page.

### Layout

A larger featured card directly below the child selector.

### Content

- child name
- current stars
- weekly earned stars
- rewards redeemed count
- PIN status
- optional motivational note

### Example

**Emma**  
45 stars

Supporting stats:

- This week: +20
- Rewards redeemed: 3
- PIN: Enabled

### Actions inside this card

Primary actions:

- Add stars
- Remove stars
- View history

Optional secondary action:

- Set / Change PIN

### Design notes

- This card should feel premium and central.
- Stars should be visually emphasized.
- Stats should be easy to scan.
- Buttons should be clearly separated.

---

## Section 4 — Quick star actions

### Purpose

Allow very fast parent actions.

### Layout

A grid or horizontal row of large chips/buttons.

### Buttons

- +5
- +10
- +20
- Custom
- Optional: -5

### Recommended behavior

Tapping +5, +10, or +20 should either apply immediately with a toast or open a lightweight confirm sheet.

Custom opens the full Adjust Stars bottom sheet.

### Design notes

- Large rounded buttons
- Enough spacing so they do not feel cramped
- Works well with one-hand use
- Accessible for older users

---

## Section 5 — Recent activity preview

### Purpose

Help parents see how stars changed over time.

### Layout

A card section with section title and 3–5 recent entries.

### Title

Recent activity

### Entry structure

Each row shows:

- delta, for example +10 or -50
- reason
- timestamp
- optional actor/source

### Example

- +10 Homework completed — Today 17:30
- +5 Helped tidy room — Yesterday
- -50 Redeemed Pizza Night — Yesterday
- +20 Great school report — 2 days ago

### Interaction

- View history opens full activity sheet/page.
- Preview rows can be non-clickable or clickable.

### Empty state

No activity yet. Add stars or redeem a reward to get started.

---

## Section 6 — Rewards section

### Purpose

This is the reward shop and management area.

### Section title

Reward Shop

### Header actions

- New Reward

### Layout

Vertical stack of reward cards.

### Reward card content

Each reward card contains:

- emoji/icon
- reward title
- short description, optional
- star cost
- action buttons

### Example card

**Pizza Night**  
Family pizza dinner  
50 stars

Actions:

- Redeem
- Edit

### Interaction

- Redeem starts redemption flow.
- Edit opens reward edit sheet.
- Tapping the full card may open reward details.

### Reward states

1. Affordable now: child has enough stars and redeem is active.
2. Not enough stars: redeem is disabled or softer.
3. Recently redeemed: optional tag like Redeemed today.

---

## Section 7 — Parent controls section

### Purpose

Give parents safety and control tools.

### Section title

Parent controls

### Items

- PIN status
- Set / Change PIN
- Require PIN for redemption
- Require parent approval, future option
- Child can redeem rewards toggle
- Delete child or Edit child, future option

### Layout

A grouped settings-style card list.

### Design notes

- Organized and calm
- Not visually heavy
- Easy toggles
- Clear labels and support text

---

## 5. Bottom sheets / modal specs

## A. Add / Remove stars sheet

### Trigger

From:

- Add stars
- Remove stars
- quick actions like +5, +10, +20
- Custom

### Title

Adjust stars

### Fields

- child name
- amount
- quick preset buttons
- reason input
- add/remove mode
- confirm button

### Example layout

- For: Emma
- Mode segmented control: Add / Remove
- Preset chips: 5, 10, 20
- Custom number field
- Reason text input
- Buttons: Cancel / Save

### Validation

- Amount must be greater than 0.
- Removing stars cannot go below 0.
- Reason is recommended and should be required for deductions.

---

## B. Reward create/edit sheet

### Trigger

From:

- New Reward
- Edit

### Title

- New reward
- Edit reward

### Fields

- icon/emoji
- reward title
- description
- cost in stars

### Buttons

- Save
- Delete, edit mode only
- Cancel

### Validation

- Title required
- Cost required
- Cost must be positive integer

---

## C. History sheet

### Trigger

From:

- View history

### Content

- full list of transactions
- filters later if needed
- simple readable rows

### Optional filters

- All
- Earned
- Redeemed
- Adjustments

---

## D. PIN sheet

### Trigger

From:

- Set / Change PIN
- redemption flow if PIN required

### Content

- PIN setup or entry
- confirmation field if changing
- validation message
- success toast

---

## 6. Interaction rules

### Child switching

Selecting a child updates:

- summary card
- activity preview
- reward availability
- parent controls status

### Reward redemption

If child has enough stars:

1. open PIN flow if enabled
2. confirm redemption
3. deduct stars
4. add activity entry
5. show success message

### Reward editing

Reward editing should not navigate away. Use a bottom sheet for speed.

### Star adjustment

After saving:

- update child stars immediately
- update history
- show toast confirmation

---

## 7. Visual design system

### Overall style

A modern family productivity app style:

- clean
- warm
- soft
- premium
- readable

### Light mode

- soft warm background
- white/off-white cards
- dark readable text
- orange/gold accent only for stars and primary actions
- soft borders

### Dark mode

- deep charcoal background
- slightly lighter cards
- white/near-white text
- warm orange/gold accent
- avoid overly saturated backgrounds

### Typography

- large readable headings
- no tiny captions unless necessary
- body text must be legible for older users

### Buttons

- pill-shaped or rounded rectangles
- large tap targets
- generous padding
- clear primary/secondary hierarchy

### Icons

- simple
- clear
- friendly
- not overly childish

---

## 8. Accessibility requirements

### Readability

- comfortable font sizes
- high contrast
- avoid low-contrast grey text

### Tap targets

- all buttons large enough for older users
- chips and toggles should not be too small

### Layout

- clear spacing between sections
- no cramped controls
- avoid dense text blocks

### Color use

- do not rely only on color to convey state
- show labels/tags as well

---

## 9. Required page states

### No children

Show:

- simple empty card
- message: No children added yet
- CTA: Add first child

### Child exists but no rewards

Show:

- message: No rewards yet
- CTA: Create first reward

### Child exists but no history

Show:

- message: No activity yet

### Loading state

- skeletons or soft loading cards preferred
- avoid harsh spinner-only page

### Error state

Show friendly message:

- Could not load kids data
- Try again button

---

## 10. Suggested mobile component tree

```text
KidsScreen
 ├─ ScreenHeader
 ├─ ChildSelectorCarousel
 ├─ ChildSummaryCard
 │   ├─ CurrentStars
 │   ├─ WeeklyStats
 │   └─ ActionButtons
 ├─ QuickStarActions
 ├─ ActivityPreviewCard
 ├─ RewardsSection
 │   ├─ RewardCard
 │   ├─ RewardCard
 │   └─ RewardCard
 ├─ ParentControlsCard
 ├─ AdjustStarsSheet
 ├─ RewardEditorSheet
 ├─ HistorySheet
 └─ PinSheet
```

---

## 11. Recommended copy

Use friendly, supportive wording.

### Good labels

- Encourage good habits
- Add stars
- Reward shop
- Recent activity
- Set PIN
- Redeem reward
- Great job this week

### Avoid

- robotic labels
- overly childish language
- vague buttons like Submit or Action

---

## 12. Priority implementation order

### Phase 1

- child selector
- child summary card
- add/remove stars
- reward shop cards
- reward edit/create sheet

### Phase 2

- activity/history
- PIN controls
- parent controls block

### Phase 3

- progress insights
- streaks/badges
- richer charts or reports

---

## 13. Final target experience

When a parent opens Kids, they should immediately see:

- which child they are managing
- how many stars the child has
- how to add/remove stars
- recent behavior/activity
- available rewards
- how to edit rewards
- clear PIN/redemption safety controls
