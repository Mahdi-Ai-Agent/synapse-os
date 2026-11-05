---
description: The self-improvement loop — when and how to record lessons, and how they get promoted into rules.
paths:
  - "memory/**"
---

# Self-improvement loop

Three tiers: always-loaded human-owned instructions (`AGENTS.md`, `.claude/rules/`), agent-owned `memory/lessons.md` (+ `memory/<topic>.md` overflow), and the `/retro` promotion gate.

Record a lesson when a test/build/validate command fails (the `capture-lesson.sh` hook appends a `pending-review` stub), when the user corrects you, or at an end-of-task retro.

Format, one line per entry under a `## <topic>` heading:
`- NEVER/ALWAYS <rule>. Why: <one line>. Fix: <command or path>. (seen: N, last: YYYY-MM-DD)`

Before writing, search for a duplicate or contradiction and edit or remove it. Never record obvious facts or one-off trivia. On the second occurrence (`seen: 2`), run `/retro` to propose a rule; never edit always-loaded files without approval.
