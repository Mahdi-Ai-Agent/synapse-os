---
description: Rules for nodes/inbox — raw captures awaiting filing by /capture.
paths:
  - "nodes/inbox/**"
---

# Inbox

- Files here are raw captures written by the app (`type: inbox`, `status: new`, body = the user's text). They are **not** knowledge yet.
- `/capture` turns each into proper nodes, then sets the inbox file's `status: filed`; the app deletes filed inbox files after the run (the vault's git history keeps the original). Never delete files yourself and never link to inbox items.
