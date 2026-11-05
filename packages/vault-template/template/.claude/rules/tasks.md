---
description: Authoring rules for task nodes — atomic next actions, dates, priority, parent project.
paths:
  - "nodes/tasks/**"
---

# Tasks

- One task = one concrete next action, phrased as something a person can start now ("تماس با…", "نوشتن…", "Book…"). Split compound requests into several tasks and link them with `project:` or `links:`.
- `status`: `todo` (default) · `doing` · `done` · `dropped`. Marking done («انجام دادم», «تموم شد»): set `status: done`, `completed: <today>` and `updated`; keep the file and its links. `dropped` only when the user says they will not do it.
- `due` only when the user gave or clearly implied a deadline; `scheduled` for "do it on this day". Resolve relative dates ("فردا", "هفته‌ی بعد", "next Monday") from **Now** in the runtime context; never guess a year.
- `priority` 1–4 only when urgency is stated (1 = urgent/important). Default: omit.
- Set `project:` when the task belongs to an active project in the index; otherwise set `area:` when obvious (health, work, family…). Add `people:` for names mentioned.
- Body: context the user gave, one or two lines; optional `- [ ]` sub-steps.
