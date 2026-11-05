# Research brief (2026-10-31)

What was studied before the plan, what was borrowed, what was rejected. Documentation only — not loaded at runtime.

## 1. agent-creator (the user's meta-agent) — patterns adopted

Read in full (`CLAUDE.md`, all `.claude/rules/*`, skills `create-agent`/`refine-agent`/`validate-agent`/`research-prior-art`/`retro`, `agent-auditor`, hooks, templates, `memory/lessons.md`).

| Pattern | Where Synapse applies it |
|---|---|
| `CLAUDE.md` as a thin index; `@` import only for always-needed files; backticked paths otherwise | repo `AGENTS.md`/`CLAUDE.md`; vault `AGENTS.md`/`CLAUDE.md` |
| Rules with `paths:` globs load only when matching files are touched | repo `.claude/rules/*` per area; vault rules per node type folder |
| Skill `description` is the trigger (third person, what + when, user-language phrases) and is measured by an eval harness that runs `claude -p` | vault skills `capture`/`ask`/`link` + `eval/` |
| Body = router; detail in `references/`; scripts executed, never read | all skills |
| Decision table rule < skill < subagent; don't over-orchestrate | no subagents in v1 (documented in EXTENDING.md) |
| Hooks for must-happen behavior, wired only in `.claude/settings.json`; `PostToolUseFailure` for failures; test hooks with piped payloads | `guard-status.sh`, `capture-lesson.sh` (repo); `guard-paths.sh` (vault) |
| `memory/lessons.md` NEVER/ALWAYS lines + `/retro` promotion gate | both layers |
| `EXTENDING.md` with a present/omitted architecture map | `docs/EXTENDING.md` |
| `estimate_context.py`: measure what loads at startup | `scripts/estimate-vault-context.ts` |
| Lessons: verify platform docs before baking a standard; verify a vendor's tool surface against the installed binary | CLI flags verified with `claude --help` and official docs; AGENTS.md precedence verified |

**New idea derived from it:** apply the same law to *data*. A node's `summary` is to the brain what a skill's `description` is to Claude Code: the one line that decides whether the full file is worth opening. `index/INDEX.md` → `index/by-type/*.md` → node file is the data-side equivalent of CLAUDE.md → rule → reference.

## 2. Obsidian

Sources: https://obsidian.md/ · https://obsidian.md/help/plugins/graph · https://obsidian.md/help/properties · https://obsidian.md/help/bases · https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache · https://github.com/obsidianmd/obsidian-api · https://jsoncanvas.org/spec/1.0/

Borrowed: local Markdown vault, `[[wikilinks]]` by title with aliases, YAML properties with types, graph view mechanics (node size by inbound links, local graph with depth, filters for tags/attachments/orphans, color groups by query, display sliders for arrows/text fade/node size/link thickness, forces: center/repel/link/distance, time-lapse by creation date), MetadataCache's `resolvedLinks`/`unresolvedLinks` and `changed`/`resolved` events, Bases' "views over properties" idea, JSON Canvas (deferred).

Why the user bounced off it (and reviews agree): learning curve (weeks to understand folders + tags), Markdown and plugin complexity, "flexibility as friction", paid sync, weaker mobile. Synapse's answer: the AI writes the Markdown and does the filing; typed nodes with built-in semantics; fixed life views instead of a query language; conversation as the primary input; a transparency feed and git-based undo so delegation feels safe.

## 3. Prior art

| Product | Takeaway for Synapse | Source |
|---|---|---|
| Reor (archived Mar 2026) | auto-link by embedding similarity; "related notes" sidebar while writing; local-first Markdown + LanceDB | https://github.com/reorproject/reor |
| Khoj | self-hostable AI second brain, chat over docs with local/online LLMs | https://github.com/khoj-ai/khoj |
| Heptabase | spatial whiteboards for thinking; strong "see your thoughts" feel | review roundups |
| Capacities | everything is a typed object; clean visual UI; weak cross-object queries | reviews |
| Tana | supertags are powerful but take weeks to learn — avoid power-user complexity | reviews |
| Mem | AI memory graph + chat; semi-autonomous agent workflows | reviews |
| Logseq | journal-first, outliner, local Markdown, graph view | https://alternativeto.net/feature/graph-view |
| PARA + GTD | Projects/Areas/Resources/Archives + inbox → weekly review; tasks drive daily action | productivity sources |

## 4. Platform facts verified

