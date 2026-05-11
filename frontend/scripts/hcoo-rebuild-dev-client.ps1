param(
  [switch]$ClearCache = $true
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path

Write-Host "Household COO development-client rebuild helper" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"

Push-Location $ProjectRoot
try {
  Write-Host "\nStep 1/4 - Installing dependencies from lockfile" -ForegroundColor Yellow
  npm install

  Write-Host "\nStep 2/4 - Verifying frontend" -ForegroundColor Yellow
  npm run verify

  Write-Host "\nStep 3/4 - Confirming native modules required by the dev build" -ForegroundColor Yellow
  $pkg = Get-Content ".\package.json" -Raw | ConvertFrom-Json
  foreach ($name in @("expo-secure-store", "@react-native-google-signin/google-signin", "expo-notifications", "expo-dev-client")) {
    $value = $pkg.dependencies.PSObject.Properties[$name].Value
    if (!$value) { throw "Missing required native dependency in package.json: $name" }
    Write-Host "OK $name $value" -ForegroundColor Green
  }

  Write-Host "\nStep 4/4 - Starting EAS Android development build" -ForegroundColor Yellow
  if ($ClearCache) {
    npx eas build --profile development --platform android --clear-cache
  } else {
    npx eas build --profile development --platform android
  }

  Write-Host "\nWhen the build succeeds, open the EAS build link on the Samsung S23 and install the APK." -ForegroundColor Cyan
  Write-Host "Then run: npm run android:test" -ForegroundColor Cyan
}
finally {
  Pop-Location
}
