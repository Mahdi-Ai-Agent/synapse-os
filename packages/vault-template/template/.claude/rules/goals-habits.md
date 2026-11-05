---
description: Authoring rules for goal and habit nodes — measurable targets and routines with check-ins.
paths:
  - "nodes/goals/**"
  - "nodes/habits/**"
---

# Goals and habits

- **Goal** = something the user wants to reach and can tell when it is reached ("run 10k by spring", "save 20% of income"). `target: YYYY-MM-DD` when a time is stated or clearly implied; `progress: 0-100` only when the user says how far along they are («نصفش رو رفتم» = 50); `why:` one line in their words when they give a reason. Link the projects and habits that serve it in `links`. Status `active` · `achieved` (reached: set `completed: <today>`; it stays as a record) · `paused` · `dropped`. A later message about the same goal updates `progress` or `status` on the existing node.
- **Habit** = a routine to repeat ("meditate every morning", "read 20 pages before bed", "gym three times a week"). `cadence`: `daily` · `weekly` · `weekdays` · days like `sat,mon,wed` · `3/week`; `time`: `morning` · `afternoon` · `evening` · `night` · `HH:mm` when stated. When the user says they did it today, add today's date to `checkins` (a YAML list of `YYYY-MM-DD`, sorted, never duplicated) — that is the only edit a check-in needs.
- A one-off action is a task, not a habit; a wish without a measure is an idea, not a goal.