- **Claude Code CLI 2.1.276** installed at `~/.npm-global/bin/claude`. Flags confirmed with `claude --help` and https://code.claude.com/docs/en/cli-reference : `-p`, `--output-format stream-json`, `--include-partial-messages`, `--input-format stream-json`, `--model`, `--effort low|medium|high|xhigh|max`, `--permission-mode`, `--permission-prompts none` (≥2.1.259), `--tools`, `--disallowedTools`, `--strict-mcp-config`, `--max-turns`, `--resume`, `--append-system-prompt-file`, `--bare` (API-key only; skips CLAUDE.md), `--no-session-persistence`.
- **Headless docs** https://code.claude.com/docs/en/headless : `/skill-name` in a `-p` prompt is expanded; `stream-json` last line is a `result`; `acceptEdits` auto-approves file writes; SIGINT ends the turn cleanly.
- **Legal** https://code.claude.com/docs/en/legal-and-compliance : subscription OAuth is for Claude Code itself; apps may not offer Claude.ai login or proxy credentials; an end user may sign in to the unmodified binary with their own subscription.
- **Nested run test (2026-10-31):** `claude -p` spawned from inside a Claude Code session starts in ~12 s; the machine's CLI OAuth session was expired → the engine card must show "run `claude`, then `/login`".
- **AGENTS.md** https://code.claude.com/docs/en/memory : read natively when no CLAUDE.md exists (≥2.1.277); when both exist only CLAUDE.md is read unless it imports `@AGENTS.md`; `.claude/rules/*.md` with `paths:` load on matching files.
- **Skills** https://code.claude.com/docs/en/skills : frontmatter `name`, `description`, `when_to_use` (combined ≤1536 chars), `allowed-tools` (grant, not restriction), `disable-model-invocation`, `user-invocable`, `model`, `effort`, `context: fork`, `paths`; keep SKILL.md focused and put detail in supporting files; `${CLAUDE_SKILL_DIR}` for scripts.
- **Codex** https://learn.chatgpt.com/docs/non-interactive-mode : `codex exec --json` (JSONL), `--output-schema`, `--sandbox workspace-write`, `resume`, reuses saved CLI auth or `CODEX_API_KEY`; SDK `@openai/codex-sdk`. Codex is not installed on this machine.
- **Tauri 2:** sidecar binaries are not supported on iOS/Android (tauri-apps/tauri#9774) → mobile must talk to a desktop brain host or use API-key engines.
- **react-force-graph** https://github.com/vasturiano/react-force-graph : 2D canvas / 3D WebGL / VR / AR with one API, d3-force-3d, particles, custom rendering, `zoomToFit`, DAG modes, MIT.

## 5. Toolchain on this machine (2026-10-31)

Node 22.17 · pnpm 9.15.9 · Python 3.14 · git 2.50 · gh 2.92 · sqlite3 3.43 · no Rust · no Xcode (CLT only) · no codex · no bun.

## Phase 4 sources (read 2026-10-31; Codex not installed, no API key available, so formats come from these)
- Codex non-interactive mode: https://learn.chatgpt.com/docs/non-interactive-mode (`--json`, stdin `-`, `resume`, `--sandbox workspace-write` replaces the removed `--full-auto`, `CODEX_API_KEY`).
- Codex CLI sources (github.com/openai/codex): `codex-rs/exec/src/cli.rs` (`--json` alias `--experimental-json`, `--skip-git-repo-check`, `resume <SESSION_ID> [PROMPT|-]`), `codex-rs/utils/cli/src/shared_options.rs` (`-m/--model`, `-C/--cd`, `-s/--sandbox`, `-p/--profile`), `codex-rs/utils/cli/src/config_override.rs` (`-c key=value`, unquoted words parse as strings), `codex-rs/cli/src/login.rs` (`login status` messages and exit codes), `codex-rs/protocol/src/openai_models.rs` (`ReasoningEffort` wire values).
- Codex SDK event/item types: `sdk/typescript/src/{events,items,exec}.ts` (JSONL shapes, how the SDK builds `exec` arguments).
- Codex and OpenAI models: https://developers.openai.com/codex/models, https://developers.openai.com/api/docs/models (GPT-6 family ids and list prices), Chat Completions reference (`reasoning_effort` values, `stream_options.include_usage`).
- OpenRouter: reasoning parameter docs (`reasoning: {effort}`, `reasoning_details` in streams); live `GET https://openrouter.ai/api/v1/models` (456 models; `pricing.*` as USD-per-token strings, `supported_parameters`).
- Anthropic: the `claude-api` skill (model ids and prices, adaptive thinking, `output_config.effort`) and `@anthropic-ai/sdk` 1.3.0 type definitions (`messages.stream`, `models.list`, usage fields; the SDK sends the key as `authorization`).
