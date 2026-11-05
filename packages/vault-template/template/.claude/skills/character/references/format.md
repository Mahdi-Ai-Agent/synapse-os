# Character map — item format

Each item is a `note` in one of the map's categories. Its title is the trait, value, concern or voice rule in the owner's words; its summary one line; its body the evidence.

```markdown
---
type: note
title: سازنده‌ام، نه جمع‌کننده
summary: وقتی چیزی می‌خوانم می‌خواهم ازش چیزی بسازم؛ Synapse و مینی‌دوره‌ی Rust از همین‌جا می‌آیند.
status: active
area: "[[ویژگی‌ها]]"
source: brain
---
شاهد: [[Synapse app]] بعد از یادداشت [[Obsidian: why it didn't stick]]؛ [[مینی‌دوره‌ی Rust برای دوستان]] وسط خواندن کتاب.
```

| Category | What an item is | Evidence |
|---|---|---|
| Traits («ویژگی‌ها») | a way they act that shows up more than once | 2+ nodes, a streak, a pattern across projects |
| Values («ارزش‌ها») | what they give time to even under pressure | goals, habits with check-ins, what they finish |
| Concerns («دغدغه‌ها») | a worry they wrote about themselves | moments, journal lines, slipping tasks they mention |
| Voice («لحن») | how they write: sentence length, register, words, humour | two quoted lines from their own journal or notes, and what they never write |

Rules:
- Titles in the owner's language, as a person would say it about themselves; no labels like "Type A".
- A voice item quotes the owner (`«…»`), never paraphrases, and says what to avoid as much as what to do.
- One fact per item; merge near-duplicates on a refresh instead of adding a second.
- Items link only to titles in the index.
