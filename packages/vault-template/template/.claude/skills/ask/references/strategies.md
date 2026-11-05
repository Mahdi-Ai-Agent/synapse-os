# Strategies by question type

| Question | Read | Answer shape |
|---|---|---|
| "What do I have to do today / this week?" | INDEX.md tasks section → `by-type/task.md` for the week | grouped list: overdue · today · scheduled · doing, each `[[Task]]` with due date |
| "What's the status of project X?" | INDEX.md active projects → the project node → its open tasks from `by-type/task.md` | outcome, next action, open tasks, last update |
| "What do I know about X / what did I write about Y?" | `Grep -i` for the term across `nodes/` → open top matches | 3–6 bullets with `[[Title]]` sources |
| "Who is Z / when did I last talk to Z?" | `by-type/person.md` → the person node → `Grep` for `[[Z]]` | relation, context, recent mentions by date |
| "What ideas do I have for X?" | `by-type/idea.md` filtered by project/area | list with one-line summaries |
| "What happened on <date> / last week?" | `nodes/journal/<date>.md` | the day's entries, condensed |

Never answer from memory of a previous session; the vault is the source of truth.
