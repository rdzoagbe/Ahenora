param(
  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = "Continue"

Write-Host "Household COO Android diagnostics" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"

if (!(Test-Path $ProjectRoot)) {
  Write-Host "Project root not found: $ProjectRoot" -ForegroundColor Red
  exit 1
}

Push-Location $ProjectRoot
try {
  Write-Host ""
  Write-Host "Node:" -ForegroundColor Yellow
  node --version

  Write-Host ""
  Write-Host "npm:" -ForegroundColor Yellow
  npm --version

  Write-Host ""
  Write-Host "Expo CLI:" -ForegroundColor Yellow
  npx expo --version

  Write-Host ""
  Write-Host "EAS CLI:" -ForegroundColor Yellow
  npx eas --version

  Write-Host ""
  Write-Host "Checking native dependencies in package.json:" -ForegroundColor Yellow
  $pkg = Get-Content ".\package.json" -Raw | ConvertFrom-Json
  $deps = $pkg.dependencies
  foreach ($name in @("expo-dev-client", "expo-secure-store", "@react-native-google-signin/google-signin", "expo-notifications")) {
    $value = $deps.PSObject.Properties[$name].Value
    if ($value) { Write-Host "OK   $name $value" -ForegroundColor Green }
    else { Write-Host "FAIL $name is missing" -ForegroundColor Red }
  }

  Write-Host ""
  Write-Host "ADB devices:" -ForegroundColor Yellow
  adb devices

  Write-Host ""
  Write-Host "Installed Household COO package on connected Android device:" -ForegroundColor Yellow
  try {
    adb shell pm list packages | Select-String "household|coo|com.householdcoo" | ForEach-Object { $_.Line }
  } catch {
    Write-Host "Package listing was blocked by Android/Samsung multi-user permissions. This is non-blocking." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Expo config package/scheme:" -ForegroundColor Yellow
  npx expo config --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const c=JSON.parse(d); console.log('name=', c.name); console.log('slug=', c.slug); console.log('scheme=', c.scheme); console.log('android.package=', c.android && c.android.package);})"

  Write-Host ""
  Write-Host "Local Android signing report:" -ForegroundColor Yellow
  $androidDir = Join-Path $ProjectRoot "android"
  if (Test-Path $androidDir) {
    Push-Location $androidDir
    try {
      if (Test-Path ".\gradlew.bat") {
        .\gradlew.bat signingReport | Select-String "Variant: debug|Variant: developmentDebug|SHA1:|SHA-1:|Store:|Alias:" | ForEach-Object { $_.Line }
      } elseif (Test-Path ".\gradlew") {
        .\gradlew signingReport | Select-String "Variant: debug|Variant: developmentDebug|SHA1:|SHA-1:|Store:|Alias:" | ForEach-Object { $_.Line }
      } else {
        Write-Host "Gradle wrapper not found in android folder." -ForegroundColor Yellow
      }
    } finally {
      Pop-Location
    }
  } else {
    Write-Host "No android folder found. Run a native/prebuild or use EAS credentials for SHA-1." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Google Sign-In note:" -ForegroundColor Cyan
  Write-Host "If you installed with 'npx expo run:android --device', Google Cloud needs an Android OAuth client for com.householdcoo.app using the LOCAL debug SHA-1 above." -ForegroundColor Yellow
  Write-Host "If you installed an EAS APK, Google Cloud needs an Android OAuth client for com.householdcoo.app using the EAS SHA-1 from 'npx eas credentials -p android'." -ForegroundColor Yellow
  Write-Host "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID must be a Web OAuth client ID, not Android." -ForegroundColor Yellow

  Write-Host ""
  Write-Host "Diagnostics complete." -ForegroundColor Green
}
finally {
  Pop-Location
}
