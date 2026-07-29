# Household COO Android Development Build Checklist

```powershell
cd C:\coo\frontend
npm install
npm run verify
npx expo start --dev-client --host lan --clear --port 8081
```

Use the installed Household COO development build on the phone. Do not use Expo Go for Google auth, deep links, or remote notifications.
## Shipping a build to Google Play

Run the **EAS Build (Android)** workflow from the Actions tab. Three inputs:

| Input | Use |
|---|---|
| `profile` | `production` — the only one that produces an app bundle Play accepts |
| `submit` | Leave **on**, or the build stops at Expo and never reaches Play |
| `track` | `internal` to test on your own phone, `production` for a release |

`internal` publishes to Internal testing as a completed release, so it appears
on testers' devices straight away. `production` uploads as a **draft** — it
still has to be promoted by hand in Play Console, deliberately.

Both need the `GOOGLE_SERVICE_ACCOUNT_KEY` repo secret. Without it the build
still succeeds and the submit is skipped.

### If the build succeeded but nothing appeared on your phone

This has already happened once: a build completed, the submit step was skipped,
and the AAB sat on Expo for a day before anyone noticed. The run page now says
so in a warning and in the job summary — check there first. The three reasons a
submit is skipped are `submit` left off, a non-production profile, and a missing
service-account secret.

The bundle is never lost: download it from the EAS dashboard and upload it to
Play Console by hand.

### Version numbers

`app.json` deliberately has no `android.versionCode`. `eas.json` sets
`appVersionSource: remote` with `autoIncrement` on the production profile, so
**EAS assigns the version code** and the repo never carries a stale one. That
means the version number of a build is only knowable from the EAS dashboard or
Play Console — do not infer it from anything in this repository.
