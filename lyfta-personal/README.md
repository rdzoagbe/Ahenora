# Lyfta Personal 🏋️

A **private, offline gym workout tracker** — a personal, single-user take on
[Lyfta](https://play.google.com/store/apps/details?id=com.lyfta). No accounts, no
subscriptions, no leaderboards, no server. Everything lives on your phone.

It keeps the part of Lyfta that actually matters — a **fast logging loop** and
**progress you can see** — and drops everything built for scale.

## What it does

- **Log a workout** — start a session, add exercises, tap in weight × reps. New
  sets prefill from last time so logging is a few taps.
- **Set types** — tap a set's number to cycle normal → warmup → drop → failure.
  Warmups are excluded from volume and PR math.
- **Auto rest timer** — marking a set done starts a countdown with a haptic buzz
  when it's up. `+30s` to extend.
- **Exercise library** — ~55 seeded lifts across every muscle group, plus your
  own custom exercises (name, muscle, equipment).
- **History** — every finished workout, with duration, volume, and set counts.
- **Progress** — per-exercise charts of estimated 1RM / top set / volume over
  time, personal records, and a session-by-session log.
- **Yours** — kg/lb, light/dark/auto, default rest length, and one-tap JSON
  export of all your data.

## Tech

- **Expo SDK 57** + **expo-router** + **TypeScript**
- **AsyncStorage** for on-device persistence (three JSON blobs — the whole "DB")
- **react-native-svg** for the progress chart (no charting dependency)
- Reuses the stack and conventions of the parent Household-COO app

## Run it

```bash
cd lyfta-personal
npm install          # uses legacy-peer-deps (see .npmrc), same as the parent app
npx expo start       # then press a for Android, i for iOS, or scan the QR code
```

Typecheck with `npm run typecheck`.

> No app icon/splash image is bundled yet — Expo uses its defaults. Drop an
> `icon.png` in `assets/` and point `app.json` at it before making a store build.

## Data model (all on-device)

| Store key             | Shape                                              |
| --------------------- | -------------------------------------------------- |
| `lyfta.exercises.v1`  | `Exercise[]` — seeded + custom                     |
| `lyfta.workouts.v1`   | `Workout[]` — finished sessions, newest first      |
| `lyfta.active.v1`     | `Workout \| null` — the in-progress session        |
| `lyfta.settings.v1`   | `Settings` — unit, rest length, appearance         |

`estimatedOneRepMax` uses the Epley formula (`w × (1 + reps/30)`), the same
"how strong am I" number most trackers use to compare a heavy triple against a
lighter set of ten.

## Deliberately out of scope

Social feeds, leaderboards, monthly challenges, expert programs, Apple Watch /
Wear OS, Strava/Health sync, and any Pro tier. This is a log for one person.
Bodyweight-only and cardio (duration) exercises are logged and kept in history,
but don't feed the strength charts, which are weight×reps by nature.
