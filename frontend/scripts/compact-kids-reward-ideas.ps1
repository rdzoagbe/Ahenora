# Household COO - Compact Kids Reward Ideas
# Reduces the Quick Reward Ideas cards so they fit neatly in the Reward Shop.

$ErrorActionPreference = "Stop"

$RepoPath = "C:\Users\TheKwekuRO\Documents\Household-COO"
$FrontendPath = Join-Path $RepoPath "frontend"
$KidsFile = Join-Path $FrontendPath "app\(tabs)\kids.tsx"
$BranchName = "fix/kids-premium-dark-default"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

Set-Location $RepoPath

git fetch origin
git switch $BranchName
git pull origin $BranchName

if (!(Test-Path $KidsFile)) {
  throw "kids.tsx not found at $KidsFile"
}

$content = [System.IO.File]::ReadAllText($KidsFile, [System.Text.Encoding]::UTF8)

# Use a compact horizontal rail for reward ideas instead of tall masonry cards.
$content = $content.Replace(
  "<View style={styles.rewardIdeaGrid}>",
  "<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rewardIdeaGrid}>"
)
$content = $content.Replace(
  "                </View>`r`n`r`n                {rewards.length === 0 ? (",
  "                </ScrollView>`r`n`r`n                {rewards.length === 0 ? ("
)
$content = $content.Replace(
  "                </View>`n`n                {rewards.length === 0 ? (",
  "                </ScrollView>`n`n                {rewards.length === 0 ? ("
)

# Remove old compactable reward styles and insert the new smaller set.
$styleNames = @(
  'rewardIdeasSub', 'rewardIdeaGrid', 'rewardIdeaCard', 'rewardIdeaIconWrap', 'rewardIdeaIcon',
  'rewardIdeaTitle', 'rewardIdeaCostRow', 'rewardIdeaCost', 'rewardIdeaHint'
)
foreach ($styleName in $styleNames) {
  $content = [regex]::Replace($content, "(?m)^\s*$styleName\s*:\s*.*\r?\n", "")
}

$styles = @'
  rewardIdeasSub: { fontFamily: 'Inter_700Bold', fontSize: 12, lineHeight: 16, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.9 },
  rewardIdeaGrid: { gap: 10, paddingRight: 10, paddingBottom: 2, marginBottom: 16 },
  rewardIdeaCard: { width: 136, minHeight: 112, borderRadius: 22, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 8, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 2 },
  rewardIdeaIconWrap: { width: 46, height: 46, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rewardIdeaIcon: { fontSize: 25 },
  rewardIdeaTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, lineHeight: 17, textAlign: 'center' },
  rewardIdeaCostRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 1 },
  rewardIdeaCost: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  rewardIdeaHint: { fontFamily: 'Inter_600SemiBold', fontSize: 10, lineHeight: 13, marginTop: 1, textAlign: 'center' },
'@

if (-not [regex]::IsMatch($content, "(?m)^\s*rewardList:\s*\{")) {
  throw "Could not find rewardList style insertion point."
}
$content = [regex]::Replace($content, "(?m)^\s*rewardList:\s*\{", $styles + '$&', 1)

[System.IO.File]::WriteAllText($KidsFile, $content, $Utf8NoBom)

Set-Location $FrontendPath
npm run verify

if ($LASTEXITCODE -ne 0) {
  Write-Host "Verification failed. Not committing." -ForegroundColor Red
  exit $LASTEXITCODE
}

Set-Location $RepoPath

git add "frontend/app/(tabs)/kids.tsx"

git diff --cached --quiet

if ($LASTEXITCODE -eq 0) {
  Write-Host "No kids.tsx changes to commit." -ForegroundColor Yellow
  exit 0
}

git commit -m "Compact Kids reward idea cards"
git push origin $BranchName

Write-Host "Compact Kids reward idea cards committed and pushed." -ForegroundColor Green
