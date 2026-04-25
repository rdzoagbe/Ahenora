param(
  [string]$ApiPath = "C:\coo\frontend\src\api.ts"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $ApiPath)) {
  throw "api.ts not found at $ApiPath"
}

$backup = "$ApiPath.bak-remove-api-auth-log"
Copy-Item $ApiPath $backup -Force
Write-Host "Backup created: $backup"

$content = Get-Content $ApiPath -Raw

# Remove old direct auth-presence logs.
$content = $content -replace "\r?\n\s*console\.log\(['""]API auth: Bearer token present['""]\);", ""
$content = $content -replace "\r?\n\s*console\.log\(['""]API auth:['""],\s*['""]Bearer token present['""]\);", ""

# Remove logger-based auth-presence logs too. These are safe, but noisy.
$content = $content -replace "\r?\n\s*logger\.debug\(['""]API auth present:['""],\s*(true|Boolean\([^\)]*\))\);", ""
$content = $content -replace "\r?\n\s*logger\.debug\(['""]API auth:['""],\s*['""]Bearer token present['""]\);", ""

Set-Content $ApiPath $content -Encoding UTF8

Write-Host "Done. Remaining API auth log lines:"
Select-String -Path $ApiPath -Pattern "API auth|Bearer token present|Authorization" | Select-Object LineNumber,Line | Format-Table -AutoSize
