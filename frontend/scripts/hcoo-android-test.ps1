param(
  [int]$Port = 8081,
  [string]$HostMode = "localhost"
)

$ErrorActionPreference = "Stop"

Write-Host "Household COO Android dev-build test launcher" -ForegroundColor Cyan
Write-Host "Port: $Port"
Write-Host "Host mode: $HostMode"

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
Push-Location $ProjectRoot
try {
  Write-Host "\nStep 1/4 - Verifying frontend" -ForegroundColor Yellow
  npm run verify

  Write-Host "\nStep 2/4 - Checking connected Android devices" -ForegroundColor Yellow
  $adbOutput = adb devices
  $adbOutput | ForEach-Object { Write-Host $_ }
  $hasDevice = $adbOutput | Select-String "\tdevice$"

  if ($hasDevice) {
    Write-Host "\nAndroid device detected. Setting adb reverse tcp:$Port -> tcp:$Port" -ForegroundColor Green
    adb reverse "tcp:$Port" "tcp:$Port"
  } else {
    Write-Host "\nNo ADB device detected. The app may still work over LAN, but pressing 'a' will not work." -ForegroundColor Yellow
    Write-Host "Enable USB debugging or use --host lan manually if localhost cannot connect." -ForegroundColor Yellow
  }

  Write-Host "\nStep 3/4 - Checking whether Household COO is installed" -ForegroundColor Yellow
  $packages = adb shell pm list packages 2>$null | Select-String "com.householdcoo.app"
  if ($packages) {
    Write-Host "OK Household COO Android package appears installed." -ForegroundColor Green
  } else {
    Write-Host "WARNING Household COO package was not found through ADB." -ForegroundColor Yellow
    Write-Host "Install the latest EAS development APK before testing native modules such as ExpoSecureStore and RNGoogleSignin." -ForegroundColor Yellow
  }

  Write-Host "\nStep 4/4 - Starting Expo dev-client Metro" -ForegroundColor Yellow
  Write-Host "Open the installed Household COO app on the phone. Do not use Expo Go." -ForegroundColor Cyan
  npx expo start --dev-client --host $HostMode --clear --port $Port
}
finally {
  Pop-Location
}
