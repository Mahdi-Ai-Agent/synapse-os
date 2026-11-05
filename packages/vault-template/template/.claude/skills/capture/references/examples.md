# Examples

## 1. Persian compound capture

Input (Now = 2026-10-31, Friday): «فردا با دکتر رضایی تماس بگیرم و پروژه‌ی سایت رو با علی مرور کنیم»

Index shows: area [[سلامتی]], person [[دکتر رضایی]], project [[وب‌سایت شخصی]], person [[علی]].

Files:

`nodes/tasks/تماس-با-دکتر-رضایی.md`
```yaml
---
type: task
title: تماس با دکتر رضایی
summary: فردا (۹ آبان) با مطب دکتر رضایی تماس بگیرم.
status: todo
area: "[[سلامتی]]"
people: ["[[دکتر رضایی]]"]
due: 2026-11-01
updated: 2026-10-31T14:05:00+03:30
source: capture
---
```

`nodes/tasks/مرور-پروژه‌ی-سایت-با-علی.md`
```yaml
---
type: task
title: مرور پروژه‌ی سایت با علی
summary: جلسه‌ی مرور وضعیت [[وب‌سایت شخصی]] با علی.
status: todo
project: "[[وب‌سایت شخصی]]"
people: ["[[علی]]"]
updated: 2026-10-31T14:05:00+03:30
source: capture
---
```

Reply:
```
created [[تماس با دکتر رضایی]] (task)
created [[مرور پروژه‌ی سایت با علی]] (task)
```

## 2. English idea with a new resource

Input: "Idea: use the vault's git history as a time-lapse of my thinking. Related article https://example.com/git-as-memory"

Files: `nodes/ideas/git-history-as-thinking-time-lapse.md` (type idea, project: `"[[Synapse app]]"` if that project exists in the index) and `nodes/resources/git-as-memory.md` (type resource, `url`). The idea's body links `[[git-as-memory]]` by its title.

## 3. Journal-like text

Input: «امروز خیلی خسته بودم، ولی تمرین صبح رو انجام دادم.»

Action: append to `nodes/journal/2026-10-31.md` under `## 14:05`; link `[[برنامه‌ی تناسب اندام]]` if that project exists. Update the journal `summary`. Reply: `updated [[2026-10-31]] (journal)`.

## 4. A new category from chat

Input: «می‌خوام برای گیاه‌های خونه یه برنامه‌ی آبیاری بذارم، اول یه گلدون سانسوریا بخرم»

Index **Areas**: سلامتی · مالی · کار · خانواده · یادگیری — none covers home and plants.

Files: `nodes/areas/خانه.md` (type area, summary «خانه، گیاهان و نگهداری آن»), `nodes/projects/برنامه‌ی-آبیاری-گیاهان.md` (type project, `area: "[[خانه]]"`, body: outcome), `nodes/tasks/خرید-گلدان-سانسوریا.md` (type task, `area: "[[خانه]]"`, `project: "[[برنامه‌ی آبیاری گیاهان]]"`).

Reply:
```
created [[خانه]] (area) (new category)
created [[برنامه‌ی آبیاری گیاهان]] (project) → [[خانه]]
created [[خرید گلدان سانسوریا]] (task) → [[خانه]]
```

## 5. A tutorial link to learn later

Input: «این آموزش رو پیدا کردم، می‌خوام بعداً یادش بگیرم: https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html»

Action: WebFetch the URL; `nodes/resources/understanding-ownership.md` (type resource, title from the page, summary of what it teaches, 3–6 key points, `url`, `area: "[[یادگیری]]"`) and a task «مطالعه‌ی Understanding Ownership» in the same category linking the resource (and `project: "[[یادگیری Rust]]"` when that project exists).

## 6. A feeling about someone (not a task)

Input: «دیروز با علی سر ددلاین بحثمون شد، حس بدی دارم؛ ولی دوستیمون برام مهمه»

