# AI processing map

_What is sent to an AI provider, when, why, and what happens to the answer. Written from the code as of 20 September 2026. The provider is Google's Gemini API (`gemini-2.5-flash`, with `gemini-2.0-flash` as the fallback, chosen at runtime by `ai_models.model_candidates`). Nothing is sent unless a person asks for one of the features below at that moment; no background processing sends household data to any AI._

## 1. The routes that call the provider

| Feature | Route | What is sent | What comes back | Where it lands |
| --- | --- | --- | --- | --- |
| Document scan | `POST /api/vision/extract` | The photographed page (cropped to the document server-side), the household's member names for assignment, a fixed system prompt | Kind, type, title, date, assignee, vault category, whether to file it | A card the person reviews before saving; a vault document if they choose |
| Scanned appointment | `POST /api/calendar/candidates/from-scan` | Nothing new; the extraction above | — | A calendar candidate the person keeps or drops |
| Voice note | `POST /api/voice/transcribe` | The audio recording, member names, a fixed prompt | Transcript and a draft card | A draft the person edits before saving |
| Shopping list photo | `POST /api/shopping/scan` | The photo | Item names | Shopping list |
| Receipt photo | `POST /api/expenses/scan-receipt` | The photo | Merchant, amount, items | An expense the person confirms |
| Recipe from a photo or the fridge | `POST /api/recipes/capture`, `/api/recipes/chef` | The photo or the list of ingredients typed | A recipe | Kitchen |
| Recipe or meal suggestions | `POST /api/recipes/generate`, `/api/meals/suggest-ai`, `/api/meals/from-capture` | Preferences and ingredients typed by the person | Suggestions | Kitchen |
| Assign a task | `POST /api/ai/assign` | The card title and the member names | A suggested assignee | A suggestion in the add sheet |

Not sent, ever: passwords, tokens, email addresses, the vault as a whole, chat messages, the health record, billing data.

## 2. Controls around every call

- **Consent is the tap.** Every route above is a deliberate action in the interface, named as AI in the app and in the privacy policy ("when you ask Ahenora to read a scan or suggest a recipe").
- **Quota.** Scans are metered per household and per month (`ai_scans_per_month`; 10 on the free plan); the counter only increments when the provider actually read something.
- **Input gate.** Text is screened for prompt-injection patterns and invisible characters and length-capped before it is sent (`ai_safety._INJECTION_RE`, `MAX_MESSAGE_LEN`); images are cropped to the page (`document_crop`).
- **Output gate.** Every answer is parsed as JSON and validated against a fixed shape before anything reaches a person (`validate_document_scan`, `validate_captured_recipe`, `_safe_voice_draft`): unknown fields dropped, categories restricted to a closed list, a refusal or unparseable answer becomes a plain blank card rather than a guess. A recipe is additionally checked for unsafe instructions.
- **A person decides.** No AI answer is saved without the person seeing it: scans become drafts, appointments become candidates to keep or drop, assignments are suggestions.
- **Failure is visible.** Model retirement, quota and network errors are surfaced to the admin health check (`/api/health/ai`), and a fallback model is tried before giving up. This exists because a retired model name once failed silently for weeks (documented in `docs/AI_SAFETY_CHECKLIST.md`).
- **No training on our data.** Requests go through the paid Gemini API; per Google's API terms for paid usage, prompts and responses are not used to train models **[CONFIRM against the current terms before filing]**. Ahenora sets no retention on the provider side and stores the answer itself in our database.
- **Logs.** Our logs record that a call happened, which model answered, timing and error class; never the image, audio or extracted text.

## 3. What is genuinely uncertain, and what the funded programme would test

This is the section the strategy asks for: not "we use AI", but where the orchestration is unproven.

1. **Interpretation → action, across sources.** The same household input arrives typed, spoken, photographed or imported. Today each route has its own prompt and validator. Whether one interpretation layer can decide reliably what a thing is (event, task, shopping, meal, document) and where it goes, across four languages and the messy formats real schools and clinics use, is untested at scale. The measurable question: how often does the automatic routing need correcting.
2. **Assignment and reminders that people accept.** Suggesting who should do a task, and when to remind, is a prediction about a household. We do not know the acceptance rate, nor the cost of a wrong suggestion in trust. Humans keep control of consequential actions; the experiment is whether suggestions earn enough acceptance to be worth showing.
3. **Multi-adult state.** The hard part is not extraction but keeping two adults, two homes and a helper in one consistent state with per-item privacy. Measuring conflict, duplicates and "who saw what" errors in real households is the work.
4. **Cost and latency envelope.** Scans currently take seconds and are metered; whether a model small enough to be cheap per household is accurate enough for school letters is an open trade-off.

## 4. Data subject rights and AI

A person can see every AI-derived item (it is a card, a candidate or a suggestion they reviewed), correct it in place, delete it, and take a copy of it through "Download my data". There is no automated decision with legal or similarly significant effect: the AI proposes and a parent disposes.
