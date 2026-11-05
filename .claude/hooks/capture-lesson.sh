#!/usr/bin/env bash
# PostToolUseFailure hook (matcher: Bash): when a test/build/validate command fails, append a
# pending-review stub to memory/lessons.md and nudge the agent to record a real lesson. Requires: jq.
set -uo pipefail
COMMAND_PATTERN='test|vitest|typecheck|tsc|validate|lint|build|eval'

input="$(cat)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0
[ -n "$command" ] || exit 0
printf '%s' "$command" | grep -Eiq "$COMMAND_PATTERN" || exit 0

error_message="$(printf '%s' "$input" | jq -r '
  if (.error_message // null) != null then .error_message
  elif ((.tool_response // null) | type) == "string" then .tool_response
  else "" end' 2>/dev/null)" || error_message=""
[ -n "$error_message" ] || exit 0
first_line="$(printf '%s' "$error_message" | head -n 1 | cut -c1-160)"

root="${CLAUDE_PROJECT_DIR:-.}"
lessons="$root/memory/lessons.md"
mkdir -p "$root/memory"
[ -f "$lessons" ] || printf '# Lessons (index)\n' > "$lessons"
{
  printf '\n## pending-review (%s)\n' "$(date +%Y-%m-%d)"
  printf -- '- FAILURE during: `%s` (%s). Reflect on the root cause, rewrite as a NEVER/ALWAYS lesson under its topic, then dedupe.\n' "$command" "${first_line:-no error detail}"
} >> "$lessons"

jq -n '{ hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext:
  "A test/build command failed. A stub was appended to memory/lessons.md under pending-review. Record a proper lesson per .claude/rules/self-improvement.md." } }'
