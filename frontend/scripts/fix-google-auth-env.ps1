# Household COO - restore local Google OAuth environment
# Run from anywhere in PowerShell. This writes frontend/.env with the app's expected values.

$FrontendPath = Join-Path $PSScriptRoot ".."
$EnvPath = Join-Path $FrontendPath ".env"

$BackendUrl = "https://household-coo-production.up.railway.app"

# Public OAuth client IDs. These are not client secrets.
# Web client ID must be OAuth type: Web application.
$GoogleWebClientId = "243255248169-cei972lc7kmfig6tmjb6l2nlmgqkjf22.apps.googleusercontent.com"

# Android client ID must be OAuth type: Android, with:
# Package: com.householdcoo.app
# SHA-1: 84:C1:B5:CF:DE:FD:B4:B7:24:DE:A6:8C:C6:10:88:77:EE:56:D7:81
$GoogleAndroidClientId = "243255248169-ike4t51ha6o8c5rcgsp7mvke2g5t67o1.apps.googleusercontent.com"

@"
EXPO_PUBLIC_BACKEND_URL=$BackendUrl
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=$GoogleWebClientId
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=$GoogleAndroidClientId
"@ | Set-Content -Path $EnvPath -Encoding UTF8

Write-Host "Updated .env:" -ForegroundColor Green
Get-Content $EnvPath

Write-Host "`nNext commands:" -ForegroundColor Cyan
Write-Host "cd `"$FrontendPath`"" -ForegroundColor Yellow
Write-Host "npx expo start --clear" -ForegroundColor Yellow
