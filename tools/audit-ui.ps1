param(
  [string]$Root = "C:\coo"
)

$ErrorActionPreference = "Continue"

$paths = @(
  "$Root\frontend\app",
  "$Root\frontend\src",
  "$Root\backend"
)

Write-Host "=== Household COO UI/API audit ==="

Write-Host "`n=== Stubs / TODO / placeholders ==="
Get-ChildItem $paths -Recurse -Include *.tsx,*.ts,*.py |
  Select-String -Pattern "TODO|FIXME|stubbed|not implemented|placeholder|console\.log\(|Alert\.alert\('Error'|throw new Error" |
  Select-Object Path,LineNumber,Line |
  Format-Table -AutoSize

Write-Host "`n=== PressScale buttons missing testID ==="
Get-ChildItem "$Root\frontend\app","$Root\frontend\src" -Recurse -Include *.tsx |
  ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $matches = [regex]::Matches($content, "<PressScale[\s\S]*?>")
    foreach ($m in $matches) {
      if ($m.Value -notmatch "testID=") {
        [pscustomobject]@{ Path=$_.FullName; Snippet=($m.Value -replace "\s+"," ").Substring(0,[Math]::Min(140,($m.Value -replace "\s+"," ").Length)) }
      }
    }
  } | Format-Table -AutoSize

Write-Host "`n=== TextInput review ==="
Get-ChildItem "$Root\frontend\app","$Root\frontend\src" -Recurse -Include *.tsx |
  ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -match "TextInput") {
      [pscustomobject]@{
        Path=$_.FullName
        HasPlaceholderTextColor=($content -match "placeholderTextColor")
        HasKeyboardAvoidingView=($content -match "KeyboardAvoidingView|KeyboardAwareBottomSheet")
        HasKeyboardShouldPersistTaps=($content -match "keyboardShouldPersistTaps")
      }
    }
  } | Format-Table -AutoSize

Write-Host "`n=== Key backend gates ==="
Select-String -Path "$Root\backend\server.py" -Pattern "plan_limit_error|family_members|vault_storage|ai_scans|weekly_brief|subscription/entitlements|pricing_gating_v1"

Write-Host "`n=== Key settings controls ==="
Select-String -Path "$Root\frontend\app\(tabs)\settings.tsx" -Pattern "Plan & access|Reminder notifications|New-card alerts|Appearance|settings-lang|open-pricing|open-invite"
