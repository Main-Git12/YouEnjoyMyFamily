#!/bin/bash
# SessionStart hook (project-level): report real git/GitHub sync state at
# the top of every session in this repo, so Claude — or any other agent
# that honors .claude/settings.json — sees ground truth instead of trusting
# a carried-over conversation summary. Committed to the repo so it applies
# regardless of which machine, container, or account opens it.
#
# Fails silently (exit 0, no output) outside a git repo or when there's no
# remote/upstream to compare against.

cat >/dev/null # drain stdin (unused)

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

if [[ -z "$(git remote 2>/dev/null)" ]]; then
  exit 0
fi

branch=$(git branch --show-current 2>/dev/null)
if [[ -z "$branch" ]]; then
  exit 0
fi

remote_name=$(git config "branch.$branch.remote" 2>/dev/null)
[[ -z "$remote_name" ]] && remote_name=origin

fetch_ok=true
if ! timeout 15 git fetch --quiet "$remote_name" "$branch" 2>/dev/null; then
  fetch_ok=false
fi

upstream="$remote_name/$branch"

if ! git rev-parse -q --verify "$upstream" >/dev/null 2>&1; then
  msg="Git sync check: on branch '$branch', but '$upstream' does not exist — no remote tracking branch yet (new local branch, or it hasn't been pushed)."
else
  # `git rev-list --left-right --count A...B` prints "<only-in-A> <only-in-B>"
  read -r behind ahead < <(git rev-list --left-right --count "$upstream...HEAD" 2>/dev/null)
  behind=${behind:-0}
  ahead=${ahead:-0}

  fetch_note=""
  [[ "$fetch_ok" == "false" ]] && fetch_note=" (fetch failed or timed out — this comparison may be stale)"

  if [[ "$ahead" -eq 0 && "$behind" -eq 0 ]]; then
    msg="Git sync check: branch '$branch' is up to date with '$upstream'$fetch_note."
  elif [[ "$behind" -gt 0 && "$ahead" -eq 0 ]]; then
    msg="Git sync check: branch '$branch' is $behind commit(s) BEHIND '$upstream'$fetch_note. Pull/merge before continuing so work builds on the real current state, not stale local history."
  elif [[ "$ahead" -gt 0 && "$behind" -eq 0 ]]; then
    msg="Git sync check: branch '$branch' is $ahead commit(s) ahead of '$upstream'$fetch_note (local work not yet pushed)."
  else
    msg="Git sync check: branch '$branch' has DIVERGED from '$upstream'$fetch_note — $ahead commit(s) only local, $behind commit(s) only on the remote. Do not force-push to reconcile; investigate what changed on each side first."
  fi
fi

jq -n --arg msg "$msg" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $msg}}'
