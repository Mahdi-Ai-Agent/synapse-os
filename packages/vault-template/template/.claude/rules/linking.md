---
description: How and when to link nodes — existing titles only, relations vs body links, ghost links, the reading budget.
paths:
  - "nodes/**"
---

# Linking

- Prefer structured relations (`area`, `project`, `people`) over prose links; use body `[[links]]` for everything else that the text genuinely refers to.
- **Budget:** candidates come from the node's category sub-index, `index/by-area/<area>.md` (every item in it on one line: what it is, its people, project and tags). Pick at most 5 lines that share the node's people, project or topic words, open only those files, and link what truly relates — with one clause of why. Add `index/by-type/person.md` or `project.md` when a name needs its exact title. Never grep the whole vault to find links; a `Grep -i` is for one specific term the index lines do not carry.
- Link only to titles present in the index (titles and aliases). A link to a missing title becomes a ghost node in the graph — create the target node instead when the user clearly introduced it.
- **Across maps:** an item of one map links to an item of another only when INDEX.md → **Maps** says the two connect (`mind` stands for the mind map). Unconnected maps are linked within themselves only; the app does not draw a link across them.
- Don't over-link: 1–5 meaningful links per node. Never link a node to itself.
- When you create a new project or person that existing nodes mention, add the relation on those nodes too (open only the ones the index points to).
