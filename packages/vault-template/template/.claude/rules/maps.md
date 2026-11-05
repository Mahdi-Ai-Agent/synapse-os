---
description: Authoring rules for map nodes — spaces beside the mind map (the character map, a business, a page), their categories and connections.
paths:
  - "nodes/maps/**"
---

# Maps

A map is a space of its own beside the mind map (VAULT-SPEC "Maps"): its categories are areas with `map: "[[Map title]]"`, and everything filed into those categories is in the map. `index/INDEX.md` → **Maps** lists every map with its purpose, its connections and its categories.

```yaml
---
type: map
title: پیج عکاسی
summary: پیج اینستاگرام عکاسی خیابانی‌ام: لحن، مخاطب و ایده‌های محتوا.   # what it is for — /make picks the map by this line
status: active                      # active | archived
connects: [mind, "[[کاراکتر من]]"] # maps it is connected to: `mind` is the mind map; a connection named on either map counts for both
role: character                     # only on the one character map; leave out everywhere else
symbol: camera                      # optional, the mark at the island's centre in the app: person | star | briefcase | store | camera | globe | book | heart | music | code
apart: true                         # only while the user has switched the island off in the app; leave it to them
---
```

- **When a map:** a map is a separate world of the user's with parts of its own — a business, a brand or a page, a client, a big project — never a topic (a topic is a category; one item is never a map). Make one when the user asks («یه جزیره‌ی جدا براش بساز», «یه نقشه برای بیزینسم», "keep it as its own map"). When a message opens such a world that has no map yet and the user has not said where it goes, ask first — one short question with your guess (a new island connected to the mind map, or a category in it) — and file nothing for that world until they answer; their answer arrives in the same chat. «توی نقشه‌ی ذهن» / "in my mind map" means a category, never a map.
- **Making it:** `nodes/maps/<slug>.md` with `connects: [mind]` (`connects: []` when they want it kept apart), a `summary` of what it is for and a fitting `symbol` (a shop → store, a company → briefcase, a page → camera); then its first categories — areas with `map: "[[Title]]"` for the parts the message names — and the items filed into them. Say in the reply that it is a new island connected to the mind map.
- **Filing into a map:** an item about a map goes into one of that map's categories (create one inside the map when none fits), never into a mind-map category. Its `area:` is enough — items never carry `map` themselves.
- **Connections** decide two things: whether the app draws the links between the two maps and sets their islands side by side, and whether you may use one map's items while working in the other (linking, `/make`, `/advise`). Unconnected maps are read and linked separately.
- **Switched off:** `apart: true` is the island's switch in the app, turned off. The map counts as connected to nothing (INDEX.md says "switched off") while its `connects` stay as written, so switching it on brings every connection back. Never empty its `connects`; add or remove `apart` only when the user asks to switch that island off or on («جزیره‌ی … رو خاموش کن / روشن کن»).
- **The character map** (`role: character`, one per vault) is built and refreshed by `/character` from the whole vault: categories «ویژگی‌ها» / Traits, «ارزش‌ها» / Values, «دغدغه‌ها» / Concerns, «لحن» / Voice, with `note` items whose bodies cite their evidence. From conversation you may add or correct one of its items when the user says so («تو کاراکترم بنویس که…»); never rebuild it outside `/character`.
- Archiving a map (`status: archived`) hides it and its categories; deleting is the app's job (its categories go back to the mind map).
