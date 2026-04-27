# Household COO Deployment Checklist

## Standard Git workflow

```powershell
cd C:\coo
git status
git add .
git commit -m "Your message"
git push origin main
```

## Railway deployment rule

Only redeploy Railway when files under `backend/`, `railway.json`, or backend environment variables changed.

```text
Railway > Backend service > Deployments > Deploy Latest Commit
```

## Required backend environment variables

```text
MONGO_URL=
DB_NAME=household_coo
GOOGLE_WEB_CLIENT_ID=
GOOGLE_ANDROID_CLIENT_ID=
GOOGLE_CLIENT_IDS=
GOOGLE_API_KEY=
ADMIN_EMAILS=
INVITE_BASE_URL=
RESEND_API_KEY=
INVITE_FROM_EMAIL=
INVITE_REPLY_TO=
APP_NAME=Household COO
CORS_ALLOWED_ORIGINS=
```

For local development, `CORS_ALLOWED_ORIGINS` can be left empty. For production, set it to the exact frontend origins when you have them.