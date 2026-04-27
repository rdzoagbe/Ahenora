# Household COO Android Development Build Checklist

```powershell
cd C:\coo\frontend
npm install
npm run verify
npx expo start --dev-client --host lan --clear --port 8081
```

Use the installed Household COO development build on the phone. Do not use Expo Go for Google auth, deep links, or remote notifications.