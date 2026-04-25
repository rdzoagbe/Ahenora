param(
  [string]$FrontendPath = "C:\coo\frontend"
)

$ErrorActionPreference = "Stop"

function Backup-File {
  param([string]$Path)

  if (Test-Path $Path) {
    $backup = "$Path.bak-authlogs"
    Copy-Item $Path $backup -Force
    Write-Host "Backup created: $backup"
  }
}

function Ensure-Import {
  param(
    [string]$Path,
    [string]$ImportLine,
    [string]$AfterPattern
  )

  $content = Get-Content $Path -Raw

  if ($content -notmatch [regex]::Escape($ImportLine)) {
    if ($content -match $AfterPattern) {
      $content = $content -replace $AfterPattern, "`$0`r`n$ImportLine"
    } else {
      $content = "$ImportLine`r`n$content"
    }

    Set-Content $Path $content -Encoding UTF8
  }
}

function Replace-Text {
  param(
    [string]$Path,
    [string]$Old,
    [string]$New
  )

  $content = Get-Content $Path -Raw

  if ($content.Contains($Old)) {
    $content = $content.Replace($Old, $New)
    Set-Content $Path $content -Encoding UTF8
    Write-Host "Updated: $Old"
  }
}

function Replace-Regex {
  param(
    [string]$Path,
    [string]$Pattern,
    [string]$Replacement
  )

  $content = Get-Content $Path -Raw
  $updated = [regex]::Replace($content, $Pattern, $Replacement)

  if ($updated -ne $content) {
    Set-Content $Path $updated -Encoding UTF8
    Write-Host "Regex updated: $Pattern"
  }
}

$loggerPath = Join-Path $FrontendPath "src\logger.ts"
$indexPath = Join-Path $FrontendPath "app\index.tsx"
$apiPath = Join-Path $FrontendPath "src\api.ts"

if (!(Test-Path $FrontendPath)) {
  throw "Frontend path not found: $FrontendPath"
}

if (!(Test-Path $loggerPath)) {
  throw "logger.ts was not copied to $loggerPath"
}

if (Test-Path $indexPath) {
  Backup-File $indexPath

  Ensure-Import `
    -Path $indexPath `
    -ImportLine "import { logger } from '../src/logger';" `
    -AfterPattern "import \{ useStore \} from '../src/store';"

  Replace-Text $indexPath "console.log('Google webClientId:', webClientId);" "logger.debug('Google webClientId configured:', Boolean(webClientId));"
  Replace-Text $indexPath "console.log('Google androidClientId:', androidClientId);" "logger.debug('Google androidClientId configured:', Boolean(androidClientId));"
  Replace-Text $indexPath "console.log('Google auth request:', request);" "logger.debug('Google auth request ready:', Boolean(request));"
  Replace-Text $indexPath "console.log('Google response:', response);" "logger.debug('Google response type:', response?.type);"
  Replace-Text $indexPath "console.log('Google response type:', response.type);" "logger.debug('Google response type:', response?.type);"
  Replace-Text $indexPath "console.log('Google sign-in was not successful:', response.type);" "logger.debug('Google sign-in was not successful:', response.type);"
  Replace-Text $indexPath "console.log('Google response params:', response.params);" "logger.warn('Google response missing ID token.');"
  Replace-Text $indexPath "console.log('Google authentication:', response.authentication);" "logger.warn('Google authentication object omitted from logs.');"
  Replace-Text $indexPath "console.log('Google ID token received.');" "logger.info('Google ID token received.');"
  Replace-Text $indexPath "console.log('Signed in user:', result.user);" "logger.info('Signed in user:', result.user?.email || result.user?.user_id);"
  Replace-Text $indexPath "console.log('Session saved. Redirecting to feed.');" "logger.info('Session saved. Redirecting to feed.');"
  Replace-Text $indexPath "console.log('Existing authenticated user found. Redirecting to feed.');" "logger.info('Existing authenticated user found. Redirecting to feed.');"
  Replace-Text $indexPath "console.error('google sign-in failed', error);" "logger.error('google sign-in failed', error?.message || error);"
  Replace-Text $indexPath "console.error('google prompt failed', error);" "logger.error('google prompt failed', error?.message || error);"
}

if (Test-Path $apiPath) {
  Backup-File $apiPath

  Ensure-Import `
    -Path $apiPath `
    -ImportLine "import { logger } from './logger';" `
    -AfterPattern "^(import .+;(\r?\n))+"

  Replace-Text $apiPath "console.log('API_BASE_URL:', API_BASE_URL);" "logger.debug('API_BASE_URL:', API_BASE_URL);"
  Replace-Text $apiPath "console.log('API request:', url);" "logger.debug('API request:', url);"
  Replace-Text $apiPath "console.log('API auth: Bearer token present');" "logger.debug('API auth present:', true);"
  Replace-Text $apiPath "console.log('API auth:', 'Bearer token present');" "logger.debug('API auth present:', true);"
  Replace-Regex $apiPath "console\.log\('API error response:',\s*([^;]+)\);" "logger.warn('API error response:', `$1);"
  Replace-Regex $apiPath "console\.error\(([^;]+)\);" "logger.error(`$1);"
}

Write-Host ""
Write-Host "Remaining potentially risky log lines:"
Get-ChildItem (Join-Path $FrontendPath "app"),(Join-Path $FrontendPath "src") -Recurse -Include *.tsx,*.ts |
  Select-String -Pattern "console\.log|console\.error|Google response|id_token|accessToken|refreshToken|codeVerifier|Bearer token|Authorization" |
  Select-Object Path,LineNumber,Line |
  Format-Table -AutoSize

Write-Host ""
Write-Host "Done. Test with Metro before committing."
