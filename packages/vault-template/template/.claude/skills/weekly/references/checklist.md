# Weekly review — PARA checklist, thresholds, entry format

Ages are computed from **Now** in the runtime context; never guess dates.

| Section | Read | Rule |
|---|---|---|
| Inbox | `INDEX.md` → Inbox | list every item; propose `capture` (file it) or `drop` for each |
| Projects | `INDEX.md` active projects, `by-type/project.md` | a project with a `next:` task is fine; without one, propose a concrete first step phrased as a task |
| Stale tasks | `by-type/task.md` | open tasks (`todo`/`doing`) with `updated` 14+ days ago, or `due` 7+ days in the past; propose reschedule, do now, or drop |
| Goals | `INDEX.md` active goals, `by-type/goal.md` | a goal whose `progress` has not changed in 30+ days → ask for a number; a goal past its `target` → ask: reached (`achieved`), still going (new `target`) or let go (`dropped`) |
| Archive candidates | `by-type/project.md`, `note.md`, `idea.md` | project `done` for 30+ days → propose `archived` (it leaves the map); project `paused` and untouched 30+ days → ask; note/idea untouched 90+ days → ask |

Entry appended to today's journal (labels in the UI language; titles as written):

```markdown
## 18:00 — Weekly review
**Inbox (2)**
- [[Check Tauri 2 mobile sidecar limits]] → capture
- [[ایده: یادآوری خودکار برای تولد دوست‌ها]] → capture
**Projects (5)**
- [[Synapse app]] → [[Build graph view prototype]]
- [[سفر نوروز ۱۴۰۶]] → ⚠ no next action
**Stale tasks (2)**
- [[Read Rust book chapters 4-6]] — todo, untouched 20 days
- [[Review monthly expenses]] — overdue 5 days
**Archive candidates (1)**
- [[بودجه‌ی سالانه]] — done, not archived
**Proposed edits**
- [ ] capture inbox item [[Check Tauri 2 mobile sidecar limits]]
- [ ] add a next action to [[سفر نوروز ۱۴۰۶]]: «مقایسه‌ی قیمت هتل‌های نزدیک حرم»
- [ ] reschedule or drop [[Read Rust book chapters 4-6]]
- [ ] archive [[بودجه‌ی سالانه]]
```

Rules:
- Put a blank line before every bold section label (a label right after a list would render as part of the list). At most 10 lines per section; beyond that add `+N more`.
- Persian labels: صندوق · پروژه‌ها · کارهای راکد · نامزدهای آرشیو · ویرایش‌های پیشنهادی.
- Each proposed edit is an instruction a later run can execute verbatim; the user ticks it in the journal or replies with which ones to apply.
- Journal `summary`: one line that mentions the review, e.g. «مرور هفتگی: ۲ صندوق، ۱ پروژه بدون اقدام بعدی».
