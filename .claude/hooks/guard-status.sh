#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash). Blocks `git commit` when files under apps/, packages/, scripts/, eval/
# or docs/PLAN.md are staged but docs/STATUS.md is not. Wired in .claude/settings.json. Requires: jq, git.
set -uo pipefail
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0
[ -n "$cmd" ] || exit 0
printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit([[:space:]]|$)' || exit 0

root="${CLAUDE_PROJECT_DIR:-$PWD}"
staged="$(git -C "$root" diff --cached --name-only 2>/dev/null)" || exit 0
if printf '%s' "$cmd" | grep -Eq '[[:space:]](-a|--all|-a[[:alpha:]]+)([[:space:]]|$)'; then
  staged="$(printf '%s\n%s' "$staged" "$(git -C "$root" diff --name-only 2>/dev/null)")"
fi
printf '%s\n' "$staged" | grep -Eq '^(apps|packages|scripts|eval)/|^docs/PLAN\.md$' || exit 0
printf '%s\n' "$staged" | grep -qx 'docs/STATUS.md' && exit 0

reason="guard-status: code or plan changes are staged but docs/STATUS.md is not. Update it (run /status) and stage it before committing."
jq -n --arg r "$reason" '{decision:"block", reason:$r, hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:$r}}'