Files: `nodes/events/بحث-با-علی-سر-ددلاین.md` (type event, `date` = yesterday, `people: ["[[علی]]"]`, `mood: low`, `area: "[[کار]]"`, body: what happened and the feeling, in the user's words). On `nodes/people/علی.md` append a dated line to the body only if the user states a lasting fact about the relationship (here: the friendship matters to them). No task unless the user asks for one.

## 7. A goal and a habit

Input: «می‌خوام تا عید ۵ کیلو کم کنم؛ از فردا هر روز صبح پیاده‌روی می‌کنم»

Files: `nodes/goals/کم-کردن-۵-کیلو-تا-عید.md` (type goal, `target` = Nowruz date, `why` only if given, `area: "[[سلامتی]]"`, `links: ["[[پیاده‌روی صبحگاهی]]"]`) and `nodes/habits/پیاده‌روی-صبحگاهی.md` (type habit, `cadence: daily`, `time: morning`, `area: "[[سلامتی]]"`). Later, «امروز پیاده‌روی کردم» = add today to that habit's `checkins`.

## 8. A reel to watch later

Input: «این ریلز درباره‌ی تمرکز رو بعداً ببینم https://www.instagram.com/reel/…»

File: `nodes/resources/ریلز-تمرکز.md` (type resource, `url`, `kind: reel`, `platform: instagram`, status `active`, `area` by topic, body: what it is about from the user's words or the fetched page).

## 9. Finishing something (a status update, not a new node)

Input: «فصل‌های ۴ تا ۶ کتاب Rust رو خوندم، اون کار تموم شد»

Index `by-type/task.md` shows: `[[Read Rust book chapters 4-6]] — … · todo`. Action: edit that file only — `status: done`, `completed: <today>`, `updated: Now`, and one dated line at the end of the body: `- 2026-10-31: فصل‌های ۴ تا ۶ را تمام کردم.` (the app shows it as the item's history); no new task, no journal entry unless they reflect on the day. Reply: «کار خواندن فصل‌های ۴ تا ۶ را تمام‌شده ثبت کردم.» then `updated [[Read Rust book chapters 4-6]] (task) → done`.

Input: «هدف پس‌اندازم حدود ۸۰ درصد پیش رفته» → the goal's `progress: 80`, `updated: Now`, body line `- 2026-10-31: حدود ۸۰٪ رسیده.`; reply `updated [[پس‌انداز ۲۰٪ درآمد]] (goal) → 80%`.

## 10. Too thin to file: ask first

Input: «با سارا حرف زدم»

Index shows person [[سارا احمدی]] and nothing else about a talk. The words give no topic, no day, no feeling — filing a moment now would be an empty node. Action: change nothing. Reply:

«با سارا احمدی؟ درباره‌ی چی حرف زدید و حس‌ات بعدش چطور بود؟ بگویی، به‌عنوان یک خاطره کنار او ثبتش می‌کنم.»

Next turn, the user: «درباره‌ی ددلاین سایت؛ خوب بود، خیالم راحت شد.» → `nodes/events/حرف-زدن-با-سارا-درباره‌ی-ددلاین-سایت.md` (type event, `date` = today, `people: ["[[سارا احمدی]]"]`, `mood: good`, `area: "[[کار]]"`, links `[[وب‌سایت شخصی]]` when the index has it). Reply: `created [[حرف زدن با سارا درباره‌ی ددلاین سایت]] (event) → [[کار]]`.

A clear message never waits: «دیروز با سارا سر ددلاین سایت حرف زدیم، خیالم راحت شد» files at once.

## 11. A new world: ask where it goes

Input: «دارم یه پادکست راه می‌ندازم؛ باید میکروفون بخرم و برای اپیزود اول مهمون پیدا کنم»

Index shows no map for it under **Maps**. A podcast with parts of its own (gear, guests, episodes) is a world that may want its own island, and the user has not said where it goes. Action: change nothing. Reply:

«برای پادکست یه جزیره‌ی جدا بسازم که به نقشه‌ی ذهنت وصل باشه (با دسته‌هایی مثل «تجهیزات» و «مهمان‌ها»)، یا یه دسته‌ی «پادکست» توی نقشه‌ی ذهن کافیه؟»

Next turn, «جزیره بساز» → `nodes/maps/پادکست.md` (type map, `connects: [mind]`, `symbol: music`, a summary of what it is for), areas «تجهیزات» and «مهمان‌ها» with `map: "[[پادکست]]"`, the two tasks filed into them; the reply says it is a new island connected to the mind map. «توی نقشه‌ی ذهن» → a category «پادکست» in the mind map instead.

When the user already said where («یه جزیره‌ی جدا براش بساز», "make it its own map"), make it at once without asking. One wish or a passing topic («می‌خوام گیتار یاد بگیرم») never raises the question: it is a category.
