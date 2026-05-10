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

$content = $content.Replace("testID={\reward-idea-}", "testID={idea.title}")
$content = $content.Replace("testID={\\reward-idea-}", "testID={idea.title}")
$content = [regex]::Replace($content, 'testID=\{[^\r\n\}]*reward-idea[^\r\n\}]*\}', 'testID={idea.title}')
$content = [regex]::Replace($content, 'testID=\{\\[^\r\n\}]*\}', 'testID={idea.title}')
$content = $content.Replace("</View>\n              {rewards.length", "</View>`r`n              {rewards.length")
$content = $content.Replace("Reward good habits Â· keep it fair", "Reward good habits - keep it fair")
$content = $content.Replace("âˆ’ Stars", "- Stars")

$constants = @'
const DEFAULT_REWARD_ICON = String.fromCodePoint(0x1F381);

const REWARD_IDEAS = [
  { title: 'Pizza night', cost_stars: 50, icon: String.fromCodePoint(0x1F355) },
  { title: 'Movie night', cost_stars: 75, icon: String.fromCodePoint(0x1F3AC) },
  { title: 'Ice cream treat', cost_stars: 40, icon: String.fromCodePoint(0x1F366) },
  { title: 'Game time', cost_stars: 60, icon: String.fromCodePoint(0x1F3AE) },
] as const;

const ICON_LIBRARY: { match: string[]; icons: string[] }[] = [
  { match: ['pizza', 'dinner', 'restaurant', 'food'], icons: [String.fromCodePoint(0x1F355), String.fromCodePoint(0x1F37D), String.fromCodePoint(0x1F389), String.fromCodePoint(0x1F354)] },
  { match: ['movie', 'cinema', 'film'], icons: [String.fromCodePoint(0x1F3AC), String.fromCodePoint(0x1F37F), String.fromCodePoint(0x1F39F), String.fromCodePoint(0x2B50)] },
  { match: ['ice', 'cream', 'sweet', 'cake', 'cupcake', 'dessert'], icons: [String.fromCodePoint(0x1F366), String.fromCodePoint(0x1F9C1), String.fromCodePoint(0x1F370), String.fromCodePoint(0x1F369)] },
  { match: ['game', 'gaming', 'playstation', 'xbox', 'switch'], icons: [String.fromCodePoint(0x1F3AE), String.fromCodePoint(0x1F579), String.fromCodePoint(0x1F3C6), String.fromCodePoint(0x26A1)] },
  { match: ['park', 'outside', 'walk', 'trip'], icons: [String.fromCodePoint(0x1F333), String.fromCodePoint(0x1F6DD), String.fromCodePoint(0x2600), String.fromCodePoint(0x1F6B2)] },
  { match: ['book', 'reading', 'story'], icons: [String.fromCodePoint(0x1F4DA), String.fromCodePoint(0x1F4D6), String.fromCodePoint(0x2728), String.fromCodePoint(0x1F3C5)] },
  { match: ['toy', 'lego', 'gift'], icons: [String.fromCodePoint(0x1F9F8), String.fromCodePoint(0x1F381), String.fromCodePoint(0x1FA80), String.fromCodePoint(0x2728)] },
  { match: ['sleepover', 'friend', 'party'], icons: [String.fromCodePoint(0x1F389), String.fromCodePoint(0x1F3E0), String.fromCodePoint(0x1F9C3), String.fromCodePoint(0x2B50)] },
];
'@

