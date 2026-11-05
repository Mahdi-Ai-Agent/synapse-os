---
description: How to maintain docs/ — the STATUS ledger protocol, PLAN checkboxes, DECISIONS format, and no duplicated specs.
paths:
  - "docs/**"
---

# Docs protocol

## STATUS.md (progress ledger)

- Sections in this order: **Now** · **Done** · **Next up** · **Blocked / open questions** · **How to resume** · footer `Last updated: YYYY-MM-DD by <agent>`.
- Update at the end of every work unit and before any commit (`guard-status.sh` blocks commits otherwise).
- Only verified work goes to Done (tests ran, feature seen working). Dated, chronological. Remove finished items from Next up.
- "How to resume" lists exact commands and the read order for the next agent.

## PLAN.md

- Phases with `- [ ]` checklists and a *Done when* line. Tick a box only when the acceptance criteria hold.
- Add scope as a new checklist line; never silently delete scope — strike it (`~~...~~`) with a one-line reason.

## DECISIONS.md

- One `## YYYY-MM-DD — <decision>` entry per architectural choice: why, alternatives. Supersede with a new entry; don't rewrite history.

## Specs (ARCHITECTURE, VAULT-SPEC, BRAIN-ENGINES, UI-DESIGN)

- Canonical. When code and spec diverge, fix one and name which in the commit message.
- Never copy spec text into other docs, code comments or instruction files — link to it.
