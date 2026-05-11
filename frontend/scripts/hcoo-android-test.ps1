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
  Write-Host ""
  Write-Host "Step 1/4 - Verifying frontend" -ForegroundColor Yellow
  npm run verify

  Write-Host ""
  Write-Host "Step 2/4 - Checking connected Android devices" -ForegroundColor Yellow
  $adbOutput = adb devices
  $adbOutput | ForEach-Object { Write-Host $_ }
  $hasDevice = $adbOutput | Select-String "\tdevice$"

  if ($hasDevice) {
    Write-Host ""
    Write-Host "Android device detected. Setting adb reverse tcp:$Port -> tcp:$Port" -ForegroundColor Green
    adb reverse "tcp:$Port" "tcp:$Port"
  } else {
    Write-Host ""
    Write-Host "No ADB device detected. The app may still work over LAN, but pressing 'a' will not work." -ForegroundColor Yellow
    Write-Host "Enable USB debugging or use --host lan manually if localhost cannot connect." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Step 3/4 - Checking whether Household COO is installed" -ForegroundColor Yellow
  $packageFound = $false

  if ($hasDevice) {
    try {
      $pathCheck = & adb shell pm path com.householdcoo.app 2>&1
      if (($pathCheck | Out-String) -match "package:") {
        $packageFound = $true
      }
    } catch {
      Write-Host "Package path check could not be completed. Continuing anyway." -ForegroundColor Yellow
    }

    if (-not $packageFound) {
      try {
        $userZeroPackages = & adb shell pm list packages --user 0 com.householdcoo.app 2>&1
        if (($userZeroPackages | Out-String) -match "com.householdcoo.app") {
          $packageFound = $true
        }
      } catch {
        Write-Host "Package list check is blocked by Android multi-user permissions. Continuing anyway." -ForegroundColor Yellow
      }
    }
  }

  if ($packageFound) {
    Write-Host "OK Household COO Android package appears installed." -ForegroundColor Green
  } else {
    Write-Host "WARNING Household COO package could not be confirmed through ADB." -ForegroundColor Yellow
    Write-Host "This can happen on Samsung/Android multi-user setups. If the app is visible on the phone, continue." -ForegroundColor Yellow
    Write-Host "If ExpoSecureStore or RNGoogleSignin is missing, install a freshly rebuilt EAS development APK." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Step 4/4 - Starting Expo dev-client Metro" -ForegroundColor Yellow
  Write-Host "Open the installed Household COO app on the phone. Do not use Expo Go." -ForegroundColor Cyan
  npx expo start --dev-client --host $HostMode --clear --port $Port
}
finally {
  Pop-Location
}
