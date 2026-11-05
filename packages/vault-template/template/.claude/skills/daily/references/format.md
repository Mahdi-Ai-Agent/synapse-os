# Daily review — entry format

Appended to today's journal node (labels in the UI language; titles as written):

```markdown
## 08:15 — Daily review
**Overdue (2)**
- [[Review monthly expenses]] — due 2026-10-26 · [[مالی]]
- [[تماس با دکتر رضایی]] — due 2026-10-29
**Due today (1)**
- [[مرور پروژه‌ی سایت با علی]] · [[وب‌سایت شخصی]]
**Doing (1)**
- [[Build graph view prototype]] · [[Synapse app]]
**Next action per project**
- [[Synapse app]] → [[Build graph view prototype]]
- [[وب‌سایت شخصی]] → [[مرور پروژه‌ی سایت با علی]]
- [[سفر نوروز ۱۴۰۶]] → no next action
**Today's focus (3)**
1. [[Review monthly expenses]] — overdue 5 days and it unblocks the budget goal
2. [[Build graph view prototype]] — the one active project moving; keep it moving
3. [[مدیتیشن صبحگاهی]] — three days missed; ten minutes brings the streak back

**Suggested plan**
- Morning: [[مدیتیشن صبحگاهی]] (10 min), then [[Review monthly expenses]] (45 min)
- Afternoon: [[Build graph view prototype]] (2 h)
- Evening: [[مرور پروژه‌ی سایت با علی]] — prepare three questions

**Prompt:** [[Review monthly expenses]] has slipped 5 days — what is blocking it, and is it still worth doing?
```

Rules:
- Put a blank line before every bold section label (a label right after a list would render as part of the list). Skip empty sections. At most 10 lines per section; beyond that, show the 10 most urgent and add `+N more`.
- **Today's focus** is the answer to "what should I spend time on today": exactly three lines (fewer when the day is empty), picked from the overdue and due tasks, the next actions, a goal behind its `target` or a habit with missed days — each with one clause of why, the most consequential first; when `memory/focus.md` exists, its **Now** order leads. Never a fourth.
- **Suggested plan** puts the day in order: morning · afternoon · evening, each one line with the focus items, today's habits and anything due or scheduled today, a rough length for each; leave out a part of the day with nothing for it. It only suggests: it moves no dates.
- Persian labels: عقب‌افتاده · مهلت امروز · در حال انجام · اقدام بعدی هر پروژه · تمرکز امروز · برنامه‌ی پیشنهادی (صبح · بعدازظهر · عصر) · پرسش · «بدون اقدام بعدی».
- The prompt is one question tied to the day: a task that keeps slipping (what blocks it?), a project without a next action (what is the smallest next step?), a goal whose `progress` has not moved in 14+ days (how far along is it now? — the user's answer becomes its `progress`), a quiet day (what would make today good?). Never a generic "how do you feel".
- Journal `summary` (replace, never append a second line): the day's existing gist + `;` + the review's counts, ≤ 160 chars, always quoted because of the colon — e.g. `summary: "صبح دویدم؛ مرور روزانه: ۲ عقب‌افتاده، ۱ مهلت امروز"` or `summary: "Ran in the morning; daily review: 2 overdue, 1 due today"`. A second review the same day updates the counts in place.
