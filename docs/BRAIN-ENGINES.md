# Brain engines

The "brain" is whichever AI engine runs against the vault with `cwd = vault`, reading the vault's own `AGENTS.md`/`CLAUDE.md`, rules and skills. `packages/brain` defines the contract; the server owns threads, runtime context and git snapshots.

## Contract (`packages/brain/src/types.ts`)

```ts
interface BrainEngine {
  id: 'claude-cli' | 'codex-cli' | 'anthropic-api' | 'openai-api' | 'openrouter';
  name: string;
  auth: 'cli-login' | 'api-key';            // signed-in vendor CLI vs. a key the user supplies
  keyEnv?: string;                          // api-key engines: the environment variable that can hold the key
  probe(force?): Promise<{ installed: boolean; loggedIn: boolean; version?: string; fix?: string; detail?: string; checkedAt: string }>;
  models(): { id: string; label: string }[];
  efforts(): string[];                      // [] when the engine has no effort control
  fetchModels?(): Promise<{ id: string; label: string }[]>;   // live catalog when the provider has one
  run(req: BrainRunRequest, signal?: AbortSignal): AsyncIterable<BrainEvent>;
}
type BrainRunRequest = { prompt: string; cwd: string; model?: string; effort?: string; sessionId?: string; systemAppendFile?: string; maxTurns?: number; allowWeb?: boolean; };
type TokenUsage = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
type BrainEvent =
  | { type: 'init'; sessionId: string; model?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; summary: string }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; summary: string }
  | { type: 'result'; text: string; sessionId: string; costUsd?: number; usage?: unknown; tokens?: TokenUsage; isError: boolean; numTurns?: number; durationMs?: number }
  | { type: 'error'; message: string }
  | { type: 'notice'; message: string };   // a passing condition while the run goes on (an API retry, a reconnect, a warning): shown, never a failure
```

A `notice` is what the engine says while it waits (Claude Code's API retries, Codex's reconnects and warnings); the host shows the latest one next to "thinking", logs it, and keeps the last one for the run's timing (ARCHITECTURE "Diagnostics"). Only `error`, a `result` with `isError`, or the process ending without a `result` fail a run.

Probes are free (version/status commands, a models or auth call) and cached for 10 minutes; `fix` is the exact instruction that makes the engine usable. `costUsd` is reported when the engine knows dollars (Claude Code, the API engines), `tokens` whenever the engine reports usage (Codex on a ChatGPT plan reports tokens only). `createEngines({ keys })` builds all five; `keys(provider)` returns a key the user saved in Settings.

## `claude-cli` (Phase 2)

Spawns the user's installed, unmodified Claude Code binary (`claude`, resolved on `PATH`), prompt on stdin:

```
claude -p --output-format stream-json --verbose --include-partial-messages \
  --model <alias> --effort <level> \
  --permission-mode acceptEdits --permission-prompts none \
  --tools "Read,Edit,Write,Glob,Grep,Skill[,WebFetch]" --disallowedTools "mcp__*" --strict-mcp-config \
  --max-turns 40 [--resume <sessionId>] \
  --append-system-prompt-file <vault>/.synapse/runtime-context.md
```

- **Models:** aliases `fable`, `opus`, `sonnet`, `haiku` (plus any full model id typed by the user). **Effort:** `low` `medium` `high` `xhigh` `max`.
- **Permissions:** `acceptEdits` lets the brain write files under the vault without prompts; `--tools` removes Bash and everything else (`WebFetch` is added only when `allowWeb` is set — the host sets it when the prompt carries an http(s) URL, see **Modes**); `--permission-prompts none` denies anything that would prompt instead of hanging; `--strict-mcp-config` skips the user's MCP servers (startup speed, isolation).
- **Skills:** the server prefixes the prompt with `/capture `, `/ask ` or nothing (chat). Claude Code expands `/skill` in `-p` prompts.
- **Environment** (`packages/brain/src/env.ts` `claudeEnv`): copy `process.env`, then delete `CLAUDECODE`, `CLAUDE_CODE_*` and `CLAUDE_AGENT_SDK_*` (set when the server itself was launched from a Claude Code session; they otherwise leak host-session state into the child), keeping the user's own Claude Code settings although they carry the prefix (`CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `CLAUDE_CODE_USE_BEDROCK` / `_USE_VERTEX` and their `_SKIP_*_AUTH`, `CLAUDE_CODE_CLIENT_CERT` / `_KEY` / `_KEY_PASSPHRASE`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`). Then the headless defaults, each only when the user has not set it: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_AUTOUPDATER=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_BUG_COMMAND=1` — the update check, telemetry, error reports and feature-flag fetches are network calls made before the first model call and give a headless run nothing; on a slow or filtered network they are waited on for nothing. Keep `PATH`, `HOME`.
- **Stream mapping** (`stream-json`, one JSON object per line):

