---
description: File format for every vault node — frontmatter schema, naming, summary, status vocabulary, wikilinks.
paths:
  - "nodes/**"
---

# Node format

One file = one node: YAML frontmatter + Markdown body. The app indexes the frontmatter, so it must be complete and valid YAML.

## Frontmatter (keys in English; text values in the user's language)

```yaml
---
type: task                          # note | idea | task | project | goal | habit | area | person | event | journal | resource | map
title: تماس با دکتر رضایی           # unique (case-insensitive); this is what [[links]] point to
summary: نوبت معاینه‌ی سالانه بگیرم؛ ترجیحاً صبح هفته‌ی بعد.   # ONE line, ≤160 chars; stands in for the file in the index
status: todo                        # vocabulary below
tags: [health]                      # lowercase kebab-case, no '#'
aliases: []                         # optional alternative titles
links: []                           # optional explicit "[[Title]]" relations
area: "[[سلامتی]]"                  # the category: required on note, idea, task, project, resource; never on area/journal/inbox
project: "[[Title]]"                # task/note/idea: when clear
people: ["[[دکتر رضایی]]"]          # mentioned people (existing titles)
map: "[[پیج عکاسی]]"               # area only: the map the category belongs to (none = the mind map); see maps.md
connects: [mind, "[[کاراکتر من]]"] # map only: the maps it is connected to
due: 2026-11-05                     # task · also scheduled: YYYY-MM-DD · priority: 1-4 (1 = highest)
date: 2026-10-31                    # journal only
updated: 2026-10-31T10:12:00+03:30  # set to "Now" from the runtime context on every edit
source: brain                       # capture | brain | manual | import
color: "#22d3ee"                    # area or map, optional: the category's or the island's colour in the graph
---
```

- **Leave out `id` and `created` when creating a node** — the app fills them. Never change an existing `id`.
- Quote links inside frontmatter: `"[[Title]]"`. Also quote any value that contains `: ` (colon + space), `#`, or starts with `[`, `{`, `*`, `&`, `!`, `|`, `>`, `%`, `@` or a quote — e.g. `summary: "مرور روزانه: ۲ عقب‌افتاده"`. An unquoted `: ` breaks the whole frontmatter. Dates are `YYYY-MM-DD`; timestamps ISO 8601 with offset.
- **Status:** note/idea/area/person/event `active|archived` · resource `active|doing|done|archived` (active = saved for later) · task `todo|doing|done|dropped` · project `active|paused|done|archived` · goal `active|achieved|paused|dropped` · habit `active|paused|archived` · journal `active`. `done` and `achieved` are history (the item stays, faded on the map; the app stamps `completed: YYYY-MM-DD`, you may write it too); `archived` and `dropped` leave the map and sit in the index's trailing "Archived" section. To close something, change its `status` — never create a new node.
- **Body labels** (bold lead-ins like the outcome of a project) are written in the user's language — «نتیجه:», «قدم بعد:», «چرا مهم است:» in Persian; "Outcome:", "Next action:", "Why it matters:" in English — never an English label on a Persian note.
- **Kind fields** (only when known): goal `target` `progress` `why` · habit `cadence` `time` `checkins` · event `date` `place` `mood` · person `relation` `birthday` `contact` `met` · resource `url` `kind` `platform` `image` `duration` `creator`. The folder rules say when to use each.

## File name

`nodes/<dir>/<slug>.md` — dirs: `notes` `ideas` `tasks` `projects` `goals` `habits` `areas` `people` `events` `journal` `resources` `maps`. Slug = title with spaces → `-`, remove `/ \ : * ? " < > | # ^ [ ] %`, Latin lowercased, Persian kept as written, ≤80 chars. Journal: `YYYY-MM-DD.md`. If the name is taken by another node, append `-2`.

## Body

Markdown. Links: `[[Title]]`, `[[Title|shown text]]`. Keep bodies short and factual; the `summary` carries the gist. Sub-steps of a task may be `- [ ]` items, but the node's `status` is authoritative. Don't repeat frontmatter fields in the body.

**History.** What happens to a node after it was created goes at the end of its body as dated lines, one per change, in the user's words: `- 2026-10-29: کفش را خریدم.` The app shows these lines as the item's history (created → updates → finished); never rewrite earlier ones.
