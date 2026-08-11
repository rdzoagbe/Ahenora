# "+" Quick-Capture — Build-Ready Spec (Option C: context-first hybrid)

_Status: ready to build · **Post-launch OTA** (JS-only, no rebuild) · Concept mock: the 3-direction artifact, direction **C**._

## 1. Why

Today the center **+** just `router.navigate`s to a tab (`QuickAddSheet.tsx`: task→feed, scan→kitchen, voice→feed). So it's a no-op when you're already there, and "scan a doc" wrongly lands in Kitchen. It should be a **capture**, not a jump — the code comment in `QuickAddSheet.tsx` even says so ("➕ creates, it never navigates").

**Principle:** the **+** is a context-first quick capture. It **leads with the thing the current page is about**, keeps **universal capture** (Scan · Speak · Shop) one tap away everywhere, files things in the right place, and **returns you exactly where you were.**

> capture → save → one-line confirmation → back where you were. The + never changes tabs.

## 2. The sheet (Option C)

Tap + → bottom sheet slides up over the current page:

1. **Eyebrow:** "You're on {Page}"
2. **Primary action** (big tile) = the current page's main create (see §3)
3. Divider: **"— or capture anything —"**
4. **Universal row** (always, every page): **Task · Scan · Speak · Shopping**

## 3. Context → primary action (detect via `usePathname()`)

| Current tab | Primary tile | Opens |
|---|---|---|
| **Feed** (default / unknown) | **Add a task, note or reminder** | manual composer (`openManual` flow) |
| **Calendar** | **New event** | event draft (`setAddDraft({type:'APPOINTMENT', …})`) |
| **Kids** | **Assign to a child** | kids assign flow (`openChildSheet` / assign) |
| **Kitchen** | **Add a meal** | kitchen add (or shopping item) |
| **Vault** | **Scan a document** | `CameraCaptureModal` |

Fallback when context is ambiguous → **Add a task** (Feed behaviour).

## 4. Universal row — actions & destinations

| Action | Surface (exists) | Lands (with review, never silent) |
|---|---|---|
| **Task** ✍️ | manual composer | Feed task/note. Date detected in text → **suggest** Calendar (green chip), don't auto-move. |
| **Scan** 📄 | `CameraCaptureModal` (already AI-drafts) | Draft shown for review, routed by type: appointment → **Calendar**, bill/permission slip → **task**, document → **Vault**. |
| **Speak** 🎤 | `VoiceCaptureModal` | Transcribed → task/note on Feed. |
| **Shopping** 🛒 | shopping add (`/shopping/bulk` API) | Straight onto the shared list. |

## 5. Smart routing rule (trust-preserving)

Suggest, **never silently file**:
- Typed date → suggestion chip ("add to Calendar?"), user taps to accept.
- Scan → always shows the **AI draft to confirm/edit** before saving; a "Not an appointment — save as a note" escape is always present.
- User can always override the destination.

## 6. Architecture (grounded in the code)

- **Trigger:** unchanged — `PhoneTabBar onAdd → setQuickAddOpen(true)` in `app/(tabs)/_layout.tsx`; `QuickAddSheet` renders globally there.
- **Context:** `QuickAddSheet` reads `usePathname()` to pick the primary tile.
- **Reuse, don't rebuild:** `CameraCaptureModal.tsx` and `VoiceCaptureModal.tsx` are already self-contained. The manual composer, calendar event draft, and shopping add already exist per-tab.
- **Make capture global:** lift the shared capture surfaces to the tab layout (render `CameraCaptureModal` / `VoiceCaptureModal` / manual composer / event draft / shopping-add once at `_layout`), driven by shared flags in the store — **mirror the `householdMenuOpen` pattern already added** (`store.tsx` + `_layout.tsx`). QuickAddSheet sets the flag; the global surface opens; on save it calls the existing API + shows a toast + closes. Nothing navigates.
- **Confirmation:** a lightweight global toast ("Added to your Feed" / "Saved to the Vault" / "On the shopping list").
- **Remove** the current `go(path)` navigate logic in `QuickAddSheet.tsx`.

## 7. Reuse map (what's new vs existing)

- **Existing (reuse):** CameraCaptureModal (scan + AI draft), VoiceCaptureModal, manual composer, calendar event draft, shopping bulk add, KeyboardAwareBottomSheet, DateTimePickerSheet.
- **New (small):** context-first sheet layout; the shared-flag lift to `_layout`; the confirmation toast; the "typed date → Calendar" suggestion chip; the scan draft's route-picker (appointment/task/vault).

## 8. Edge cases

- **Offline:** captures queue like existing cards (the app already has an offline queue — reuse).
- **Permissions:** camera/mic prompts handled by the existing modals.
- **Empty input:** primary "Add" disabled until there's content.
- **Kid mode:** the + should respect kid-mode restrictions (kids can't reach parent captures).

## 9. Phased OTA delivery

- **Phase 1:** context-first sheet + universal row wired to the existing capture surfaces (task/scan/speak/shop), inline, with confirmation toasts and stay-put. Scan uses the existing AI draft. *(Delivers the whole experience.)*
- **Phase 2:** the smart layer — typed-date → Calendar chip, and the scan draft's explicit route-picker with the "save as note" escape.

## 10. Testing

- New harness `e2e_quickadd`: from each tab, open +, confirm the right primary tile, run each universal action, assert it **saves via API** and **does not change tab**.
- Extend `e2e_pages`/nav to check the + opens the sheet (not a navigate).

## 11. Timing

**Post-launch OTA — JS only, no rebuild.** Ships to everyone on the production channel the moment it's published. Does **not** block promoting v55.
