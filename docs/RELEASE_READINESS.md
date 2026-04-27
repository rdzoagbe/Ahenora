# Household COO Release Readiness

## Current status after Priority Fix Pack

- SecureStore token handling added with AsyncStorage migration fallback.
- Missing NotificationSettings frontend type added.
- Root font loading added.
- Frontend typecheck/verify scripts added.
- Backend CORS can now be controlled by environment variable.
- PIN hashing upgraded to salted bcrypt with legacy SHA-256 verification/migration.
- Backend card PATCH now accepts editable fields for future card edit UI.
- Railway Dockerfile path corrected for repo-root deployment.

## Next manual validation

1. Run `npm run verify` in `frontend`.
2. Run backend syntax check: `python -m py_compile backend/server.py`.
3. Test Google sign-in in dev build.
4. Test invite acceptance with a second account.
5. Test notifications on two devices.
6. Commit and push.