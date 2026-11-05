# Classification

| The text… | Node | Notes |
|---|---|---|
| asks to do something (a verb + object), with or without a time | **task** | `due` if a deadline is stated/implied; `scheduled` for "on day X"; resolve relative dates from Now |
| proposes a possibility, "what if", "maybe we could", "idea:" | **idea** | link to the project/area it could serve |
| states knowledge, a fact, a meeting outcome, a learning | **note** | |
| states a target to reach, with a measure or a date ("تا بهار ۱۰ کیلومتر بدوم", "save 20%") | **goal** | `target`, `progress` when stated, `why`; link the projects/habits that serve it |
| describes a routine to repeat ("هر صبح مدیتیشن", "gym 3 times a week") or reports doing one today | **habit** (or a check-in on the existing habit) | `cadence`, `time`; a check-in = today's date added to `checkins` |
| tells something that happened — a moment, a talk, an argument, news — or a feeling about a particular person or happening | **event** (not journal) | `date`, `people`, `place`, `mood` when expressed; feelings about a person go here, linked to them |
| is a URL, book, article, tool, course, tutorial, video, reel | **resource** | `url` when present; read the page first when WebFetch is available (SKILL step 4); "I want to learn this" adds a task in the same category |
| describes a multi-step outcome with an end ("I want to launch…", "پروژه‌ی…") | **project** | needs `area`; also create its first task as the next action |
| introduces a person with context ("my colleague Ali", "دکتر رضایی دندان‌پزشکم") or shares facts about a relationship | **person** | `relation`, `birthday`, `met`, `contact` when stated; mention via `people:` from the other nodes |
| reflects on the day in general, with no particular event or person at its centre | **journal** entry | append to today's journal node |
| names a life domain no existing area covers (a new hobby, a side business, home, a field of study) | **area** (category) | create it before the nodes that belong to it; tell the user |
| says something already in the vault is done, reached, paused, dropped or so far along («تموم شد», «انجام دادم», «رسیدم», «فعلاً بی‌خیال», «نصفش رو رفتم», "finished X", "giving up on X") | **update** of that node, no new node | task `done` / `dropped`; project `done` / `paused`; goal `achieved` / `paused` / `dropped` or `progress: n`; resource `doing` / `done`; habit: today into `checkins`; plus a dated line in the body. Reply `updated [[Title]] (type) → done` |
| is too thin or too open to file well: a moment with nothing said about it («با سارا حرف زدم»), a wish with no measure, a person with no relation, something that fits two categories or none, a "soon" with no day | **ask first**, file nothing | one message: your best guess («فکر می‌کنم یک خاطره با [[سارا احمدی]] است») plus at most two questions (what was it about, how did it feel, by when, which category); file on the answer in the next turn |

Rules of thumb:
- Not everything is a task: a feeling is an event, a wish with a measure is a goal, a repeated action is a habit, a link is a resource. Pick the kind that matches what the user is telling, not what could be done about it.
- Compound sentences → several nodes, linked. "فردا با دکتر تماس بگیرم و پروژه‌ی سایت رو با علی مرور کنیم" = task (call the doctor, due tomorrow, people: doctor) + task (review the website project with Ali, project: the website, people: Ali).
- Keep the user's wording for titles (≤60 chars); the `summary` paraphrases and adds the key detail (when, with whom, why).
- Ambiguous → create a **note** and ask one short question in the reply. Never block on a question.
- Dates: "فردا" = Now + 1 day; "پس‌فردا" = +2; "هفته‌ی بعد"/"next week" = `scheduled` on the next Saturday (Persian week) unless the user's profile says otherwise; "آخر ماه" = last day of the current month. Never guess a year.
- Language: title and body in the language the user wrote; frontmatter keys always English.
