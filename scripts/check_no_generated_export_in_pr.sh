#!/usr/bin/env bash
#
# A pull request must not carry the generated web export.
#
# docs/app is `npx expo export` output. It is committed to main — GitHub Pages
# uploads the checked-out docs/ folder, so the live site needs it there — but
# ONE thing is allowed to write it: the export bot, on main, after a merge.
#
# When a branch writes it too, both sides of every later merge have edited the
# same 100 generated HTML files and git cannot reconcile them. It is not a
# near-miss: main's bot rewrites that export after every single merge, so every
# open pull request conflicts the moment any other one lands. On 12 September
# that cost five full CI rounds — about two hours — across six pull requests,
# and every one of those conflicts was in generated markup nobody reads.
#
# Nothing is lost by leaving it out. The browser-harness job builds its own
# export from the branch's source precisely so it tests THIS commit rather than
# a stale artefact, and the Pages deploy runs from main after the merge.
#
# So: build it locally to run the harnesses if you like, then leave it behind.
#   git checkout -- docs/app
#
set -euo pipefail

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "usage: $0 <base-ref>" >&2
  exit 2
fi

changed="$(git diff --name-only "${BASE}...HEAD" -- docs/app || true)"

if [ -z "$changed" ]; then
  echo "ok: this branch leaves the generated export alone"
  exit 0
fi

count="$(printf '%s\n' "$changed" | grep -c . || true)"
echo "::error::This branch commits ${count} file(s) under docs/app, which is generated."
printf '%s\n' "$changed" | head -10 | sed 's/^/    /'
[ "$count" -gt 10 ] && echo "    ... and $((count - 10)) more"
cat <<'MSG'

docs/app is `npx expo export` output. Only the export bot writes it, on main,
after a merge — because main rewrites it after EVERY merge, so a branch that
also writes it conflicts with every other open pull request.

Drop it and push again:

    git checkout -- docs/app        # or: git rm -r --cached docs/app && git checkout -- docs/app

The harness job builds its own export from this branch's source, so nothing
here goes untested by leaving it out.
MSG
exit 1
