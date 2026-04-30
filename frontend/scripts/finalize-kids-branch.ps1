# Household COO - Finalize Kids premium branch
# Verifies the frontend, commits safe app changes, and pushes the branch.
# It deliberately ignores .env files so secrets/local config are not committed.

$ErrorActionPreference = "Stop"

$RepoPath = "C:\Users\TheKwekuRO\Documents\Household-COO"
$FrontendPath = Join-Path $RepoPath "frontend"
$BranchName = "fix/kids-premium-dark-default"

Set-Location $RepoPath

git fetch origin
git switch $BranchName
git pull origin $BranchName

Write-Host "`n=== Current git status ===" -ForegroundColor Cyan
git status --short

Write-Host "`n=== Verifying frontend ===" -ForegroundColor Cyan
Set-Location $FrontendPath
npm run verify

if ($LASTEXITCODE -ne 0) {
  Write-Host "Verification failed. Fix errors before committing." -ForegroundColor Red
  exit $LASTEXITCODE
}

Set-Location $RepoPath

# Never commit local environment files.
git reset -- frontend/.env 2>$null

# Stage the files that are expected from this workstream if they exist or changed.
$filesToStage = @(
  "frontend/app/(tabs)/kids.tsx",
  "frontend/app/index.tsx",
  "frontend/package.json",
  "frontend/package-lock.json",
  "frontend/scripts/polish-kids-reward-shop.ps1",
  "frontend/scripts/commit-kids-reward-shop-local.ps1",
  "frontend/scripts/compact-kids-reward-ideas.ps1"
)

foreach ($file in $filesToStage) {
  if (Test-Path (Join-Path $RepoPath $file)) {
    git add $file
  }
}

# Unstage .env again defensively in case it was added by a wildcard elsewhere.
git reset -- frontend/.env 2>$null

git diff --cached --quiet

if ($LASTEXITCODE -eq 0) {
  Write-Host "`nNo staged changes to commit. Branch may already be clean." -ForegroundColor Yellow
} else {
  Write-Host "`n=== Staged changes ===" -ForegroundColor Cyan
  git diff --cached --name-only

  git commit -m "Finalize Kids premium screen and Android sign-in"
  git push origin $BranchName
}

Write-Host "`n=== Final git status ===" -ForegroundColor Cyan
git status --short

Write-Host "`nFinalization complete. If only .env remains modified, that is expected and should stay local." -ForegroundColor Green
