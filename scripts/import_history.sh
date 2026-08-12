#!/usr/bin/env bash
# Import the six source repos' full git history into legacy/<repo>/.
#
# Strategy (per the research brief): clone each repo to a temp dir,
# rewrite paths into legacy/<repo>/ with git-filter-repo, then merge
# with --allow-unrelated-histories --no-ff. History stays traceable via
# `git log --follow legacy/<repo>/...`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ROOT="${SRC_ROOT:-$HOME/Project/github}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

REPOS=(
	trading-simulator
	stock-backtester
	bot-trading-simulator
	ihsg-stock-validator
	stock-screener
	sentiment-collector-analysis
)

command -v git-filter-repo >/dev/null 2>&1 || {
	echo "git-filter-repo not found. Install: pip install git-filter-repo (or apt install git-filter-repo)" >&2
	exit 1
}

for repo in "${REPOS[@]}"; do
	src="$SRC_ROOT/$repo"
	[ -d "$src/.git" ] || {
		echo "skip: $src missing"
		continue
	}
	echo "==> importing $repo ..."
	work="$TMP/$repo"
	git clone -q --mirror "$src" "$work"
	(
		cd "$work"
		git remote remove origin 2>/dev/null || true
		git filter-repo --force --to-subdirectory-filter "legacy/$repo" >/dev/null
		git remote remove origin 2>/dev/null || true
	)
	git -C "$ROOT" remote add "$repo" "$work" 2>/dev/null || git -C "$ROOT" remote set-url "$repo" "$work"
	git -C "$ROOT" fetch -q --no-tags "$repo" main
	git -C "$ROOT" merge --allow-unrelated-histories --no-ff "FETCH_HEAD" -m "chore: merge $repo history (legacy/$repo)" >/dev/null
	git -C "$ROOT" remote remove "$repo"
	echo "    merged: legacy/$repo"
done

echo "Done. Verify with: git log --follow legacy/trading-simulator/README.md"
