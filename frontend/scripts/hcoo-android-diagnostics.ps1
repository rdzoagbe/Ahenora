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
  Write-Host "\nNode:" -ForegroundColor Yellow
  node --version

  Write-Host "\nnpm:" -ForegroundColor Yellow
  npm --version

  Write-Host "\nExpo CLI:" -ForegroundColor Yellow
  npx expo --version

  Write-Host "\nEAS CLI:" -ForegroundColor Yellow
  npx eas --version

  Write-Host "\nChecking native dependencies in package.json:" -ForegroundColor Yellow
  $pkg = Get-Content ".\package.json" -Raw | ConvertFrom-Json
  $deps = $pkg.dependencies
  foreach ($name in @("expo-dev-client", "expo-secure-store", "@react-native-google-signin/google-signin", "expo-notifications")) {
    $value = $deps.PSObject.Properties[$name].Value
    if ($value) { Write-Host "OK   $name $value" -ForegroundColor Green }
    else { Write-Host "FAIL $name is missing" -ForegroundColor Red }
  }

  Write-Host "\nADB devices:" -ForegroundColor Yellow
  adb devices

  Write-Host "\nInstalled Household COO package on connected Android device:" -ForegroundColor Yellow
  adb shell pm list packages | Select-String "household|coo|com.householdcoo" | ForEach-Object { $_.Line }

  Write-Host "\nExpo config package/scheme:" -ForegroundColor Yellow
  npx expo config --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const c=JSON.parse(d); console.log('name=', c.name); console.log('slug=', c.slug); console.log('scheme=', c.scheme); console.log('android.package=', c.android && c.android.package);})"

  Write-Host "\nDiagnostics complete." -ForegroundColor Green
  Write-Host "If ExpoSecureStore or RNGoogleSignin is missing at runtime, rebuild and reinstall the development build." -ForegroundColor Yellow
}
finally {
  Pop-Location
}
