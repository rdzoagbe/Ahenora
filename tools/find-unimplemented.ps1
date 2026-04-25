param(
  [string]$Root = "C:\coo"
)

$patterns = @(
  "TODO",
  "FIXME",
  "stub",
  "placeholder",
  "not implemented",
  "not configured",
  "coming soon",
  "501",
  "throw new Error"
)

$include = @("*.ts", "*.tsx", "*.py", "*.js", "*.jsx", "*.json")

Get-ChildItem $Root -Recurse -Include $include -File |
  Where-Object { $_.FullName -notmatch "node_modules|\.git|android\\build|ios\\build|dist|\.expo" } |
  Select-String -Pattern $patterns -SimpleMatch |
  Select-Object Path, LineNumber, Line |
  Format-Table -AutoSize
