---
description: Authoring rules for person nodes — relation, context, mentions.
paths:
  - "nodes/people/**"
---

# People

- `title` is the name as the user says it (علی, سارا احمدی, Dr. Rezaei). Add `aliases` for other forms (nickname, full name).
- `relation`: friend · family · partner · colleague · client · doctor · mentor … when stated. Never infer private details.
- Relationship facts the user shares go here: `birthday` (`YYYY-MM-DD` or `MM-DD`), `contact` (phone, e-mail or handle, only when given), `met` (how and when you met, one line). Moments and feelings with the person are `event` nodes that list them in `people`.
- Body: how they relate to the user and context worth remembering (role, project, last topic). Keep it factual and short.
- Other nodes reference a person through `people: ["[[Name]]"]`; the person node itself lists nothing — backlinks are computed.
