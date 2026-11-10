#!/usr/bin/env bash
# Copies new work from the org repo (remote "org") to the personal repo (remote "origin").
# Fast-forward only: it never force-pushes, so commits that exist only on
# "origin" are never overwritten. A branch that has diverged is reported and skipped.
set -u
cd "$(dirname "$0")/.."
git fetch org --prune || exit 1
git fetch origin --prune || exit 1
for ref in $(git for-each-ref --format='%(refname:strip=3)' refs/remotes/org | grep -v '^HEAD$'); do
  src="refs/remotes/org/$ref"; dst="refs/remotes/origin/$ref"
  if ! git rev-parse -q --verify "$dst" >/dev/null; then
    echo "new   $ref"; git push origin "$src:refs/heads/$ref"
  elif [ "$(git rev-parse "$src")" = "$(git rev-parse "$dst")" ]; then
    echo "same  $ref"
  elif git merge-base --is-ancestor "$dst" "$src"; then
    echo "sync  $ref"; git push origin "$src:refs/heads/$ref"
  elif git merge-base --is-ancestor "$src" "$dst"; then
    echo "ahead $ref (personal repo already has everything from org)"
  else
    echo "DIVERGED $ref — needs a manual merge, skipped"
  fi
done