| line | event |
|---|---|
| `{"type":"system","subtype":"init","session_id",...}` | `init` |
| `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text"}}}` | `text_delta` |
| `{"type":"assistant","message":{"content":[{"type":"tool_use","id","name","input"}]}}` | `tool_use` (summary = tool name + file path / pattern) |
| `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id","is_error"?}]}}` | `tool_result` |
| `{"type":"result","result","session_id","total_cost_usd","usage","is_error","num_turns"}` | `result` |
| `{"type":"system","subtype":"api_retry","attempt","max_retries","retry_delay_ms","error_status","error"}` | `notice` (`API retry 3/10 (HTTP 529 overloaded_error) · next try in 8 s`): the CLI is waiting out a failed API call — without it a run on a bad network looks stuck |
| `{"type":"system","subtype":"status"}` and other `system` lines | ignored |

- **Probe:** `claude --version` → installed + version. Login: run `claude -p "Reply with exactly: ok" --output-format json --max-turns 1 --tools "" --no-session-persistence --permission-prompts none --model haiku` with a 90 s timeout; `is_error: true` with "authenticate"/"OAuth" in `result` → `loggedIn: false`, `fix: "Open a terminal, run `claude`, then `/login`."`. Cache the probe for 10 minutes; re-probe on demand from Settings.
- **Cancel:** send `SIGINT` (ends the turn cleanly; `SIGTERM` leaves it unfinished).
- **Sessions:** each UI thread stores the engine `session_id` from `init`/`result`; later turns pass `--resume`. If resume fails (session gone), start fresh and keep the thread.
- **Nested dev note:** spawning from inside a Claude Code session works (verified 2026-10-31, ~12 s startup); the env sanitization above is still applied.
- **Startup latency:** measured through `POST /api/brain/run` on 2026-10-31 (Claude Code 2.1.276, sanitized env, `--strict-mcp-config`): `brain.started` → the engine's first `init` event took 1.40 / 1.31 / 1.14 / 1.24 s over four runs, so plugins are left alone (no `--settings` override); a headless run with the exact flags above took 1.2 s to `init` and 5.2 s to its result with Claude Code 2.1.316 (2026-11-02, a cloud container). Every run now measures itself (ARCHITECTURE "Diagnostics": `timing` on `brain.done`, `SLOW-<run>` in Settings → Diagnostics when the first event or the first output waits 20 s or more), so a slow deployment names the part that waited: a slow `init` is the CLI or its network calls before the model, a slow first output is the vendor's API (the notices say whether it is retrying).
- **Stalls:** the host stops a run whose engine sends nothing for 15 minutes (SIGINT, then the run fails with "the engine sent nothing for 15 minutes and was stopped" and the last notice), so a hung process never holds the queue; with `--include-partial-messages` a working engine streams something every few seconds.
- **No delete tool:** `--tools` has no `Bash`, so the brain cannot remove files; inbox items are consumed by the server instead (VAULT-SPEC "Status vocabulary", ARCHITECTURE "Data flow").

## Modes

