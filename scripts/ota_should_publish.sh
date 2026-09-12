#!/usr/bin/env bash
#
# Should tonight's scheduled run publish an over-the-air update?
#
# The OTA moved off "every merge to main" and onto a nightly schedule, so that
# nothing ships into the middle of a family's afternoon and there is a window
# to catch a bad bundle before it travels. A nightly job needs an answer to a
# question a per-merge job never had to ask: what if nothing changed?
#
# It matters more than it sounds. `eas update` mints a NEW update group every
# time it runs, whatever the bytes contain. A client compares update ids, not
# contents, so an identical bundle republished at 02:00 is a real staged update
# to every device — and with silent apply (see src/autoApplyUpdate.ts) that is
# every user's app quietly relaunching once a day to arrive exactly where it
# already was. A quiet nightly cost paid by people who merged nothing.
#
# So: publish only when the app itself has moved since the last publish.
#
# "Since the last publish" is the `ota-published` tag, which the workflow moves
# only after `eas update` has actually succeeded. A publish that fails leaves
# the tag where it was, so tomorrow night picks up the same work rather than
# skipping it — the failure mode of this design has to be "publishes again",
# never "silently stops publishing".
#
# Usage:   scripts/ota_should_publish.sh [head-ref]
# Writes:  publish=true|false and reason=<slug> on stdout, as KEY=VALUE lines
#          suitable for $GITHUB_OUTPUT.
#
set -euo pipefail

TAG="${OTA_TAG:-ota-published}"
HEAD_REF="${1:-HEAD}"

# The paths whose contents end up inside the OTA bundle. Deliberately the same
# set the workflow filters pushes on: a backend-only or docs-only day should
# not wake every phone up. docs/app needs no entry of its own — it is generated
# from frontend/, so a change there is already a change here.
OTA_PATHS=(frontend legal)

say() {
  echo "publish=$1"
  echo "reason=$2"
}

head_sha="$(git rev-parse --verify "${HEAD_REF}^{commit}")"

# No tag yet: this is the first scheduled publish, or somebody deleted it.
# Publish. An extra update costs one relaunch; guessing "no" here would mean
# the schedule never ships anything and nobody finds out for days.
if ! last_sha="$(git rev-parse -q --verify "refs/tags/${TAG}^{commit}" 2>/dev/null)"; then
  say true first_publish
  exit 0
fi

# The tag points at something this clone cannot resolve — a force-push, a
# rewritten history, a shallow fetch. Same reasoning as above: publish.
if ! git cat-file -e "${last_sha}^{commit}" 2>/dev/null; then
  say true unknown_last_publish
  exit 0
fi

if [ "$last_sha" = "$head_sha" ]; then
  say false nothing_merged
  exit 0
fi

# `git diff --quiet` exits 1 when there IS a difference, which under `set -e`
# would kill the script — hence the explicit branch rather than `if ! git diff`.
if git diff --quiet "$last_sha" "$head_sha" -- "${OTA_PATHS[@]}"; then
  say false no_app_change
  exit 0
fi

say true app_changed