$content = [regex]::Replace(
  $content,
  "const DEFAULT_REWARD_ICON[\s\S]*?function suggestedIcons",
  $constants + "`r`n`r`nfunction suggestedIcons",
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

$content = [regex]::Replace(
  $content,
  "return matches\?\.icons \|\| \[[^\]]*\];",
  "return matches?.icons || [DEFAULT_REWARD_ICON, String.fromCodePoint(0x2B50), String.fromCodePoint(0x1F389), String.fromCodePoint(0x1F3C6), String.fromCodePoint(0x2728), String.fromCodePoint(0x1F355), String.fromCodePoint(0x1F3AC), String.fromCodePoint(0x1F3AE)];"
)

$rewardIdeasSection = @'
              <View style={styles.rewardIdeasHeader}>
                <Text style={[styles.rewardIdeasTitle, { color: theme.colors.text }]}>Reward ideas</Text>
                <Text style={[styles.rewardIdeasSub, { color: theme.colors.textMuted }]}>Tap a card to prefill a reward</Text>
              </View>

              <View style={styles.rewardIdeaGrid}>
                {REWARD_IDEAS.map((idea) => (
                  <PressScale
                    key={idea.title}
                    testID={idea.title}
                    onPress={() => {
                      setRewardMode('create');
                      setEditingReward(null);
                      setRewardTitle(idea.title);
                      setRewardCost(String(idea.cost_stars));
                      setRewardIcon(idea.icon);
                      setShowRewardSheet(true);
                    }}
                    style={[
                      styles.rewardIdeaCard,
                      {
                        backgroundColor: theme.colors.card,
                        borderColor: theme.colors.cardBorder,
                        shadowColor: theme.colors.shadow,
                      },
                    ]}
                  >
                    <View style={[styles.rewardIdeaIconWrap, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}>
                      <Text style={styles.rewardIdeaIcon}>{idea.icon}</Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rewardIdeaTitle, { color: theme.colors.text }]} numberOfLines={1}>{idea.title}</Text>

                      <View style={styles.rewardIdeaCostRow}>
                        <Star color={theme.colors.accent} size={11} fill={theme.colors.accent} />
                        <Text style={[styles.rewardIdeaCost, { color: theme.colors.textMuted }]}>{idea.cost_stars} {t('stars')}</Text>
                      </View>

                      <Text style={[styles.rewardIdeaHint, { color: theme.colors.textMuted }]}>Tap to create</Text>
                    </View>
                  </PressScale>
                ))}
              </View>
              {rewards.length === 0 ? (
'@

if ($content -match "rewardIdeasHeader") {
  $content = [regex]::Replace(
    $content,
    "(?s)\s*<View style=\{styles\.rewardIdeasHeader\}>.*?\{rewards\.length === 0 \? \(",
    "`r`n" + $rewardIdeasSection,
    1
  )
} else {
  $content = [regex]::Replace(
    $content,
    "(?s)\s*<View style=\{styles\.rewardIdeaGrid\}>.*?\{rewards\.length === 0 \? \(",
    "`r`n" + $rewardIdeasSection,
    1
  )
}

$styleBlock = @'
  rewardIdeasHeader: { marginTop: 2, marginBottom: 12 },
  rewardIdeasTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, lineHeight: 22 },
  rewardIdeasSub: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, marginTop: 4 },
  rewardIdeaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  rewardIdeaCard: { flexGrow: 1, flexBasis: '47%', minHeight: 92, borderRadius: 24, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 2 },
  rewardIdeaIconWrap: { width: 52, height: 52, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rewardIdeaIcon: { fontSize: 28 },
  rewardIdeaTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, lineHeight: 18 },
  rewardIdeaCostRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  rewardIdeaCost: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  rewardIdeaHint: { fontFamily: 'Inter_600SemiBold', fontSize: 11, lineHeight: 15, marginTop: 6 },
'@

$content = [regex]::Replace(
  $content,
  "(?ms)^  rewardIdeasHeader: \{.*?^  rewardIdeaHint: \{.*?\},\r?\n",
  ""
)

$content = [regex]::Replace(
  $content,
  "(?ms)^  rewardIdeaGrid: \{.*?^  rewardIdeaCost: \{.*?\},\r?\n",
  ""
)

$styleMarker = "  rewardCard: { marginBottom:"
$styleIndex = $content.IndexOf($styleMarker)

if ($styleIndex -lt 0) {
  throw "Could not find rewardCard style marker."
}

$content = $content.Insert($styleIndex, $styleBlock)

$content = $content.Replace("<View style={{ height: 220 }} />", "<View style={{ height: 170 }} />")
$content = $content.Replace("<View style={{ height: 190 }} />", "<View style={{ height: 170 }} />")

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

git commit -m "Polish Kids reward ideas section"
git push origin $BranchName

Write-Host "Kids Reward Shop polish committed and pushed." -ForegroundColor Green