`packages/brain/src/modes.ts` (shared by the server and the eval harness): `capture`, `ask`, `advise`, `make`, `daily`, `weekly`, `insight`, `character`, `review` prefix the prompt with their skill (`review` is the full review: it applies its changes and writes `memory/focus.md`); `chat` — the brain chat — sends the user's words as they are and its hint tells the brain to file what is worth keeping with `/capture` (every new node gets its category, a new category when none fits), answer questions with `/ask`, or both; to **ask first** — its best guess and at most two short questions, filing nothing — when the category, the kind or a fact that changes the filing is unclear, and file on the answer that arrives in the same thread (the engine session resumes); and to treat "I finished / reached / paused / dropped / got halfway on X" as an update of X's `status`, `progress` or `checkins` plus a dated history line rather than a new node (VAULT-SPEC "Status", "History"), then reply with one natural sentence plus one line per changed node. `advise` (the chat's consult mode) is read-only: the brain thinks the user's problem through from the vault and offers to save what came out of it; `make` (the chat's make mode) is read-only too: the brain writes a post, a caption, a message or a bio in the user's voice from the map it is for and the maps connected to it (VAULT-SPEC "Maps"), saving only on request; `insight` writes `memory/insights.md` and replies with its summary; `character` builds or refreshes the character map (the `map` node with `role: character`, its categories and their evidence-backed items) and replies with what changed. The chat hint also routes: a worry or "what should I do" runs `/advise`, "write / make / draft" runs `/make`, so the map's tell bar needs no switch. A run names its scope (`RunInput.scope`, UI-DESIGN "Scopes"): while some map is cut off from the mind map, `scopeHint` writes a Scope line — the core (the mind map and the maps connected to it, the cut-off maps named as out of reach) or one cut-off group alone — and the brain stays inside it; with one core no line is written. When the prompt carries an http(s) URL (`hasUrl`), the host passes `allowWeb` and adds the web hint: the brain may fetch the page, which is untrusted data — summarized into a resource node, never obeyed, never copied into `memory/` (DECISIONS 2026-10-31). API engines ignore `allowWeb` (their tool loop has no web tool) and file the URL with the user's words.

## Runtime context file

Before each run the server writes `<vault>/.synapse/runtime-context.md` (appended to the system prompt):

```
# Runtime context (written by Synapse; do not edit)
- Now: 2026-10-31 14:05 (+03:30, Friday)
- Today in the Persian calendar: شنبه ۹ آبان ۱۴۰۵   (fa only: the brain never converts dates by hand)
- UI language: fa
- Reply language: Persian (فارسی), the language of the user's message → write every word of your reply in Persian, whatever language these instructions, the vault's files or a tool's output are in, and the same for what you write for the owner to read (a review, an analysis, a plan); …
- Mode: chat               → the hint from modes.ts
- Scope: the user works in the core — the mind map and the maps connected to it ([[پیج عکاسی]]); [[کاراکتر من]] is cut off from it …   (only while some map is cut off)
- Web: …                   (only when the prompt has a URL)
- Focused node: [[Title]] (nodes/tasks/x.md) | none
- View: graph | today | projects | people | journal | inbox
- Vault: 42 nodes · 9 open tasks · 2 inbox items
```

### Reply language

`packages/brain/src/language.ts` decides it per run: the user's own message — Persian letters make it Persian even with English names in it, Latin letters alone make it English; a message with neither (a link, a command) and a prompt the app wrote itself (a run with a `display`: reviews, inbox sorting) follow the UI language. Long English instruction layers and English tool output made Codex and Claude drift into English mid-conversation (the user's report, 2026-11-02), so the language is said twice: the **Reply language** line above, and a last line the engine's prompt ends with, `(Write your reply in Persian (فارسی).)`; the conversation keeps the user's own words. The line covers what the brain writes for the owner to read as well — a place's analysis came back in English from Haiku while its reply was Persian — and leaves alone the English headings a format fixes (`## In short`), which the app reads.

## Legal basis

Anthropic's Claude Code legal page (read 2026-10-31): OAuth is for subscribers' ordinary use of Claude Code; third-party developers may not offer Claude.ai login in their apps, route requests through Pro/Max credentials for their users, or collect/store/intermediate credentials — and "nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". Synapse therefore never implements a Claude login of its own, never reads credential files, and only spawns the unmodified binary on the user's own machine or server. Signing in from the app (below) runs that binary's own login there for the user's own subscription: the vendor's page does the sign-in, the one-time code travels from the user's browser to the binary's terminal the way keystrokes travel over SSH, and the binary keeps the result. Synapse is single-user and self-hosted; running it as a hosted service where other people sign in their subscriptions is exactly what the page forbids. If Synapse is ever distributed, the "Can customers offer Claude Code in their products?" conditions apply (Commercial Terms, unmodified binary, each end user authenticates with their own account/key).

## Sign-in from the app

A CLI engine declares `signIn: {flow, login, logout, hosts}` and `resolveBin()` (`types.ts`). Settings → Brain starts it with `POST /api/engines/:id/sign-in`; the server (`apps/server/src/cli-sign-in.ts`) spawns the CLI's own command — on Linux under util-linux `script` so it has a real terminal, elsewhere on pipes (a desktop CLI opens the browser itself) — and reads its output with `readSignInOutput` (`sign-in.ts`): the first `https` link on one of `hosts` (OSC 8 hyperlinks first, so a wrapped line does not cut it), a device code after it, the paste prompt, the last error line. Only links to the vendor's hosts are ever shown.

| Engine | Command | Flow |
|---|---|---|
| `claude-cli` | `claude auth login --claudeai` (sign out: `claude auth logout`) | `paste-code`: the link opens claude.com; after sign-in the page shows a code, the user pastes it in Settings, `POST …/sign-in/code` writes it plus `\r` to the CLI's terminal (it expires within minutes) |
| `codex-cli` | `codex login --device-auth` (sign out: `codex logout`) | `device-code`: the link opens OpenAI's device page and Settings shows the code to type there; the CLI waits for OpenAI and exits |

When the CLI exits the server probes the engine (`probe(true)`): signed in → `done`, else `failed` with the CLI's last line. The pasted code and anything shaped like a key or token are cut from every message (`redactSecrets`); the output is kept in memory only while the sign-in runs, and a finished sign-in is forgotten after five minutes. One sign-in per engine; 15 minutes at most; `DELETE …/sign-in` cancels (the process group is killed). `POST /api/engines/:id/sign-out` runs the logout command and re-probes (refused while a run is live). The CLI keeps its credentials under `$HOME` (`/data/home` in the image, inside the volume); `CLAUDE_CODE_OAUTH_TOKEN` in the environment still works and wins.

## `codex-cli` (Phase 4)

Spawns the user's installed Codex CLI (`codex`, resolved from `SYNAPSE_CODEX_BIN`, PATH, `~/.npm-global/bin`, `~/.local/bin`, `~/.codex/bin`, `~/.bun/bin`, `/opt/homebrew/bin`, `/usr/local/bin`), prompt on stdin:

```
codex exec --json --cd <vault> --sandbox workspace-write --skip-git-repo-check \
  [--model <id>] [-c model_reasoning_effort=<low|medium|high|xhigh|max>] \
  [resume <thread_id>] -
```

- **Flags** (verified against the Codex CLI sources, 2026-10-31): `--json` prints JSON Lines on stdout (`--experimental-json` is its alias); `--full-auto` no longer exists — `--sandbox workspace-write` is what lets Codex edit files under cwd; `-` reads the whole prompt from stdin; `-c key=value` is parsed as TOML and an unquoted word becomes a string, so `model_reasoning_effort=high` needs no quotes. Options go before `resume <id>`.
- **Models:** `gpt-6.1-sol` (default), `gpt-6-astra`, `gpt-6.1-terra`, `gpt-6-luna` (developers.openai.com/codex/models); any id typed by the user is passed through. An id the installed Codex does not know is still sent (its notice: "Model metadata for `…` not found. Defaulting to fallback metadata"). **Effort:** `low` `medium` `high` `xhigh` `max` (the wire values of Codex's `ReasoningEffort`; `none`/`minimal`/`ultra` exist but are not offered).
- **Prompt:** Codex reads the vault's `AGENTS.md` from cwd itself but has no system-prompt flag, does not expand `/skill` prompts and never loads path-scoped rules. The engine therefore sends `<runtime_context>…</runtime_context>` (the runtime-context file), a `<folder_rules>` index (one line per `.claude/rules/*.md` with its `paths:`), then the prompt with `/capture …` expanded into the skill body from `.claude/skills/capture/SKILL.md` (relative links rewritten to vault paths) followed by `User input:`. `AGENTS.md` and the skills ship unchanged.
- **Boundary:** `workspace-write` confines Codex to the vault; nothing enforces the `nodes/`/`memory/` rule for it (Codex runs no PreToolUse hooks). `AGENTS.md` states the rule, and the server's diff → `brain(<mode>)` commit makes any stray edit visible and revertible.
- **Stream mapping** (`codex exec --json`, one JSON object per line; shapes from the Codex SDK `ThreadEvent`/`ThreadItem` types):

| line | event |
|---|---|
| `{"type":"thread.started","thread_id"}` | `init` (session id = `thread_id`) |
| `{"type":"turn.started"}` | ignored |
| `{"type":"item.started\|updated\|completed","item":{"type":"command_execution","id","command","aggregated_output","exit_code","status"}}` | `tool_use` (`Bash <command>`) once per item, then `tool_result` on completion (`ok` = status not `failed` and exit code 0) |
| `item.*` with `"type":"file_change","changes":[{"path","kind"}],"status"` | `tool_use` (`Edit add nodes/…`) + `tool_result` |
| `item.*` with `"type":"mcp_tool_call"` / `"web_search"` | `tool_use` + `tool_result` |
| `item.completed` with `"type":"agent_message","text"` | `text_delta` (several messages are joined with blank lines) |
| `item.completed` with `"type":"reasoning"` / `"todo_list"` | ignored |
| `item.completed` with `"type":"error","message"` | `notice` (a warning the turn goes on after: "Model metadata for `…` not found", "Falling back from WebSockets to HTTPS transport") |
| `{"type":"turn.completed","usage":{"input_tokens","cached_input_tokens","output_tokens",…}}` | `result` (`tokens`, raw `usage`, no `costUsd`) |
| `{"type":"turn.failed","error":{"message"}}` | `result` with `isError: true` |
| `{"type":"error","message"}` | `notice` — Codex streams its retries this way ("Reconnecting... 2/5 (stream disconnected …)", "Reconnecting... waiting for network (Connection failed …)") and the turn goes on; treating them as failures marked every run on a flaky network as an error. The parser keeps the last one (`lastNotice`), and when the process ends without `turn.completed` the engine's error is that notice (Codex's stderr holds only tracing noise) |

- **Probe:** `codex --version` → installed + version; `codex login status` → exit 0 (stderr `Logged in using ChatGPT`, `API key configured - …`, `Logged in using access token`) = logged in, exit 1 (`Not logged in`) → `fix: "Open a terminal and run codex login …"`. No binary → `fix` with the install command (`npm install -g @openai/codex`).
- **Sessions:** the thread stores `thread_id`; later turns run `resume <id>`. If the process exits before `thread.started` on a resume (session gone), the engine retries once without `resume` and the thread keeps going.
- **Cancel / env:** SIGINT, SIGTERM after 5 s; the same sanitized environment as `claude-cli`.
- **Transport:** Codex first opens a Responses WebSocket and falls back to HTTPS after five failed connects (about ten seconds of "Reconnecting…" notices on a network that refuses the WebSocket); the `responses_websockets` feature is built in and cannot be switched off in 0.166.
- **Verification state:** checked against codex-cli 0.166.0 (2026-11-02, installed into a scratch directory of a cloud container, not signed in): `codex exec --help` and `codex exec resume --help` list every flag used; the fresh command line is accepted and streams `thread.started`, `item.completed` (`error`), `turn.started` and `error` lines exactly as mapped above; the resume command line is accepted (`Error: thread/resume: … no rollout found for thread id …`, exit 1, no JSON — the retry without `resume` covers it); `codex login status` prints `Not logged in` and exits 1; `codex login --device-auth` exists; the Linux sandbox (Landlock) ran a command in the container. Still unverified: a signed-in turn (whether `thread.started` is emitted on a resume, the token fields of `turn.completed`), and the sandbox on the deployment's own Docker host. If a future `codex exec --help` disagrees with the flags above, fix `buildCodexArgs` and this section together.

## API engines: `anthropic-api`, `openai-api`, `openrouter` (Phase 4)

The user's own API key, billed by the provider. All three share one in-app agent loop (`packages/brain/src/tool-loop.ts`) and the same vault-confined tools; only the wire format differs.

### Tool loop

- **System prompt** = the vault's `AGENTS.md` + `memory/profile.md` + `memory/lessons.md` + a folder-rules index + tool notes (one stable, prompt-cached block), then the runtime context (a second, per-run block). Built by `loadAgentLayer`/`buildSystemPrompt` (`src/agent-layer.ts`).
- **Skills:** `/capture text` and the other mode prefixes are expanded exactly as for Codex.
- **Tools** (`src/tools/vault-tools.ts`), all paths vault-relative:

| tool | input | boundary |
|---|---|---|
| `read_file` | `path`, `offset?`, `limit?` | anywhere inside the vault except `.synapse/` and `.git/`; 200 kB cap |
| `list_files` | `pattern` (glob: `*`, `**`, `?`, `{a,b}`) | same read boundary; `.git`, `.synapse`, `node_modules` skipped; 500 paths |
| `grep` | `pattern` (JS regex, case-insensitive by default), `path?`, `glob?`, `ignore_case?` | same; 200 matches, binaries skipped |
| `write_file` | `path`, `content` | only under `nodes/` or `memory/`; parents created |
| `edit_file` | `path`, `old_string`, `new_string`, `replace_all?` | only under `nodes/` or `memory/`; `old_string` must match exactly once unless `replace_all` |

  Paths are resolved against the vault root (lexically, then through the deepest existing ancestor's real path, so symlinks cannot escape); violations come back as tool errors the model can recover from, never as writes.
- **Folder rules:** the full text of every `.claude/rules/*.md` whose `paths:` glob matches a touched path (read or write) is appended to that tool result — once per rule per run — so the model sees `tasks.md` exactly when it first touches `nodes/tasks/`.
- **Turns:** up to `maxTurns` (40) provider calls, 32k output tokens each; tool calls run sequentially in the order the model issued them; text between turns is separated by a blank line. Stop: a turn without tool calls → `result`; `refusal` → error result; output cut by the token limit while calling tools → error result; turn limit → error result `stopped after N turns without a final answer`. Provider failures → `error` event (401s carry the key fix). Cancel: the abort signal is passed to the in-flight request.
- **Sessions:** the transcript (user text, assistant text + tool calls + the provider's raw assistant blocks, tool results) is saved to `<vault>/.synapse/engine-sessions/<engine>/<uuid>.json` and replayed on the next turn of the thread; threads longer than 120 messages start a fresh context. Raw blocks are echoed verbatim (Claude thinking signatures, OpenRouter `reasoning_details`) because the providers bind them to the conversation.
- **Cost:** `costUsd` = provider usage × list prices in `src/pricing.ts` (Anthropic and OpenAI first-party rates as of 2026-10, cache reads/writes included; estimates). OpenRouter reports `usage.cost` itself (requested with `usage: {include: true}`), with its per-model prices from the model list as the fallback. `tokens` always carries input/output/cache counts.

### Keys and probes

- Lookup order: the key saved in Settings (`.synapse/settings.json` → `apiKeys.anthropic|openai|openrouter`, file mode 600, gitignored with `.synapse/`) first, then the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`; the server loads the repo `.env`, see `.env.example`). Keys are never logged and leave the server only masked (`sk-ant-…cdef`) and only toward the provider.
- Probe (free): no key → `installed: true, loggedIn: false`, `fix` = where to put the key; key present → `verifyKey` (Anthropic `GET /v1/models?limit=1`, OpenAI `GET /v1/models`, OpenRouter `GET /api/v1/auth/key`): 401/403 → `loggedIn: false` with the "rejected" fix; other failures (offline) → `loggedIn: true`, `detail: not verified …`. `detail` names the key's source and mask.
- Model catalog: `fetchModels()` → `GET /v1/models` (Anthropic, `lifecycle != retired`), `GET /v1/models` (OpenAI, chat models only, newest first), `GET /api/v1/models` (OpenRouter, models whose `supported_parameters` include `tools`, `:batch` variants skipped; prices kept). Static defaults stay first in the merged list.

### `anthropic-api`

`@anthropic-ai/sdk` 1.x, `client.messages.stream(...)`, 2 retries, 10 min timeout:

```jsonc
POST https://api.anthropic.com/v1/messages
{ "model": "claude-opus-5-5", "max_tokens": 32000, "stream": true,
  "system": [ { "type": "text", "text": "<AGENTS.md + memory + rules index + tool notes>", "cache_control": { "type": "ephemeral" } },
              { "type": "text", "text": "# Runtime context …" } ],
  "tools": [ { "name": "read_file", "description": "…", "input_schema": { … } }, … ],
  "messages": [ { "role": "user", "content": "…" },
                { "role": "assistant", "content": [ …raw blocks of the previous turn… ] },
                { "role": "user", "content": [ { "type": "tool_result", "tool_use_id": "…", "content": "…", "is_error": true } ] } ],
  "thinking": { "type": "adaptive" },
  "output_config": { "effort": "medium" } }
```

- **Models:** `claude-opus-5-5` (default), `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`, plus the live list. **Effort:** `low` `medium` `high` `xhigh` `max` (`output_config.effort`; omitted when unset). Thinking is adaptive on every current model; `tool_choice` stays `auto`.
- **Stop reasons:** `end_turn`/`stop_sequence` → end; `tool_use` → run tools; `max_tokens`/`model_context_window_exceeded` → token limit; `refusal` → declined (checked before any tool runs). Server-side refusal fallbacks are not enabled (DECISIONS).
- **Usage → cost:** `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` × the model's price row (prefix match on the id).
- **Errors:** `AuthenticationError` → "Anthropic rejected the API key (401)…"; other `APIError`s surface as `Anthropic API <status>: <message>`.

### `openai-api` / `openrouter`

Plain `fetch`, Chat Completions, SSE streaming; one provider class, two configurations:

| | `openai-api` | `openrouter` |
|---|---|---|
| base URL | `https://api.openai.com/v1` (`OPENAI_BASE_URL` overrides) | `https://openrouter.ai/api/v1` |
| effort parameter | `"reasoning_effort": "<effort>"` | `"reasoning": { "effort": "<effort>" }` |
| extra request fields | — | `"usage": { "include": true }` (returns `usage.cost`) |
| extra headers | — | `HTTP-Referer`, `X-Title: Synapse` |
| default models | `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6.1-terra`, `gpt-6-luna`, `gpt-5.5` | `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5`, `anthropic/claude-haiku-5.5`, `openai/gpt-6.1-sol`, `openai/gpt-6-astra`, `openai/gpt-6-luna`, `google/gemini-4-argon` |
| efforts | `low` `medium` `high` `xhigh` `max` | same |
| key check | `GET /models` | `GET /auth/key` |

```jsonc
POST <base>/chat/completions
{ "model": "gpt-6.1-sol", "stream": true, "stream_options": { "include_usage": true }, "max_completion_tokens": 32000,
  "tools": [ { "type": "function", "function": { "name": "read_file", "description": "…", "parameters": { … } } }, … ],
  "messages": [ { "role": "system", "content": "<stable block>\n\n<runtime context>" },
                { "role": "user", "content": "…" },
                { "role": "assistant", "content": "…", "tool_calls": [ { "id": "call_1", "type": "function", "function": { "name": "grep", "arguments": "{…}" } } ], "reasoning_details": [ … ] },
                { "role": "tool", "tool_call_id": "call_1", "content": "…" } ],
  "reasoning_effort": "medium" }
```

- **Stream:** `choices[].delta.content` → `text_delta`; `delta.tool_calls[]` accumulated by `index` (`id`, `function.name`, `function.arguments` concatenated, parsed as JSON when the turn ends); `delta.reasoning_details[]` merged by index and stored for replay; `finish_reason` `tool_calls`/`stop`/`length`/`content_filter`; the final chunk's `usage` (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, OpenRouter `cost`) gives tokens and cost.
- **Reasoning parameter fallback:** a 400 whose message mentions reasoning is retried once without the parameter (models that take no effort setting).
- **Errors:** 401 → `<Provider> rejected the API key (401). Check the key in Settings or the environment.`; other statuses → `<Provider> API <status>: <message>`; a mid-stream `{"error": …}` chunk aborts the turn with its message.

## On a desktop

When Synapse runs on the owner's own computer (`GET /api/engines` `place: 'desktop'`: the server trusts loopback and is not in a container), the brain is a CLI that a desktop app there is signed in to (`packages/brain/src/engines/desktop-apps.ts`):

- **Codex from the ChatGPT app.** The ChatGPT app carries Codex at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex` (also under `~/Applications`) and shares its sign-in through `~/.codex`; `resolveCodexBin` looks there after `SYNAPSE_CODEX_BIN`, PATH and the usual install places. Checked 2026-11-02 with the app's codex-cli 0.165: `login status` says "Logged in using ChatGPT", and `exec` takes the flags of the `codex-cli` section.
- **Codex's own model catalog.** `codex debug models` prints the catalog the CLI keeps for the signed-in account; `parseCodexCatalog` keeps the visible models (`visibility: "list"`), each with its efforts (`supported_reasoning_levels`, up to `ultra`) and the one it starts on (`default_reasoning_level`), so `ModelOption` carries `efforts` and `defaultEffort` and the engine's `efforts()` is their union. It is read on every probe while signed in and by `fetchModels`; the static `CODEX_MODELS` stay the fallback.
- **Claude Code from PATH or the Claude app.** After `SYNAPSE_CLAUDE_BIN`, PATH and the usual install places, `resolveClaudeBin` takes the newest Claude Code the Claude app keeps under `~/Library/Application Support/Claude/claude-code/<version>/<build>/claude.app/Contents/MacOS/claude`; both share the user's Claude Code login. A spawned `claude` needs `USER` and `LOGNAME`: without them `claude auth status` reads no login from the keychain (an `env -i` start said "not logged in").
- **What the probes add.** `via` says where the CLI was found (`path`, `chatgpt-app`, `claude-app`) and `account` whom it is signed in as — Claude Code's `email · plan` from `auth status`, Codex's "ChatGPT" from `login status`; never a credential.
- **Settings.** On a desktop the Brain card shows the two CLIs first, each with its app, account, version, model and effort (the model's own efforts), and picking one makes it the brain; there is no Sign out (the sign-in belongs to Claude Code or the ChatGPT app on that computer, not to Synapse); the API engines fold under "Other ways". On a server the cards stay as below.

## Settings and UI contract

`GET /api/engines` lists every engine with `auth`, `keyEnv`, `key` (`{source: 'settings'|'env', masked}` or `null`), the probe, `models`, `efforts`, `canFetchModels`, `signIn` (the CLI sign-in flow or `null`), `defaults` (the engine's model/effort from settings) and `selected`, and the response says where the brain runs (`place`: `desktop` or `server`, see "On a desktop"); a model may carry its own `efforts` and `defaultEffort`; `GET /api/engines/:id/models` fetches the live catalog. Settings keep `engines[id] = {model, effort}` and `apiKeys[provider]`; `PUT /api/settings {engine}` selects the brain and mirrors its defaults into the legacy `model`/`effort`. The Settings view shows one card per engine: status pills; for a CLI engine **Sign in** (the box above) or **Sign out**; for an API engine the key field with a link to where keys are made, "Fetch models" once a key is accepted; the model and effort selectors only once the engine is connected; "Use this engine"; the composer's model/effort pickers follow the selected engine and each reply shows `costUsd` or, without dollars, input/output tokens. Routes: `docs/ARCHITECTURE.md`.

## Protected desktop CLI sessions (0.2.1)

The desktop shell sets `SYNAPSE_PRIVATE_SESSIONS=1`; the server passes `ephemeral: true` only to its CLI engines. Codex runs with `--ephemeral`, Claude Code with `--no-session-persistence`, and neither receives an old resume id. Existing account sign-ins are untouched. API engines keep their already vault-confined transcripts. Normal non-desktop servers retain their previous resume behavior.

For conversation continuity, the runner writes recent prior user/assistant messages into the runtime context inside the encrypted vault (up to 48,000 serialized characters, complete messages, newest first in selection and chronological in presentation; a newest message longer than that is cut, not dropped). Only messages before the current run's own count — a message queued after it in the same thread is not earlier conversation — and failed replies (errors, cancellations) are left out. The current input is not duplicated. The full conversation remains in `.synapse/sessions.json`; a context-window omission does not delete history. Old vendor session files created before this change are separate legacy data, not removed by this setting. Third-party hooks/plugins and vendor-side retention are outside this control.

Codex flag source: https://learn.chatgpt.com/docs/non-interactive-mode ("Keep job state local", `--ephemeral`). Claude flag checked against the installed CLI's `--help` (`--no-session-persistence`, print mode only).
