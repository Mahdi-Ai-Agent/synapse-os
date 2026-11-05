---
description: Authoring rules for project and area nodes — PARA-style semantics, outcomes, next actions.
paths:
  - "nodes/projects/**"
  - "nodes/areas/**"
---

# Projects and areas

- **Area** = an ongoing responsibility with no end date (سلامتی, کار, خانواده, مالی, یادگیری). Few and stable; create one only when nothing in the index fits, and tell the user. An area inside a map (VAULT-SPEC "Maps") carries `map: "[[Map title]]"` and is listed under that map in INDEX.md; an area without `map` belongs to the mind map.
- **Project** = a multi-step outcome with an end. `area:` is required. Body starts with one line for the outcome (what done looks like), then the next action as `[[task title]]`, then notes — with the lead-ins in the user's language: Persian **«نتیجه:»** / **«قدم بعد:»**, English **Outcome:** / **Next action:**.
- `status`: project `active|paused|done|archived` · area `active|archived`. Closing a project («پروژه تموم شد»): `done` plus `completed: <today>`, keep its tasks' links intact; `archived` only when it should disappear from view.
- Don't create a project for a single task; a task with `area:` is enough.
