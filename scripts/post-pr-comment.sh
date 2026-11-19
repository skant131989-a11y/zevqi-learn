#!/usr/bin/env bash
# Posts the file given as $1 as a comment on the current pull request, or updates the comment this script posted earlier.
# The comment is recognised by the hidden marker on its first line, so there is only ever one Zevqi comment per pull request.
# Needs: gh (preinstalled on GitHub runners), GH_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_PATH (set by GitHub Actions).
set -euo pipefail

FILE="${1:?usage: post-pr-comment.sh <markdown-file>}"
MARKER="<!-- zevqi-check -->"
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }
head -n 1 "$FILE" | grep -qF "$MARKER" || { echo "the first line of $FILE must be $MARKER" >&2; exit 1; }

PR="$(jq -r '.pull_request.number // .number // empty' "$GITHUB_EVENT_PATH")"
[ -n "$PR" ] || { echo "not running for a pull request" >&2; exit 1; }

EXISTING="$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" --paginate --jq ".[] | select(.body | startswith(\"$MARKER\")) | .id" | head -n 1)"
if [ -n "$EXISTING" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$EXISTING" -F body=@"$FILE" > /dev/null
  echo "updated Zevqi comment $EXISTING on pull request #$PR"
else
  gh api -X POST "repos/$GITHUB_REPOSITORY/issues/$PR/comments" -F body=@"$FILE" > /dev/null
  echo "posted a Zevqi comment on pull request #$PR"
fi
