# Synapse — Plan

**What:** an AI-native second brain + life OS. A local Markdown vault holds the user's notes, ideas, tasks, projects, areas, people, journal and resources as typed, linked nodes. An index-first "brain" (the user's own AI subscription, first via the installed Claude Code CLI) files, links, answers and reviews. A graph UI makes the whole mind visible and playable. Later: desktop + mobile apps, more engines (Codex, API keys, OpenRouter).

**Why:** the user wants one place for mind + life, found Obsidian high-friction (manual Markdown, folders/tags to learn, no hand-holding), and wants the AI to do the organizing while they talk and look at a beautiful graph.

**Specs (canonical, do not duplicate here):** `docs/ARCHITECTURE.md`, `docs/VAULT-SPEC.md`, `docs/BRAIN-ENGINES.md`, `docs/UI-DESIGN.md`. Research basis: `docs/RESEARCH.md`. Decisions: `docs/DECISIONS.md`. Progress: `docs/STATUS.md`.

## Principles

1. Thin always-loaded index, everything else on demand — applied to the codebase (AGENTS.md → docs/rules) and to the vault (AGENTS.md → INDEX.md → nodes).
2. Description as trigger: skills fire on a measured `description`; every node carries a one-line `summary` so an index line stands in for the file.
3. One canonical location per fact; no orphan files; English in every shipped file (Persian only in trigger phrases); talk to the user in Persian.
4. Hooks for guarantees (status before commit, brain never writes outside allowed folders); prose for guidance.
5. Eval-driven: vault skills have `eval/` trigger cases run with `claude -p`; core logic has vitest tests.
6. Self-improvement loop (`memory/lessons.md` + failure hook + `/retro`) in both layers.
7. Document omissions in `docs/EXTENDING.md` (present / intentionally omitted + how to add).

## User decisions

Name **Synapse** · UI **Persian RTL default + English toggle** · graph **2D main + 3D mode** · storage **Markdown + frontmatter** (source of truth, derived index) · brain v1 **installed Claude Code CLI with the user's subscription**; login delegated to Claude Code itself.

## Phases

Checkboxes are ticked by `/status` only for verified work.

### Phase 0 — Foundation
- [x] Monorepo scaffold (pnpm workspaces, TS 5.9 strict, vitest, tsx), `git init`, `.gitignore` (incl. `agent-creator/`)
- [x] Root `AGENTS.md` (≤150 lines) + `CLAUDE.md` (imports it) + `.claude/rules/` (paths-scoped) + skills `/status` `/handoff` `/retro` + hooks `guard-status.sh` `capture-lesson.sh` + `memory/lessons.md`
- [x] `docs/`: PLAN, STATUS, DECISIONS, ARCHITECTURE, VAULT-SPEC, BRAIN-ENGINES, UI-DESIGN, RESEARCH, EXTENDING
- [x] `packages/vault-template`: vault `AGENTS.md`/`CLAUDE.md`, rules per node type, skills `capture` `ask` `link`, `guard-paths.sh`, memory seeds, sample data (~40 fa/en nodes)
- [x] `scripts/`: `create-vault`, `seed-sample-vault`, `estimate-vault-context`, `validate-vault`

**Done when:** `pnpm install` succeeds · `pnpm vault:seed` creates `~/Synapse/vault` · `pnpm vault:context` ≤ 2.5k always-loaded tokens · hooks tested with piped payloads · STATUS updated.

### Phase 1 — Vault index + graph UI (no brain)
- [x] `packages/core`: frontmatter parse/serialize, wikilinks (aliases, unresolved), ULID + slug, index builder (INDEX.md + by-type), graph builder (edges: link, belongs_to, mentions), search index; tests
- [x] `apps/server`: vault service (chokidar watcher, incremental rebuild, writes `index/`), REST + WS (events in ARCHITECTURE.md), search, node read/write, settings
- [x] `apps/web`: shell (rail, graph, node panel, composer placeholder), 2D graph with all interactions in UI-DESIGN.md, 3D toggle, filters, local focus, time-lapse, node panel (read + simple edit), search, fa/en + RTL

**Done when:** sample vault renders as a graph · editing a file on disk updates graph + panel live · search finds Persian and English · `pnpm test` green · STATUS updated.

### Phase 2 — Brain v1 (Claude Code engine)
- [x] `packages/brain`: `BrainEngine` contract, `claude-cli` engine (spawn, stream-json parser, probe, env sanitization), tests for the parser
- [x] `apps/server`: brain router (run/cancel, threads → sessions, runtime-context.md), vault git (init, snapshot, diff, commit, undo), `brain.changes` events
- [x] `apps/web`: composer (Capture / Ask / Chat, model + effort pickers, streaming, tool-activity chips, changed-nodes chips, Undo), engine status card in Settings with the exact fix when not logged in
- [x] vault skills `capture` `ask` `link` tuned with `eval/` (fa + en phrasings)

**Done when:** a Persian capture creates typed, linked nodes visible in the graph in the same run · Ask answers from the index without bulk reads (tool feed) · Undo reverts a run · eval passes · STATUS + DECISIONS updated.

### Phase 3 — Life OS
- [x] vault skills `daily` (overdue / due today / doing tasks, next action per active project, one journal prompt → appended to today's journal node) and `weekly` (PARA review: inbox to zero, project next actions, stale tasks, archive candidates → journal entry + proposed edits), eval cases fa + en, "Daily review" / "Weekly review" buttons on Today (brain modes `daily` / `weekly`)
- [x] "Related" panel: lexical similarity (`relatedNodes` over the MiniSearch index, already-linked nodes excluded) via `GET /api/nodes/:id/related`, core tests
- [x] link suggestions: **Link** appends `- [[Title]]` under `## Related` through `PUT /api/nodes/:id`; **Dismiss** stores the pair in `.synapse/suggestions.json`
- [x] tag nodes toggle in the graph (client-side `tag:` nodes + `tag` edges, `#9ca3af`, persisted `graph.showTags`; clicking a tag node filters by that tag)
- [x] WYSIWYG editor: TipTap (StarterKit + task lists + `wikilink` atom node) with a Markdown round-trip; an unchanged body is written back byte-identical
- [x] rename rewrites links: a changed `title` rewrites `[[Old]]`, `[[Old|alias]]`, `[[Old#h]]` and quoted frontmatter in every file that resolves to the node, adds the old title to `aliases`, commits `manual: rename <old> → <new>`; server tests
- [x] Today / Projects / People / Journal views complete (Phase 1 shells + Today review buttons)
- [x] Inbox "file it" polish (progress per item, retry on failure, "File all" batch with progress; inbox files consumed by the app after the run)

**Done when:** the six items above work in the browser with the sample vault · `pnpm test` · `pnpm typecheck` · `pnpm vault:validate` · `pnpm vault:context` ≤ 2.5k · `pnpm eval:vault` pass · STATUS + DECISIONS updated. (Verified 2026-10-31; Inbox polish verified 2026-10-31.)

### Phase 4 — More engines
- [x] `codex-cli`: `codex exec --json` with the prompt on stdin, JSONL → `BrainEvent` parser (fixture-tested), probe via `codex --version` + `codex login status`, resume via `codex exec resume <thread_id>`; the prompt carries the runtime context, a folder-rules index and the expanded `/skill` (Codex reads the vault's `AGENTS.md` itself).
- [x] Shared in-app tool loop confined to the vault (`packages/brain/src/tool-loop.ts`, `tools/vault-tools.ts`): read/list/grep anywhere but `.synapse/` and `.git/`, write/edit only under `nodes/` and `memory/`; folder rules injected into the first tool result that touches their paths; transcripts persisted per engine session; mocked-provider tests.
- [x] `anthropic-api`: Messages API through `@anthropic-ai/sdk` (streaming, adaptive thinking, `output_config.effort`, prompt-cached system block, assistant blocks replayed verbatim).
- [x] `openai-api` + `openrouter`: Chat Completions over `fetch` (function tools, `stream_options.include_usage`, `reasoning_effort` / `reasoning.effort` with a retry without it, OpenRouter `usage.cost` and per-model prices, `reasoning_details` echoed back).
- [x] Keys from the environment / repo `.env` (loaded by the server) or Settings (`.synapse/settings.json` `apiKeys`, served masked, file mode 600); probes report the exact fix for a missing binary, a missing key and a rejected key.
- [x] Model catalog per engine: static defaults plus "Fetch models" (`GET /api/engines/:id/models`).
- [x] Per-engine model/effort defaults, engine picker and key inputs in Settings; the composer's pickers follow the selected engine; per-run cost (or tokens when the engine bills no dollars).
- [x] `.env.example` keys; `docs/BRAIN-ENGINES.md` sections per engine.
- [ ] Live verification by the user (STATUS "Needs the user"): Codex is not installed and no API key exists on this machine — install `codex` / add a key, run one capture per engine, confirm the `brain(capture)` commit.

*Done when:* every engine appears in `/api/engines` with a truthful probe and fix; each parser and the tool loop are covered by `pnpm test`; one capture per configured engine lands as a `brain(capture)` commit and is undoable.

### Phase 5 — Packaging
PWA over the LAN first (the brain stays on the desktop), then a Tauri 2 desktop shell, then a mobile companion. 5b and 5c wait until Phase 6 (version 1 finish) is done — the user's call on 2026-10-31.

### Phase 5a — PWA shell + LAN pairing
- [x] Single-origin production serving: `pnpm build` builds `apps/web`; the server serves `apps/web/dist` with `@fastify/static` (SPA fallback to `index.html`; `/api/*` and `/ws` untouched); root `pnpm start` (prerequisite: `pnpm build`); `pnpm dev` unchanged
- [x] LAN access opt-in: `server.lanAccess` in `SettingsStore` (or `SYNAPSE_HOST=0.0.0.0`) binds all interfaces, re-bound at runtime; Settings shows the detected LAN URL(s) from `os.networkInterfaces()`
- [x] Pairing token: `crypto.randomBytes(32)` base64url in `.synapse/pairing.json` (mode 600), rotatable from a loopback-only endpoint; loopback needs no token, every other address presents `Authorization: Bearer` (REST) / `?token=` (WS upgrade), `timingSafeEqual`, 401 JSON, `X-Forwarded-For` ignored, token never logged; ARCHITECTURE "Access control" + DECISIONS
- [x] Phone pairing UI: Settings → Phone (fa + en) with a QR code of `http://<lan-ip>:<port>/#pair=<token>` (`qrcode`, pure JS), URL and token copyable; the app reads `#pair=`, stores it, strips the URL, sends it on every `fetch` and in the WS URL; 401 → pairing screen
- [x] Installable shell: `manifest.webmanifest` (standalone, theme colours, 192/512 + maskable PNGs and an Apple touch icon rendered from `public/icon.svg`), `theme-color` + `apple-mobile-web-app-*` tags; no service worker (DECISIONS: LAN HTTP is not a secure context; offline is not a goal)
- [x] Phone layout below 768px: bottom tab bar (Today · Inbox · Capture · Graph · More), node panel as a full-screen sheet, graph tab with touch pan/zoom and larger hit targets, composer above the keyboard (`100dvh` + visual viewport, safe-area insets); desktop layout unchanged; UI-DESIGN "Phone layout"
- [ ] Verified on a real phone by the user: scan the QR from Settings → Phone, open Synapse over Wi‑Fi, capture once, add to the home screen (iOS: the installed app should pair itself through the manifest `start_url`)

*Done when:* the user scans the QR code, opens Synapse on the phone at one URL, captures a thought and sees it filed by the desktop brain · unauthenticated LAN requests get 401 · `pnpm dev` unchanged · `pnpm test` (pairing + static tests) · `pnpm typecheck` · `pnpm vault:validate` · STATUS + DECISIONS updated. (Everything but the real-phone run verified 2026-10-31 from this Mac: curl against the LAN address, the built-in browser at the LAN URL with and without the token, mobile viewport walkthrough.)

### Phase 5b — Tauri 2 desktop
- [ ] Tauri 2 shell around the same server + web app (needs Rust, not installed on this Mac; no sidecars on mobile); candidate home for LAN HTTPS

### Phase 5c — Mobile companion
- [ ] Mobile companion talking to the desktop brain host, or using API-key engines directly

### Phase 6 — Version 1 finish: living graph, categories, smart chat, UI polish
The user found v1 visually weak and hard to read (2026-10-31): RTL/LTR alignment broken in places, the graph controls card covering the graph, flat type-coloured dots with overlapping labels, no sense of where things belong. Spec: `UI-DESIGN.md` (rewritten for this phase), `VAULT-SPEC.md` "Categories".
- [x] Categories: every node belongs to one category (an `area` node) — its own `area`, its project's area, or the majority of its linked nodes; inbox, journal and unsorted groups; `GraphData.categories` with a stable order and an optional `color`; core tests
- [x] The brain files into categories: `/capture` classifies every new node into an existing category or creates a new one; a message with a URL is fetched and summarized (WebFetch, fetched text is untrusted data); one smart chat in which the brain decides between filing and answering; eval cases fa + en
- [x] Living graph renderer (three.js, WebGL): one region per category with a nebula, one colour family per category, type shapes, bloom glow, ambient drift and signal pulses, smooth pan/zoom/fly-to with semantic zoom, DOM labels without overlaps, a birth animation for new nodes, flat and 3D modes
- [x] Graph chrome: command-palette search, a compact toolbar with popovers, a category legend that isolates a category; nothing covers the graph by default
- [x] Shell: full-bleed graph, an end-side dock holding the brain chat and node details, other views as panels over the dimmed graph; the phone layout follows
- [x] Category and node management: categories view (create, rename, recolor, delete with move-to), add-node dialog, delete node with undo
- [x] RTL/LTR: user text isolated with `<bdi>` in UI lists, no `dir="auto"` on containers, mirrored arrows, localized fixed strings and dates; audited in fa + en on desktop and phone
- [x] Verification: `pnpm test` · `pnpm typecheck` · `pnpm vault:validate` · `pnpm vault:context` ≤ 2.5k · changed eval cases · full-resolution screenshots fa/en desktop/phone · ≥ 50 fps with the sample vault on this Mac

*Done when:* a Persian chat message about a new idea or a tutorial link lands in the right (or a new) category, appears in that category's region with its colour and a birth animation; the graph reads as separate, coloured regions with no overlapping labels; every view is correctly aligned in fa and en; categories and nodes can be added, edited and deleted from the UI; all checks above pass; STATUS + DECISIONS updated. (Verified 2026-10-31 — see STATUS; a real phone and a long-lived large vault are still unexercised.)

### Phase 7 — Kinds, a chat-first shell, a mind map that reads like a map
The user's review of Phase 6 (2026-10-31): fonts not good enough and small labels overlapping; the map should name regions first and items only when there is room, like Google Maps, and a click on a category should fly into it; dragging a category's centre should move the region and stay after a refresh; in Persian the chat belongs on the right; a minimal ChatGPT/Claude-like chat page; plain, popular words; and not everything is a task — feelings about a person, goals, moments, routines, saved reels and courses each need their own shape and look, with the Markdown vault and agent-creator standards kept. Spec: `UI-DESIGN.md` (rewritten), `VAULT-SPEC.md` "Kinds", `ARCHITECTURE.md` "Layout" / "Link previews".
- [x] Kinds in the vault: new types `goal`, `habit`, `event`; kind fields for goals, habits, events, people, links and journal as plain frontmatter keys, validated and completed by core `facets.ts` (tests); index lines and sections; sample data for every kind; `pnpm vault:seed --add-missing`
- [x] The brain files kinds: vault rules for goals and habits, events, people; capture classification (a feeling about someone → a moment linked to the person, a link saved for later → the link itself, check-ins on habits); everyday Persian kind names in replies; eval cases fa pass (feeling, goal + habit, check-in, reel)
- [x] Server: the map's layout saved per vault (`GET/PUT/DELETE /api/layout`, `.synapse/layout.json`) and link previews (`GET /api/preview`: Open Graph, YouTube oEmbed, private-address guard, cache); kind fields validated on `PUT`/`POST /api/nodes`; tests
- [x] Type: Yekan Bakh for headings and region names, IRANSans for the interface, Vazirmatn for reading text and map labels; the commercial fonts only when installed, Estedad and Vazirmatn as free stand-ins; Settings → Appearance
- [x] Shell and chat: a start-side sidebar (right in Persian: new chat, pages, recent chats, settings, language) and a ChatGPT-like chat page (greeting and composer in the middle, example cards, model pill, saved items shown as their kinds' cards with Show on the map and Undo); the dock and the Projects / People / Journal pages give way to the chat page and the categories page's kind filters; the phone's tabs follow
- [x] Kinds in the UI: a card and a detail view per kind (goal progress, habit check-ins and streaks, moments with mood, place and people, people with their moments, links with previews), title/summary/fields edited in place, a category picker, an add dialog by kind or "just write it"; Today gains habits, goals and birthdays
- [x] Categories page: the list on the start side, the open category with inline name, line and colour, kind filter chips and sections of cards; plain words everywhere ("item", not "node")
- [x] Mind map like a map app: region names only when zoomed out, item names by zoom level without overlaps (keyed labels that fade); a click on a category's name, centre, chip or (zoomed out) cloud flies into it and opens its card on the start side; dragging a category's centre moves the whole region; the layout is saved and restored; Re-arrange; a tell-the-brain bar; goal, habit and moment shapes and colours
- [x] Verification: `pnpm test` · `pnpm typecheck` · web build · `pnpm vault:validate` · `pnpm vault:context` ≤ 2.5k · eval subset · screenshots fa/en desktop/phone · real-input map tests (labels per zoom level, a click on a region name, dragging a region + reload) · ≥ 50 fps

*Done when:* in Persian the sidebar and the map's panels sit on the right; the chat page works like a chat app and shows what was saved as cards of their kinds; the map shows only region names from afar and readable, non-overlapping item names closer in; a category click flies into its region; a dragged region stays after a reload; goals, habits, moments, people and links each look like what they are; all checks above pass; STATUS + DECISIONS updated. (Verified 2026-10-31 — see STATUS.)

### Phase 8 — Items that read as what they are, a map that steps back, a chat that opens fresh
The user's review of Phase 7 (2026-10-31): a click outside an open box on the map should go one step back (item → category → nothing) and the camera with it, unless they zoomed themselves; the chat should open fresh every time with the past chats in a column of its own rather than under the menu; the item panel looked like a poor Notion copy — the kind was not obvious or changeable, the states were wrong per kind (a moment cannot be paused; a task may have progress), what "done" and "archived" mean on the map and to the brain was undefined, the details should read summary first then the text, and the panels were not right-to-left (English labels inside Persian notes); every kind should keep one shape everywhere. Spec: `UI-DESIGN.md` ("Shapes", "Chat", "Item details", "Mind map", "Done and archived"), `VAULT-SPEC.md` ("Status", "Kinds").
- [x] Vault: `completed` kept in step with `status` by core (`withCompleted`, healed on load, set by the server on `PUT`/`POST`); `done`/`achieved` = history that stays, `archived`/`dropped` = out of sight (index: trailing "Archived" sections, `archived:` count); a kind can change (`PUT` with `type`: the file moves folders, one commit); tests
- [x] The brain keeps things current: "I finished / reached / paused / dropped / got halfway on X" updates X's status, progress or check-ins instead of creating a node (vault AGENTS.md, capture skill + classification + example, kind rules, chat mode hint); daily/weekly reviews ask about stale goals; body lead-ins in the node's language (sample data and the user's vault fixed); eval cases `status-done-fa`, `goal-progress-fa` (pass)
- [x] Item panel: kind badge (glyph + name, a menu changes the kind), title and summary, a facts row of chips — category, state with a menu that says what each state means, dates with the native picker, choices, short texts — the kind's block, Details (Markdown, dominant-script direction per block, also in the editor), Connected to, Maybe related, More
- [x] One glyph per kind everywhere (`TypeIcon` draws the map's silhouettes), a shapes legend in the map's filters; progress drawn into the shapes (a goal's ring, a project's fill)
- [x] Map: a click on empty map, Escape, back or ✕ steps back one level and the camera flies back unless the user moved it (`cameraPose` / `movedSince`); "Show finished items" and "Show archived items" filters; the item menu finishes, archives or reopens per kind
- [x] Chat: opens fresh (no thread loaded at start-up; the page resets unless a reply is streaming); a Chats column inside the page (Today · Yesterday · Last 7 days · Older), folding from the header, a sheet on the phone; the sidebar lists pages only
- [x] Done and archived in the UI: folded "Done" and "Archived" sections at the end of a category (card and page), "Finished this week" on Today
- [x] Verification: `pnpm test` · `pnpm typecheck` · web build · `pnpm vault:context` ≤ 2.5k · the two eval cases · screenshots fa (panels per kind, chat, categories, today) · real-input map test (region click → item click → two background clicks step back and the camera returns)

*Done when:* on the map, clicking outside an open item or category steps back one level and the camera returns; the chat page opens fresh with the past chats in its own column; every item shows its kind unmistakably and can change it, its state chip offers only that kind's states and explains them, its panel is right-to-left in Persian with no English labels; finished items stay faded and archived ones leave the map, both folded away in their category; each kind keeps one shape on the map and in the UI; the brain updates an item's status from conversation; all checks above pass; STATUS + DECISIONS updated. (Verified 2026-10-31 — see STATUS.)

### Phase 9 — A brain that asks, a coach that plans, one card per item
The user's review of Phase 8 (2026-10-31): text fields were not right-to-left while empty; the details' edit button sat on the wrong side; an item should read as one card — kind and category on top, then title, summary and details with what happened to it over time; the brain should ask when it is unsure which category or what details a node needs, build links from the node's "identity card" with the least context, offer a consult mode grounded in the vault, and a coach that plans the day, sets priorities and reads the owner — with the inbox and today under it — and every action should run on the engine, model and effort the user picks among the connected providers. Spec: `UI-DESIGN.md` ("Chat", "Item details", "Coach"), `VAULT-SPEC.md` ("History", "Index"), `ARCHITECTURE.md` ("Automation"), `BRAIN-ENGINES.md` ("Modes").
- [x] Inputs: every text field takes the UI direction while empty (`inputDir`); the details' edit button beside its label on the start side
- [x] Item panel as one card: the facts row (kind badge, category, state, chips) on top; title, summary, details and the item's **history** (created → dated body lines → finished, `lib/history.ts`) in one bordered card; the kind's block under it
- [x] The brain asks before filing when the category, the kind or a needed fact is unclear (vault AGENTS.md, capture skill + classification + example 10, chat hint); links on a budget from the category's sub-index (at most five opened candidates; linking rule, link skill); dated history lines on every update; eval `asks-before-filing-fa`
- [x] Core: `index/by-area/<area>.md` per category (members by kind, following the graph's assignment, archived last), index lines carry `people:`; INDEX.md points to them; tests
- [x] Consult mode: `advise` mode and vault skill (read-only, grounded, asks what is missing, options and one next step, offers to save); the composer's Chat / Consult switch with its own greeting and examples; eval `advise-fa`
- [x] Coach page (Now · Plan · Inbox · Me): today's plan from the daily review (which now ends with **Today's focus**, three things with why), the last weekly review, the inbox, `memory/insights.md` from the `insight` skill and `memory/profile.md` (`GET /api/memory/:name`); Today and Inbox leave the sidebar and tabs
- [x] Automation: `settings.automation` (daily time, weekly weekday + time) run by the server's `Automation` (`dueRuns`, `.synapse/automation.json`, only when the brain is signed in); a toast with **See** when a scheduled or background review finishes; tests
- [x] The brain picker: engine (among those ready), model and effort per device for every run (`POST /api/brain/run {engine}`; a thread that switches engines starts a new session), in the chat header and on the coach page
- [x] Verification: `pnpm test` · `pnpm typecheck` · web build · `pnpm vault:context` ≤ 2.5k · evals (ask-first, advise, insight) · screenshots fa (chat modes, coach tabs, the item card)

*Done when:* an empty Persian field starts on the right; an item shows kind, category and state on top and its title, summary, text and history in one card; a thin message («با سارا حرف زدم») gets a question and no file, a clear one files at once with links picked from its category's sub-index; consult mode answers from the vault without writing; the coach page plans the day, shows the inbox and the insight, and runs the reviews on a schedule; the picker switches engine, model and effort for the next run; all checks above pass; STATUS + DECISIONS updated. (Verified 2026-10-31 — see STATUS.)

### Phase 10 — An ignition, maps beside the mind map, a brain that makes
The user's request after Phase 9 (2026-10-31): a striking start effect every time the mind map loads or comes back — signals exchanged between all the items, glowing; a **character map** built from the data about the user themselves (traits, what matters to them, concerns, tone) that sits inside the same space as a part of the mind map, with a switch to connect it to the mind map or not, so that when the brain writes something it has the user's tone and mindset; custom maps of the same kind for a business or a page, each connectable to the mind map, the character map or another map; and a **make** mode in the assistant that produces output — a Telegram post, an Instagram caption — from the business's information and the user's own voice. Spec: `VAULT-SPEC.md` ("Maps", "Index"), `UI-DESIGN.md` ("Maps", "Chat", "Living graph" → Ignition, "Coach"), `ARCHITECTURE.md` (API rows), `BRAIN-ENGINES.md` ("Modes").
- [x] Ignition: `engine.playIntro` on the first data and on every return to the map page (births in waves from each region's centre, the signal wave along the links, denser traffic, nebulae and outlines from dark, a bloom swell; islands half a second later; the camera settles in on a return)
- [x] Core: the `map` kind (`nodes/maps/`, `connects`, `role: character`), `map` on areas, `buildMaps` (connections from either side, counts), `map` on nodes and categories, `maps` in `graph.json`, the area → map `belongs_to` edge; INDEX.md **Maps** section (map, purpose, connections, its categories) with **Areas** for the mind map only; index lines carry `map:` / `connects:`; tests
- [x] Canvas: islands (`computeAnchors` with zones: a ring of their own around the mind map as it lies, close when connected, far when not, moved out as a whole until clear; a connection change frees the island's saved places), dashed outlines (`ZONE_FRAGMENT`), zone labels with a click, bridges drawn and simulated only between connected maps, hidden maps (`filters.hiddenMaps`)
- [x] UI: the Maps panel in the toolbar (show/hide, connection chips, Build / Refresh, New map), the map card (`MapSummary`), the New map dialog, categories made inside a map, the `map` glyph; the chat's three-way switch with make mode (greeting, cards, green orb, the For chip → `POST /brain/run {map}`); the coach's Me tab character card; a toast with See when a character build finishes
- [x] Brain: modes `make` and `character` (`modes.ts`, `mapHint`), vault skills `make` (read-only, the piece first, platform conventions, voice from the character map and the map's tone category) and `character` (builds the map node, four categories, evidence-backed items, refresh in place), the `maps.md` rule, maps in AGENTS.md / capture / linking / node-format / projects-areas; sample data with a character map and a page map; evals `make-fa`, `character-fa`; template context ≤ 2.5k (2480)
- [x] Server: `PUT`/`POST /nodes` take `map` and `connects`; deleting a map returns its categories to the mind map; `POST /brain/run {map}` → the Map line in the runtime context
- [x] Verification: `pnpm test` · `pnpm typecheck` · `pnpm vault:validate` on a fresh seed · `pnpm vault:context` · real-input browser pass (ignition frames, islands, the map card from a zone label, the maps panel, make mode, the Me tab; disconnecting a map moved its island from 625 to 852 world units out and dropped its bridge, reconnecting brought it back) · evals

*Done when:* the map lights up in waves with signals on every arrival; the character map and a custom map sit as ringed islands beside the mind map, connected ones close with bridges, disconnected ones apart; a map's card and the maps panel toggle connections and build the character map; make mode writes a post in the user's voice from the right map and saves nothing; all checks above pass; STATUS + DECISIONS updated. (Verified 2026-11-01 — see STATUS.)

### Phase 11 — Islands that read well, scopes, a brain that sorts across spaces
The user's review of Phase 10 (2026-11-01): the dashed ring around an island is ugly — a separate structure should be drawn in a prettier, friendlier way; a whole island must move as one like a category; each island needs an obvious on/off for its connection to the second brain; when islands are cut off, every action (chat, consult, make) must let the user pick where it works — the core (the mind map plus whatever is connected) or any cut-off island; the brain must decide where new data goes (a node in the business, in the character, in the mind map, in two of them, or split across them); the ignition stopped playing after nodes were moved and the page refreshed or the tab switched; and the map's tell bar must understand on its own whether a message is a consult, a chat or a make. Spec: `UI-DESIGN.md` ("Maps", "Scopes", "Chat", "Living graph" → Ignition), `VAULT-SPEC.md` ("Maps" → Scopes), `ARCHITECTURE.md` (`POST /brain/run {scope}`), `BRAIN-ENGINES.md` ("Modes").
- [x] Islands as luminous fields: cloud texture, a wobbling soft coastline, a breathing shore (`ZONE_FRAGMENT` with the baked noise), sized to cover the regions' clouds; the island's name with the **switch** under it
- [x] Dragging an island's name moves every region of the map (`engine` `zoneDrag` → `layout.moveGroup` per region, saved like any drag); the label's hit box follows the name's real place
- [x] The switch on the island label writes `connects` (mind on/off) through `connectionPatches`
- [x] Scopes: core `scopesOf` + the web mirror, the `ScopePick` beside the mode switch and in the tell bar (only while a map is cut off), `scope` on every run, the server's Scope line (`scopeHint`), the skills reading it (capture, ask, advise, make); tests
- [x] The brain sorts across spaces: capture's "which space, then which category" (a self-statement is an item for the character map even beside a task; one message may feed several spaces), the chat hint routes advise / make from the message; eval `split-spaces-fa`
- [x] The ignition survives a data refresh mid-way (queue keyed by id, no cancel in `setData`); verified with a saved layout
- [x] Verification: `pnpm test` · `pnpm typecheck` · `pnpm vault:context` ≤ 2.5k · real-input browser pass (islands, the switch, a drag of an island by its name, the scope pick on the map and in the chat with a cut-off map, the ignition with a saved layout) · eval

*Done when:* an island reads as a soft luminous field with its name and switch; dragging its name moves the whole map; the switch cuts it off and reconnects it on the canvas; the scope pick lists the core and every cut-off island and the brain stays inside the chosen one; a message with a task and a self-observation files both in their places; the ignition plays after a drag and a refresh; all checks above pass; STATUS + DECISIONS updated. (Verified 2026-11-01 — see STATUS.)

### Phase 12 — An island has a centre
The user's review of Phase 11 (2026-11-01): an island needs a central point — a minimal symbol (a figure for the character, something fitting for a business) — that is the handle to move the whole island and carries its on/off switch; the halo and circle around it were still ugly and must be mellower; and the scope pick never appeared for them because cutting an island off with its switch left it connected to the mind map through another map. Spec: `UI-DESIGN.md` "Maps", `VAULT-SPEC.md` "Kinds" (`symbol`).
- [x] Core: `symbol` field on maps (`MAP_SYMBOLS`, `mapSymbol` defaults by role), resolved into `graph.json`; the `maps.md` rule names it
- [x] Canvas: the island centre — the symbol badge at the island's heart with the name, count and switch under it, at every zoom (`labels.ts` zone labels, `graph/zoneGlyphs.ts`); dragging the badge moves the island; the haze is a mellow gaussian field with a wobbling reach and no ring
- [x] The switch cuts a map off from everything (`cutOffPatches`) and reconnects it to the mind map, so a cut-off island always becomes a scope of its own
- [x] The symbol picker in the New map dialog and the map card; the maps panel shows the glyph
- [x] Verification: `pnpm test` · `pnpm typecheck` · real-input browser pass (the centre at the overview and zoomed in, a badge drag moving all regions, the switch cutting off → the scope pick on the map and in the chat, reconnecting)

*Done when:* every island has a symbol badge at its centre that opens the card, drags the island and carries the switch; the field under it reads as a haze, not a circle; pressing the switch on any island makes it a scope the pick offers; all checks above pass; STATUS updated. (Verified 2026-11-01 — see STATUS.)

### Phase 13 — An island drawn in the map's own language
The user's review of Phase 12 (2026-11-01): the centre badge was ugly — a foreign card that covered the map at the overview and matched neither the items nor the categories' centres; the island's items had no link to their centre; an island must be one colour like a category; the switch must cover nothing; and every relation — centre to item, island to island, island to the mind map — must be drawn and respected. Spec: `UI-DESIGN.md` "Maps".
- [x] Canvas: the map node is the island's centre — a hub in its own group at the heart of the ring (`layout.ts` `computeRing` centre group), drawn by the node shader like a category's centre with a second orbit (shape `map`) and the symbol as a glyph over it (`labels.ts` `updateGlyphs`); the name and count hang under it at every zoom, the switch only while it is hovered or selected
- [x] One hue per island: the map's hue colours its regions, items, nebulae and chips (`colors.ts` `zoneHue`, `graph/model.ts`, `lib/categories.ts` `usePalette`)
- [x] The core: a client-side `core:mind` node at the centre of the mind map's ring (shape `core`); a click frames the mind map, dragging it carries the whole mind map (`zoneDrag` with `MIND_ZONE`); a layout saved before the core existed leaves the inbox's old place at the heart (`layout.ts` `withoutStaleInbox`)
- [x] Structure links drawn (`GraphView` `withStructure`): core → the mind map's categories, centre → its categories, centre → core while connected, centre ↔ centre while two maps are connected; the ignition's wave runs along them
- [x] Verification: `pnpm test` · `pnpm typecheck` · real-input browser pass (centres at the overview and zoomed in, one family per island, a centre drag moving every region, the switch cutting off → the scope pick, and linking back)

*Done when:* an island's centre is a node like a category's with its symbol on it, named under it at every zoom, with its switch shown only on hover; the whole island is one colour family; the core, the centres and their links are drawn; all checks above pass; STATUS updated. (Verified 2026-11-01 — see STATUS.)

### Phase 14 — A map that holds still, a switch you can reach
The user's review of Phase 13 (2026-11-01): the hover switch vanished before the pointer reached it; an island jumped back to a computed place when its connection changed; positions seemed to shift under other actions. Spec: `UI-DESIGN.md` "Maps", "Living graph" → Regions.
- [x] Islands and regions keep their places: anchors stick once computed (`layout.ts` `setData`), a connection change moves nothing, a refresh that changes nothing does not reheat the simulation, the layout is saved after every refresh (`GraphView`)
- [x] The switch is a permanent wordless toggle in the island's colour beside the island on its open side (`labels.ts` `updateToggles`, `engine.ts` `updateLabels`); the name under the centre carries no switch
- [x] An island's centre click (and the core's) remembers the camera like a category click, and app flights use `engine.frameNodes`, so an empty-map click or Escape glides back
- [x] From afar an island says only its name; its regions' names come in as it opens on screen (`engine.ts` `updateLabels`, `islandOpen`)
- [x] Verification: `pnpm test` (layout: a new region moves nothing placed, an island stays through a connection change, an unchanged refresh stirs nothing) · `pnpm typecheck` · real-input browser pass (toggles beside both islands on their open sides, a press cutting off and linking back with the island's anchors unchanged, a category fly and a refresh moving nothing)

*Done when:* pressing an island's toggle changes its connection without moving it; no action short of a drag or Rearrange moves a region; the toggle is reachable at any zoom; all checks above pass; STATUS updated. (Verified 2026-11-01 — see STATUS.)

### Phase 15 — A brain you can watch
The user's request after Phase 14 (2026-11-01): the core should wear a brain in its own colour; a way to reset the layout; while the brain works, the map should show live where it reads and acts — signals from the core to those items and back — and the core itself at work; a proper loading mark in the chat; and a button that erases everything entered into the system. Spec: `UI-DESIGN.md` "Living graph" → The brain at work, "Chat", "Views" → Settings; `ARCHITECTURE.md` (`/api/vault/reset`, `brain.event` `touched`).
- [x] The core wears the brain (`graph/zoneGlyphs.ts` `brain`, drawn by `labels.ts` `updateGlyphs` like a map's symbol)
- [x] The core at work: `uWork` spins its orbits up, pulses it and sends ripples outward while a run is live (`shaders.ts`, `engine.setWorking`)
- [x] Live signals: the server names what each tool touched (`brain-runner.ts` `touchedBy` → `brain.event.touched`), the app maps files to items (`App.tsx`, `lib/activity.ts`), the engine runs a pulse from the core out along the links and back, the item glowing on arrival (`engine.signal`)
- [x] The brain at work in the chat's reply row and the map's tell bar (`components/BrainWorking.tsx`)
- [x] Erase everything: `POST /api/vault/reset` with a typed word, the Settings danger card, the vault's history restarted (`vault-service.ts` `eraseAll`, `vault-git.ts` `reinit`, `brain-runner.ts` `forgetThreads`)
- [x] The toolbar's re-arrange still lays the whole map — islands included — out afresh with anchors that stick
- [x] Verification: `pnpm test` (`touched.test.ts`, `reset.test.ts`) · `pnpm typecheck` · real-input browser pass (the brain on the core up close, the core at work, a real run from the tell bar with signals recorded for the index and the note it opened, the chat's working mark during that run, the danger card, re-arrange after a drag)

*Done when:* the core shows a brain and visibly works during a run; what the brain reads or writes lights its path on the map; the chat shows the brain at work while waiting; Settings can erase everything; all checks above pass; STATUS updated. (Verified 2026-11-01 — see STATUS.)

### Phase 16 — Ship it: a clean start, one image, two repositories
The user's request after Phase 15 (2026-11-01): put the project on GitHub as a ready, clean project anyone can download and run; and a second repository from which the same version runs on their Coolify server from a Dockerfile, usable from a phone and every computer, with the setup steps written down. Spec: `README.md`, `docs/DEPLOY.md`, `ARCHITECTURE.md` ("Access control", "Ports").
- [x] A clean start: `pnpm vault:create` is the documented first step (an empty vault); `pnpm vault:seed` stays the demo; Settings → Erase everything returns a vault to empty
- [x] A public README for people: what it is, requirements, quick start, production, how it is built, privacy and terms, the MIT license (`LICENSE`, chosen by the user)
- [x] One image: `Dockerfile` (deps → build → runtime with the Claude Code CLI, the `node` user, `/data` volume, health check), `docker/entrypoint.sh` (an empty vault on first start), `.dockerignore`, `docker-compose.yml`
- [x] Cloud-friendly access: `SYNAPSE_PAIR_TOKEN` pins the pairing token (rotation answers 409), `CLAUDE_CODE_OAUTH_TOKEN` passes the env sanitiser, vault git gets a local identity, `/api/health` is public
- [x] `docs/DEPLOY.md`: the Coolify guide — tokens, resource, storage, variables, domain, first open, phone, backups, rotation, plain Docker, notes
- [x] Verification: `pnpm test` · `pnpm typecheck` · `docker build` and a container run (health without a token, the web shell served, the API refusing without the pair token and answering with it, the CLI present, an empty vault created in the volume)
- [x] GitHub: the public repository and the private one for the cloud, both with `main` pushed

*Done when:* a stranger can clone the public repository, run three commands and talk to an empty vault; the user can point Coolify at the cloud repository and follow DEPLOY.md to a paired phone; STATUS updated. (Verified 2026-11-01 — see STATUS; the Coolify steps themselves are on the user.)

### Phase 17 — A server that answers and an owner who signs in
The user's report after deploying to Coolify (2026-11-01): every page was 502, and the first start should set up a username and password so nobody else can get in. Found in Coolify: Ports Exposes left at the default 3000 while Synapse listens on 4317 (the 502), no persistent storage (each redeploy would start empty), no environment variables (the brain not signed in). Spec: `ARCHITECTURE.md` "Access control", `UI-DESIGN.md` (sign-in screen, Settings → Account), `docs/DEPLOY.md`.
- [x] The owner account: `auth.ts` (`AuthStore`: scrypt hash, hashed session tokens, 90 days, at most 20; `Throttle`), `routes/auth.ts` (status, setup, login, logout, password), the access guard accepting sessions, `SYNAPSE_TRUST_LOOPBACK` (the image sets false), the setup code in the server log while no account exists
- [x] The sign-in screen (`AuthScreen.tsx`: create account with the setup code, sign in, "Have a pair link?"), Settings → Account (sign out, change password, create on the desktop), the Phone card hidden for a signed-in browser
- [x] The image: loopback distrusted, the entrypoint explains an unwritable `/data`, the health check out of the request log
- [x] `docs/DEPLOY.md` rewritten: Ports Exposes 4317 (the 502), a Volume Mount at `/data`, only `CLAUDE_CODE_OAUTH_TOKEN` to set, the first open with the setup code, forgotten password
- [x] Coolify fixed: Ports Exposes 4317, a volume at `/data`, redeployed; the deployment answers with the account setup
- [x] Verification: `pnpm test` (`auth.test.ts`: code-guarded setup, one account, sign-in in any case, sign-out, WebSocket with a session, password change revoking others, the throttle, loopback distrusted) · `pnpm typecheck` · the built app with loopback distrusted driven by real clicks (wrong code, setup, Settings → Account, sign out, wrong password, sign in) · the image built and run (setup code in `docker logs`, setup and a session from outside)

*Done when:* the deployed Synapse answers instead of 502, asks for an account on first open (guarded by the log's setup code) and for the username and password after; all checks above pass; STATUS updated. (Verified 2026-11-01 — see STATUS; the account itself and the Claude token are the user's to enter.)

### Phase 18 — Sign in to your subscriptions from Settings
The user's request after signing in to the deployed Synapse (2026-11-01): Settings had no way to link the Claude subscription or the ChatGPT account from the app (only "open a terminal and run /login"), the Codex CLI was missing from the image, the OpenRouter key field was easy to miss, and once connected each engine's model and effort should be chosen. Spec: `BRAIN-ENGINES.md` "Sign-in from the app" and "Legal basis", `ARCHITECTURE.md` (`/api/engines/:id/sign-in`, `/sign-out`), `UI-DESIGN.md` Settings → Brain, `DEPLOY.md`.
- [x] Contract: `SignInSpec` on CLI engines (`claude auth login --claudeai` paste-code, `codex login --device-auth` device-code, their logouts, the vendor hosts) and `resolveBin()`; `sign-in.ts` reads the CLI's output (OSC 8 links first, device code, paste prompt, last error) and redacts secrets
- [x] Server: `cli-sign-in.ts` runs the CLI's own sign-in on a terminal (util-linux `script` on Linux, pipes elsewhere), passes a pasted code to its terminal only, probes when it exits, cancels, signs out; routes in `routes/engine-sign-in.ts`; `/api/engines` says which flow each engine has
- [x] Settings → Brain: **Sign in with your Claude subscription** (link + paste field), **Sign in with your ChatGPT account** (link + device code with Copy), Sign out; API cards point to where keys are made; model and effort appear once connected
- [x] The image installs the Codex CLI next to Claude Code
- [x] The rule changed with the user's request: `AGENTS.md` invariant and `BRAIN-ENGINES.md` "Legal basis" now allow running the vendor CLI's own sign-in on the user's server; Synapse still never reads or stores credentials
- [x] Verification: `pnpm test` (`sign-in.test.ts`, `cli-sign-in.test.ts` with stand-in CLIs: paste flow, wrong code not echoed, device flow, cancel, sign-out) on macOS and inside the Linux image (real terminal) · `pnpm typecheck` · the image driven by real clicks: the Claude box with a claude.com link and the paste field, Cancel, the ChatGPT box with an auth.openai.com link and a live device code (the test container was removed at once)

*Done when:* from Settings on the deployed Synapse the user can sign in to the Claude subscription and the ChatGPT account, paste an OpenRouter key, and choose each engine's model and effort; all checks above pass; STATUS updated. (Verified 2026-11-01 up to the vendors' pages — completing the sign-ins is the user's.)

### Phase 19 — Replies that arrive behind a CDN, errors that say what they are
The user's report after signing in on the deployment (2026-11-01): "سلام" got no answer and the bottom said "reconnecting to the server…"; things that fail should come with a log or an error code to follow up; and in Persian the user's own messages belong on the right. Found: the brain had answered within seconds — the CDN in front of the domain drops the WebSocket upgrade (the app logs every `/ws` as a plain GET → 401), so no event reached the page. Spec: `ARCHITECTURE.md` "Live events", "Diagnostics", `UI-DESIGN.md` "Chat", Settings.
- [x] Live events over HTTP when the WebSocket cannot open: the event log with seq and epoch (`ws.ts`), `GET /api/events` long-poll, `connectLive` switching after two failed opens (`lib/ws.ts`), the held poll ended by the response's close
- [x] Error codes everywhere: `x-request-id` on every response and `requestId` in error bodies, `HTTP-…` / `HTTP-NET` / `LIVE-…` / `RUN-…` codes in messages, the client and server error logs, `GET /api/diagnostics`, Settings → Diagnostics with Copy report, the offline pill with its code
- [x] The user's chat bubbles on the right in Persian
- [x] Verification: `pnpm test` (`live-events.test.ts` over a real socket: a poll held for its wait and woken by an event, reset on another epoch, 401 without sign-in, request ids, diagnostics; `live.test.ts`: a WebSocket that never opens → HTTP and the same events) · `pnpm typecheck` · the dev app with the fallback forced (an event arriving over HTTP, the diagnostics card, the chat sides)

*Done when:* on the deployment behind its CDN a message gets its reply live, failures show a code that the diagnostics report explains, and the user's messages sit on the right; all checks above pass; STATUS updated.

### Phase 20 — A chat that reads like a messenger, chats you can tidy, a brain that knows when a world needs its own island
The user's review after the first replies on the deployment (2026-11-01): the chat should look like Telegram — the brain's replies from the other side in a lighter bubble; past chats need rename and delete; and the brain should decide from the conversation whether things belong in the mind map or in a new island connected to it — asking when unsure, and following the user when they say "a separate island". Spec: `UI-DESIGN.md` "Chat", `VAULT-SPEC.md` "Maps", the template's `maps.md` rule and capture skill.
- [x] Messenger layout: brain bubbles on the left (lighter, tail on its side), user bubbles on the right, in both directions
- [x] Rename and delete past chats: `PATCH` / `DELETE /api/threads/:id` (`renameThread`, `deleteThread`, refused while a run of the chat is live), a ⋯ menu per row with inline rename and a two-step delete
- [x] The brain and islands: the vault's hard rule, `maps.md` ("When a map", "Making it") and the capture skill's step 3–4 with the exact question and example 11; the always-loaded budget stays at 2499
- [x] Verification: `pnpm test` (`threads.test.ts`) · `pnpm typecheck` · `pnpm vault:context` / `vault:validate` · evals `island-explicit-fa` (map + area + tasks in the new island), `island-ask-fa` (asks the island-or-category question, files nothing; harness checks `in_new_map` and `reply_includes_any` added), `island-not-needed-fa` (a task in «یادگیری», no map), `asks-before-filing-fa` still passing · the dev app: bubbles' sides measured, the row menu, rename focus and Escape

*Done when:* the chat reads like a messenger, past chats can be renamed and deleted, and the brain puts a new world in its own island when told, asks when it is unclear, and keeps topics as categories; all checks above pass; STATUS updated. (Verified 2026-11-01.)

### Phase 21 — Islands that keep their connections, a brain at the core
The user's report on the deployment (2026-11-01): an island switched off and on again came back linked to the mind map but no longer to the other islands; and the core was meant to be a brain — something that looks like one — with the threads between it and what it reads carrying something like an electric current, neural messages going back and forth, and the brain itself visibly at work before it reaches for anything. Spec: `VAULT-SPEC.md` "Maps" (Switched off), `UI-DESIGN.md` "Maps" (The switch, The core) and "Living graph" (The brain, The brain at work).
- [x] The switch pauses instead of erasing: `apart: true` on the map (a map field), core `buildMaps` gives `connects` (live), `apart` and `kept` (as written, both sides); `INDEX.md` marks a switched-off map; the toggle writes only the mark (`lib/maps.ts` `switchPatches`), the connection chips keep paused connections (dashed, a press switches both back on); the server takes true/false fields; the template's `maps.md` tells the brain
- [x] The brain at the core: `graph/brain.ts` (`BrainLayer`, `bakeFolds` on idle) and `BRAIN_FRAGMENT` — silhouette, folds, glass, halo, detail by size, a minimum size; the hub and the DOM glyph are gone from the core; the core is there whenever the vault holds anything
- [x] Thinking: waves through the folds, sparks, discharges and aura waves while a run is live
- [x] Reaches: `graph/arcs.ts` (`ArcLayer`, `planReach`) and `ARC_FRAGMENT` — a bolt out of the brain's heart, the current hop by hop through the item's own category, the ring of arrival (`iTouch`), the charged link, the packet home and the flash in the brain; region names keep off the brain
- [x] Verification: `pnpm test` (core `graph.test.ts` switched-off maps and their index lines, web `maps.test.ts` switch and chip writes, `arcs.test.ts` reach timing) · `pnpm typecheck` · the dev app on a seeded vault: the switch clicked off and on with real input (both connections back, the files as before), the brain up close and from afar, a simulated reach shot at seven moments, 60 fps with 46 live currents (`--gpu`)

*Done when:* an island switched off and on is connected exactly as before; the core reads as a brain at every zoom, visibly thinks while a run is live, and every item it reads or writes gets a current out and an answer back; all checks above pass; STATUS updated. (Verified 2026-11-01 on the dev app; the deployment is the user's pass.)

### Phase 22 — A map without names, a tool that opens crowded spots
The user's request after Phase 21 (2026-11-01): an option to hide the items' names, and an option that changes the cursor so that every click where items crowd spreads them a little apart, to see them more easily. Spec: `UI-DESIGN.md` "Mind map" (Toolbar, Spreading) and "Map-style labels"; `ARCHITECTURE.md` "Layout".
- [x] The names switch in the toolbar (`showNames`, per device; `engine.setShowNames`): no item is named at any zoom; region and island names stay
- [x] The spread tool (`spreading`; `engine.setSpread`): the spreading cursor (arrows outward, inward while Shift or Alt gathers), the brush ring, the hint with ✕; Escape ends it; hover stays quiet, a drag pans, a click spreads
- [x] Room in the layout: `room` per item (`Layout.spread`, `applyRoom`; personal space, push and the region's pull follow it), saved in `layout.json` (`LayoutStore` `room`, `PUT /api/layout {room}`) and forgotten by Re-arrange
- [x] Verification: `pnpm test` (web `layout.test.ts`: a spot opens and stays open, gathering closes it, room capped, saved, restored and forgotten; server `layout-preview.test.ts`: room stored, capped, kept when only positions are saved, reset) · `pnpm typecheck` · the dev app with real clicks: names off and on from the toolbar, the tool's cursor (computed style) and ring, three clicks at the overview open «کار» from an average gap of 23 to 59 with the room saved, Shift-click gathers, Escape ends the tool

*Done when:* items' names can be hidden from the toolbar and come back, and the spread tool opens a crowded spot a little more with every click and keeps it open; all checks above pass; STATUS updated. (Verified 2026-11-01 on the dev app.)

### Phase 23 — Synapse in Claude, ChatGPT and other AI apps (MCP)
The user's request (2026-11-01): build an MCP for Claude and OpenAI so Synapse can be added as an MCP connector in different AI apps and they use its data. Spec: `ARCHITECTURE.md` "MCP connector", `UI-DESIGN.md` "Connections"; decisions of 2026-11-01.
- [x] The endpoint: `/mcp`, Streamable HTTP through the MCP TypeScript SDK v2 (stateless, 2026-07-28 and 2025-era clients), the `401` challenge, a desktop app on loopback without a token (loopback `Host` only)
- [x] OAuth 2.1: discovery documents, client metadata documents and registration, the consent page and its API, PKCE S256, `iss`, tokens with rotation, revocation, scopes `synapse:read` / `synapse:write`, `.synapse/connections.json` with hashes only, a new password ends every connection, personal keys
- [x] The tools: `overview`, `search`, `fetch`, `list_items`, `agenda`, `about_owner`; with write: `add_item`, `update_item`, `write_journal`, each one `mcp(<app>)` commit with Undo in History
- [x] The web app: Settings → Connections (address, steps per app, connected apps, keys), the consent page at `/oauth/authorize`, `#item=<id>` links
- [x] Verification: `pnpm test` (`mcp.test.ts`: discovery, the challenge, registration, consent, codes, refresh rotation, metadata documents for Claude Code and ChatGPT, every tool, keys, password change, hashed file; `mcp-client.test.ts`: the official client signs in and calls tools) · `pnpm typecheck` · a test server: the browser signs in on the consent page, allows a test client and returns to it, which then lists and calls the tools; the Claude Code CLI as a real client with a read-only key; Settings → Connections in fa and en and at phone width
- [ ] On the deployment: the owner adds the connector in Claude and in ChatGPT and both answer from the vault

*Done when:* Claude and ChatGPT connect to the deployed Synapse after the owner approves them, and answer from (and, if allowed, write to) the vault; all checks above pass; STATUS updated.

### Phase 24 — No names at all, colours of the owner's choice
The user's request (2026-11-01): the names switch gets a step that hides category and island names too, so the map shows no names at all; and the owner can change the automatic colour of a category or an island with a picker that has the whole spectrum, every part of it following in harmony. Spec: `UI-DESIGN.md` "Colour", "Mind map" (Toolbar), "Map-style labels", "Maps"; `VAULT-SPEC.md` `color`; decisions of 2026-11-01.
- [x] The names switch in three steps (`mapNames`: `all` → `places` → `none`, per device; Phase 22's stored true/false reads as `all` / `places`; `engine.setNames`): with none, no region, island or item is named; the hover card still names
- [x] Tones: a family's base colour (hue, vividness, lightness held to 0.60–0.94) from a category's own `color`, else its map's, else the sequence (`colors.ts` `Tone`, `toneOfHex`, `autoTone`; `model.ts` `familyTones`); a map's own `color` (core `MapInfo.color`) colours its centre, haze, categories and items; the quick picks keep their old look
- [x] The colour picker (`components/ColorPicker.tsx`): the spectrum field (hue across, vividness up), brightness, twelve quick picks, the hex code (kept as typed when the map can show it), Automatic; in the map's category card, the Categories page, the category dialog and the map card
- [x] Live colour: `store.colorDraft` while picking (dropped once the vault has it), `engine.setColors` when `modelShape` is unchanged — no rebuild, nothing moves
- [x] Verification: `pnpm test` (core: a map's colour; web `colors.test.ts`: gamut, quick picks unchanged, an own colour's vividness and lightness carried, lightness held, picker round trip; `graph-model.test.ts`: own colour → island's → sequence, an island recoloured with the same shape, drafts) · `pnpm typecheck` · a test server with real input: the three steps close up (24 item names → 0) and from afar (8 place names → 0), the island card's picker dragged, a quick pick, Automatic back, a category of the island with its own colour, arrow keys, the brightness slider, typed codes (`#FF8800` kept, `101010` brought up to `#808080`, `#8af` → `#88aaff`), English and phone width; the map was recoloured 32 times and rebuilt 0 times

*Done when:* the map can show no names at all, and a category or an island takes any colour the owner picks with all its parts following it, live while picking and saved in the vault; all checks above pass; STATUS updated. (Verified 2026-11-01 on a test server.)

### Phase 25 — Spreading and gathering that stay
The user's report (2026-11-01): what the spread tool opens up springs back after a refresh or after leaving the map and coming back; it should stay until they undo it themselves, and a second button should do the opposite — bring items closer, pack them tighter — saved the same way. Spec: `UI-DESIGN.md` "Mind map" (Toolbar, Spreading); `ARCHITECTURE.md` "Layout"; decision of 2026-11-01.
- [x] The cause: the room was saved only once the map had settled plus a 1.2 s wait, and the waiting save was thrown away when the map unmounted, so a refresh or a page change within those seconds lost it
- [x] Saved at once and never dropped: every spread or gather click reports a layout change (`engine.spreadAt` → `onLayoutChange`); `GraphView` `flushLayout` sends a waiting save with `fetch` `keepalive` on `pagehide`, a hidden page and unmount; `settled` in the snapshot (and `.synapse/layout.json`) makes a map saved mid-move settle fully on load (alpha 0.3 instead of 0.06)
- [x] The gather tool: its own toolbar button and hint (`spreadTool`: `spread` | `gather`; `engine.setSpread(mode)`), Shift or Alt flipping either tool; room down to `ROOM_MIN` 0.4 with a collide floor so items never overlap; the server keeps 0.4–4
- [x] Verification: `pnpm test` (web `layout.test.ts`: gathering past the laid-out spacing without overlaps and staying gathered, the settled flag, a mid-move save settling fully; server `layout-preview.test.ts`: gathered room kept, `settled` stored, a bad flag refused) · `pnpm typecheck` · a test server with real input: spread then a reload 300 ms later kept every room (gap 87 → 87), the gather button and hint, eight gather clicks packed «کار» from a mean gap of 87 to 15 (laid out: 26), leaving the map and coming back kept 15, a reload kept 15, and once the map settled the save said `settled: true`

*Done when:* what the spread and gather tools do stays after a refresh and after leaving the map, until the owner undoes it with the other tool or Re-arrange; all checks above pass; STATUS updated. (Verified 2026-11-01 on a test server.)

### Phase 26 — One map across every open copy
The user's report (2026-11-02): spreading a category's items and refreshing brought the old map back again. Measured on the deployment: another open copy of the app (their own idle tab) re-saved its older map every 25 seconds, so a spread made elsewhere was written over within half a minute. Spec: `ARCHITECTURE.md` "Layout", "Live events"; `UI-DESIGN.md` "Mind map" (Dragging, Spreading); decision of 2026-11-02.
- [x] The cause: `useT()` returned a new function on every render, so `GraphView` rebuilt the model on every live poll, and the view saved the layout after every refresh, changed or not; the server kept whatever came last (on the deployment the file flipped between two tabs every ~12 s)
- [x] A copy saves only after its own map changed: one `t` per language; no save on refresh; the settle, the brush and drag events save, and a map laid out from scratch saves once (`Layout.takeFresh`)
- [x] Revisions on the server: `.synapse/layout.json` `rev`; `PUT /api/layout {base, client}` refused as `{ok: false, stale: true, rev}` (a 200, past the CDN) when another copy saved since, its own saves still on their way excepted, and when it names no base (an old bundle still open in a tab); `DELETE` keeps counting; `layout.saved {rev, client}` announced to every copy
- [x] `lib/layout-sync.ts` `LayoutSync`: saves and takes in one queue; a refused save merged (`mergeLayouts`: this copy's room, pins and anchors on top of the newer layout) and sent again; another copy's save taken at once (`engine.adoptLayout`, no reheat) unless a change is waiting or the user drags; a check after a reconnect and when the page shows; `keepalive` for saves under 48 kB, so a reload no longer cancels one; a save without an answer sent again
- [x] Re-arrange saves the new arrangement like any other change (no `DELETE`)
- [x] Verification: `pnpm test` (server `layout-preview.test.ts`: counts, a stale and a base-less save refused, a copy's own saves on their way, `layout.saved` only for written saves, a reset that keeps counting; web `layout-sync.test.ts`: a spread reaching the idle copy, a missed save merged, a waiting change and a drag holding a take off, `leave` with keepalive, a resend after no answer, `mergeLayouts`; `layout.test.ts`: `adopt`, `takeFresh`) · `pnpm typecheck` · two copies of the app in one browser against a test server with the HTTP fallback forced (the deployment's path), real input: idle copies sent no save in a minute, a spread reached the other copy, a reload 300 ms after a spread kept every room, an offline copy's gather merged with the other copy's spread

*Done when:* a spread, a gather or a drag stays after a refresh however many copies of the app are open, every open copy shows it, and none writes an older map back; all checks above pass; STATUS updated. (Verified 2026-11-02 on a test server and on the deployment.)

### Phase 27 — What the engines say while they wait
The user's report (2026-11-02): the ChatGPT engine "gives an error", and the Claude engine sits for minutes before the usage page shows anything, with no way to tell which part waits. Spec: `BRAIN-ENGINES.md` (contract `notice`, `claude-cli` "Environment", "Startup latency", "Stalls", `codex-cli` stream mapping and "Verification state"), `ARCHITECTURE.md` ("Diagnostics", `brain.done`), `DECISIONS.md` 2026-11-02.
- [x] Codex checked against the real CLI (0.166.0 in a scratch directory): flags and shapes hold; its retries and warnings arrive as `error` lines and items and the turn goes on — they are `notice` events now, the exit reason is the last notice, nothing is pasted into the reply
- [x] Claude Code's `api_retry` lines are `notice` events ("API retry 3/10 (HTTP 529 …) · next try in 8 s"); the chat shows the latest notice next to "thinking", the server logs it
- [x] The spawned `claude` runs with the headless defaults (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, no auto-update, telemetry, error reports) and keeps the user's own `CLAUDE_CODE_*` settings
- [x] Every run measures itself: `timing` on `brain.done`, logged, `SLOW-<run>` in Diagnostics past 20 s to the first event or the first output
- [x] The stall watchdog: a run whose engine sends nothing for 15 minutes is stopped with that reason, so the queue never hangs
- [x] Verification: `pnpm test` 241/241 (new: Codex notices and `lastNotice`, the `api_retry` notice, the kept settings and headless defaults, the runner's `timing` and a stalled run), `pnpm typecheck` clean
- [ ] The user's pass on the deployment (STATUS "Next up" 1): one Codex run, one Claude run, then Settings → Diagnostics and the container log for `brain run finished` times

*Done when:* a Codex run on a flaky network ends with its reply and no error, a waiting Claude run says what it waits for, and a slow run's times are in Diagnostics and the log; STATUS updated.

### Phase 28 — Take everything out, bring it in elsewhere
The user's request (2026-11-02): an option to export and import all the data, then a full export from the deployment brought into the copy on their Mac (its data erased first) with the new version. Spec: `ARCHITECTURE.md` "Backup" and the routes; `VAULT-SPEC.md` `.synapse/backups/`; `UI-DESIGN.md` Settings; decision of 2026-11-02.
- [x] Server: `backup.ts` (`buildExport`, `readExport` with the path and size limits, `writeImport`, `keepSafetyCopy`), `routes/backup.ts` (`GET /api/export`, `POST /api/import` with `?check=1`), `VaultService.replaceAll` (erase uses it too), `SuggestionsStore.forget`; fflate
- [x] Web: Settings → **Backup and move** (`BackupCard`: download, choose a file, the confirmation with what it holds, replace, plain refusals), `api.exportAll` / `api.importAll`, 13 strings in fa and en
- [x] Verification: `pnpm test` (server `backup.test.ts`: the export's contents and absent secrets, a check that changes nothing, a full import from another vault — items byte for byte, chats without engine sessions, the layout with its count going on and announced, preferences in and keys, account and a safety copy kept, the import commit —, refusals of non-exports and of paths outside the vault, `409` while busy) · `pnpm typecheck` · a test server with real input: Download everything (71 items), an item added after it, Bring in a backup through the file chooser, the confirmation («۷۱ مورد و ۰ گفتگو»), Replace everything (the added item gone, the import commit), a non-zip refused
- [x] The deployment's data exported with the new option and brought into the Mac copy on the updated version (Replace everything takes the copy's old data out, keeping it in `.synapse/backups/`)

*Done when:* everything the owner put in can be downloaded as one file and brought into another Synapse, replacing what is there, without carrying a secret; all checks above pass; STATUS updated. (Verified 2026-11-02 on a test server and with the deployment's data.)

### Phase 29 — The brain on this Mac, a voice, an app
The user's request (2026-11-02): on the Mac copy, the brain should be Claude Code or the ChatGPT app (Codex) the Mac is signed in to, picked in Settings with its model and effort; speaking instead of typing if it can be done; and Synapse as an app installed on the Mac. Spec: `BRAIN-ENGINES.md` "On a desktop"; `UI-DESIGN.md` Composer (Voice) and Settings; `DEPLOY.md` "On a Mac"; decision of 2026-11-02.
- [x] Engines: Codex found inside the ChatGPT app, Claude Code inside the Claude app (`desktop-apps.ts`); probes report `via` and `account`; Codex's models and each model's efforts from `codex debug models` (`parseCodexCatalog`, `ModelOption.efforts` / `defaultEffort`)
- [x] Server: `GET /api/engines` says `place` (`desktop` / `server`)
- [x] Web: Settings → Brain on a desktop (`DesktopEngineCard`: app, account, version, model, the model's efforts in Persian words, Use this engine, no Sign out; API engines folded), the chat's picker with per-model efforts (`lib/efforts.ts`), engine defaults read again after a change (the picker had kept the old ones until a reload)
- [x] Voice: `MicButton` in the composer and the tell bar (`lib/dictation.ts`, the browser's speech recognition in fa-IR / en-US)
- [x] The Mac app: `pnpm mac:app` (`scripts/mac-app.mts`) makes `Synapse.app` (icon from `icon.svg`, ad-hoc signed) that starts the server and opens Chrome's app window
- [x] Test teardowns stop the vault before removing it (six suites failed now and then with ENOTEMPTY under load)
- [x] Verification: `pnpm test` (brain `desktop-apps.test.ts`; web `dictation-efforts.test.ts`) twice in a row, `pnpm typecheck`; with this Mac's real CLIs: both probed from a bare environment (Codex 0.165 via the ChatGPT app, 8 models; Claude Code 2.1.276 signed in as the owner, Max), the same question answered by each through the API, and in the browser Codex picked by a click, GPT-6-Luna with «کم» set, the picker showing them, a question sent from the composer answered by Codex
- [x] The app keeps the server in the architecture its dependencies were installed for (`LSArchitecturePriority`, an `arch` re-exec at the top of the launcher): opened from Finder the launcher had started under Rosetta, node with it, and tsx's esbuild (installed for arm64) refused to run
- [x] The owner's Mac app: installed from this version with the Mac copy's data, opened, the brain answering there (Claude Code and Codex each answered a question in it)

*Done when:* on the Mac the owner picks Claude Code or ChatGPT (Codex) with its model and effort in Settings and both answer, can speak instead of typing, and opens Synapse as an app; all checks above pass; STATUS updated.

### Phase 30 — A real Mac app
The user's request (2026-11-02): the launcher "is not an app — it looks like Chrome, it suddenly closes, and when I minimize it, it is gone and I have to open it again"; make it a real app like the ones that come as a DMG. Asked about voice: speech in Persian has no service inside a real app, so the user chose "no voice in the app for now". Spec: `ARCHITECTURE.md` "Desktop app"; `DEPLOY.md` "On a Mac"; decision of 2026-11-02.
- [x] `apps/desktop`: Electron 44 main process (`src/main.ts`: the server in a utility process, its restart, one window that hides on close, single instance, start page, quit that asks only while the brain works, links to the browser, permissions), preload (`synapseDesktop`), pure parts in `src/shell.ts` (login-shell PATH, the server's environment, restart delays, the link guard, the window's place) with `test/shell.test.ts`, fa/en words in `src/strings.ts`
- [x] Packing: `scripts/stage.ts` (the server bundled by esbuild with every dependency, the web UI, the template, the start page), `scripts/icon.ts` (icns), `scripts/dist.ts` (electron-builder: arm64 DMG, ad-hoc signed, no `node_modules`, no Electron demo app); `pnpm mac:dmg`; the Chrome launcher (`scripts/mac-app.mts`, `pnpm mac:app`) removed; `.dockerignore` keeps the app out of the image
- [x] Web: the microphone hides in the app (`recognitionCtor` reads `synapseDesktop.speech`)
- [x] Verification: the bundled server alone on a scratch vault; the packed app on scratch data from a bare environment (as Finder starts it), driven through its inspector: the window shows the app, the microphone is hidden, closing hides the window while the server stays, activate and a second launch bring it back, minimize and restore, a crashed page and a killed server come back by themselves, the page reconnects, Quit stops everything, a taken port shows the start page and Try again opens the app once it is free, Claude Code answers inside the app; installed from the DMG into /Applications with the owner's data (186 items, both engines signed in, Codex answering, one instance on a second open)

*Done when:* the owner opens Synapse from Applications or the Dock as a Mac app with its own window and icon, it survives minimizing, closing and crashes, and the brain answers in it; all checks above pass; STATUS updated.

### Phase 31 — The spread stays, the brain shows its work, one conversation, one language
The user's reports (2026-11-02): spreads sprang back after closing and reopening the app; the electric pulses no longer showed while the brain read or wrote; leaving the map's conversation for another page started a new one; the brain sometimes answered in English; the map's answer card should move, resize and go back. Spec: ARCHITECTURE "Layout"; UI-DESIGN "Chat" (One conversation), "Mind map" (Tell bar), "Living graph" (The brain at work); BRAIN-ENGINES "Reply language"; decisions of 2026-11-02.
- [x] Layout: the view lays the map out only once the vault's data is there; a node not on the map keeps its saved place, pin and room in every save (`Layout` seeds; `adopt` refreshes them, re-arranging forgets them); reproduced first (spread, 3D, names, quit with the server stopped at once, reopen: the spread was gone and saved over) and passing after; the Mac app stops its server only after the window closed (`will-quit`)
- [x] Signals: `touchedBy` reads Codex's `command_execution` (vault paths in the command, quoted ones whole; shell writes as writes) and `file_change`, and whole-vault searches light the core; web `TouchMap` signals a new item once it appears
- [x] One conversation: moving between pages keeps it, the device remembers it; the map's `MapChat` panel shows it (drag, resize from the end corner, back to its place, New conversation, Continue in chat, Hide), `lib/floating.ts`
- [x] Reply language: `packages/brain/src/language.ts` (the user's message decides; app-written prompts follow the UI), the runtime context line and the prompt's last line
- [x] Verification: `layout.test.ts` (3 new), `touched.test.ts` (3 new), `activity.test.ts`, `floating.test.ts`, `language.test.ts`, a runner test for the reminder; the reopen browser test; a browser test with a real Codex run on a scratch vault (the panel opens, 9 signals with reads and writes and one on the new item, a Persian reply, the conversation still there after the chat page, drag, resize, remembered across a reload, reset, New conversation)

*Done when:* the owner's spreads survive quitting and reopening the app, the brain's reads and writes light the map with either engine, the map's conversation goes on across pages and moves where they want it, and replies come in the language they wrote in; STATUS updated.

### Phase 32 — A full review that keeps everything current, on its own every day
The user's request (2026-11-02): one button, and a schedule, that goes over all the data and the map and brings it up to date — obsolete and finished things archived so later runs stop loading them, kept switched off in a corner of the map; structure and connections fixed; priorities, tasks, goals and progress updated; a missed day made up for when the Mac comes back on, then once a day; what needs action listed by category and in the brain's order of priority; a suggested plan every day. Spec: VAULT-SPEC "Finished vs. archived", "Index"; BRAIN-ENGINES "Modes"; ARCHITECTURE "Automation"; UI-DESIGN "Done and archived", "Coach"; decisions of 2026-11-02.
- [x] Retired: core `retired.ts` (`isRetired`: archived, dropped, or finished 30+ days ago), web mirror in `kinds/meta.ts`; index files list only live nodes plus a count, `index/archive.md` lists the retired ones; INDEX.md's recent list and areas skip them
- [x] The map's archive corner: retired items in `ARCHIVE_GROUP`, dim grey, past the bottom-left of every region, no links to live items; shown by default (hiding it is the filter)
- [x] `/review` skill (`SKILL.md`, `references/rules.md`, `references/focus.md`) and mode `review`; `memory/focus.md` served at `/api/memory/focus`; the vault's AGENTS.md names it and `index/archive.md`; `/daily` follows the focus and writes a suggested plan; descriptions trimmed so the always-loaded layer stays at 2493 tokens
- [x] Automation: `review` time; `dueRuns` catches up missed days once and runs the review before the daily plan
- [x] Coach Now: `FocusCard` (the focus list, questions, what changed, Full review, its daily time) and `ActionsByPlace` (by category, urgent first, priority then due); graph data carries task `priority`; reviews run in a chat of their own without changing the open conversation
- [x] Verification: unit tests (core retired and archive, automation catch-up, focus reader, actions, the archive corner); eval `review-fa`, `review-en`, and `daily-fa`, `capture-fa`, `ask-fa`, `advise-fa` for the trimmed descriptions (6/6; `review-fa` again with the reply and file language checks); a browser pass on a scratch vault (the Now cards, the archive corner past every region)

*Done when:* the owner presses Full review (or it runs on its own) and the vault comes back current — obsolete items in the archive corner and out of the brain's reading, priorities and progress updated, links added — with a focus list on the coach page and a daily plan that follows it; STATUS updated.

### Phase 33 — A page for every category and island
The user's request (2026-11-02): a clearer, minimal and friendly list of every category and island, each opening as a page of its own with sections to sort, see and manage what it holds, a summary and an analysis. Spec: UI-DESIGN "Places"; VAULT-SPEC `memory/places/`; ARCHITECTURE routes; BRAIN-ENGINES "Reply language"; decision of 2026-11-02.
- [x] `views/PlacesView.tsx` in place of `CategoriesView` (the sidebar's Categories & islands): the list — every space with its categories as tiles, a search, the other places — and a place's page: the hero (name and line in place, colour, move to the mind map or an island, delete, Add, Show on the map) and the tabs Overview · Categories · Items · Actions · Timeline · Analysis; `lib/places.ts` (spaces, members, stats, stale items, timeline, how long ago, the analysis helpers)
- [x] The analysis: `/insight [[Place]] → memory/places/<file>.md`, the format spelled out in the skill (`references/place.md` shows one); the app names the file (`GET /api/places/:id/analysis` → `{path, text}`, frontmatter dropped); the vault's AGENTS.md gives `memory/places/` to `/insight`; the reply-language line covers what the brain writes for the owner to read; In short on the overview (the first paragraph when the headings are missing); its own toast in every open copy; a chat of its own
- [x] Eval: a case's `display` makes its reply language the UI's, as on the server; `reply_language` and `wrote_language` checks
- [x] Verification: web `places.test.ts` (5), server `places.test.ts` (4); eval `place-fa`, `place-map-fa`, `insight-fa`, `review-fa` pass (`place-map-fa` failed once before the AGENTS.md line: the brain would not write a memory file the vault's rules did not name); a browser pass on a scratch vault with Haiku, twice: the list (3 spaces, 14 tiles), the prompt names the file, only the analysed place shows the run while another place's button waits, the toast and See, the analysis on its page and its overview, the open conversation untouched, an island's six tabs — the first pass wrote the analysis in English without the headings, the second (format in the skill, the wider language line) in the format and in Persian

*Done when:* the owner opens Categories & islands, finds every category and island in one list, opens any of them as a page with its summary, items, actions, timeline and the brain's analysis, and manages it there; STATUS updated.

### Phase 34 — Desktop authentication and encrypted storage
- [x] Password-wrapped macOS AES-256 encrypted volume; no server before authenticated unlock.
- [x] Optional Touch ID gate and Mac Keychain key wrapping, with an independent password fallback.
- [x] Verified migration and independent encrypted recovery backup before plaintext cleanup.
- [x] Lock on window close, screen lock, suspend, manual lock and quit; crash unmount watchdog; memory-only renderer session.
- [x] Scratch migration, wrong-password, sealed-read and reopen checks; crypto tamper and hidden-file verification tests.
- [x] Final packed-app UI verification, install, owner-created password and actual Touch ID verification.
- [x] Owner-data migration verified after activation: all 217 original node files unchanged, chat history byte-identical, recovery hash matches the recorded original; locked volume unmounted and server stopped.
- [x] Inventory of outside copies and vendor CLI transcripts (4 legacy copies, 11 Codex and 11 Claude session files).
- [x] Owner decision: protect only the current version for now; external legacy copies and old vendor sessions remain unchanged.
- [x] New protected CLI runs disable vendor transcript persistence and retain recent context from the encrypted vault; 305 tests and real synthetic turns with both engines pass.
- [x] Final unlock verification of installed desktop privacy update 0.2.1: owner Touch ID accepted, map and existing data visible; installed app, server and web bundles match the tested build.

*Done when:* the updated installed app requires authentication, the owner activates protection, their data survives verified migration, and the locked storage cannot be read as Markdown. Security boundary and recovery: ARCHITECTURE.md "Desktop protection (0.2)".


### Phase 35 — Touch ID-first entry
- [x] Redesign the lock screen around a fingerprint card with localized copy and password fallback.
- [x] Request Touch ID automatically once on launch or explicit reopening, without a cancellation loop or a prompt during manual lock/quit.
- [x] Desktop TypeScript and existing desktop protection/shell tests pass.
- [x] Install 0.2.2: automatic native request and owner entry verified, lock UI visually reviewed, password form and back navigation verified in an isolated preview; manual lock does not auto-prompt.

*Done when:* opening the enrolled Mac app shows the lock design and native Touch ID prompt automatically; password remains available after cancellation, and the encrypted vault is unchanged.

### Phase 36 — The protection, reviewed and made safe to live with
A review of Phases 34–35 (built by another agent, 2026-11-04) with five reviewers and a skeptic each, at the owner's request to fix everything found. Spec: ARCHITECTURE "Desktop app", "Desktop protection", "Automation"; BRAIN-ENGINES "Protected desktop CLI sessions"; decision of 2026-11-05.
- [x] The branch `security/desktop-protection` brought into `main` (fast-forward), not pushed
- [x] A lock waits for a running brain run (window closed, screen lock, sleep; Lock asks); the server's shutdown cancels and awaits the run (`BrainRunner.stopAll`); a cancelled scheduled run runs again; the first scheduled check waits three minutes after an unlock
- [x] Recovery key, password change, Touch ID off, the password every 14 days; the backup refreshed weekly on quit and opened by the new password and the recovery key
- [x] A disk that will not unmount: retries, Close by force, Quit anyway; unlock errors named on the lock page and kept in `shell.log`; `lockRequested` cleared; no second window during start; no automatic Touch ID when it cannot be used
- [x] Per-device choices survive a restart (persistent session, other storage cleared at lock); drafts in the vault (`/api/drafts`); an item's text being edited saved before a lock; the export asks first
- [x] Fuses off in the owner's build; the server environment set in `serverEnv`; `SYNAPSE_PRIVATE_SESSIONS` read in `config.ts`; private history without later queued messages or failed replies
- [x] Verification: unit tests (stop and retry, automation retry, drafts route, private history edges, shell helpers), typecheck; the packed app not driven (fuses off)

*Done when:* closing the window or locking never cuts the brain or loses typing, a forgotten password has a way back, and the app remembers this device's choices across restarts.

### Phase 37 — Light theme, a quiet guide, places from the whole to the parts, a tidier map
The owner's requests (2026-11-05): a light mode with suitable colours; a guide that is not crowded — what needs attention, the system's priorities, its questions, what to handle by category — with the inbox, the plan and "me" as their own menus and the inbox explained; categories and islands as name-only cards that open into a minimal hero and the place from the whole to its parts, with a tab of what needs attention, ticks only where they mean something; finished work off the map's categories, and a way to set aside by hand what has no tick. Spec: UI-DESIGN "Shell", "Guide", "Plan", "Inbox", "Me", "Places", "Done and archived", "Light theme"; decisions of 2026-11-05.
- [x] Light theme: CSS channels, `lib/theme.ts`, the map's `setTheme` (`forLight`, `GLOW_OUT`, no bloom or stars), the palette, the Mac window and pages, the switch in the sidebar and on the phone
- [x] `views/GuideView.tsx`, `PlanView.tsx`, `MeView.tsx`, the inbox page with its explanation; `components/ActCheck.tsx`; the sidebar's seven pages
- [x] `views/PlacesView.tsx` rewritten: name cards; hero; Everything (`lib/places.ts` `treeOf`), Needs attention, Analysis
- [x] Finished items to the archive corner (`kinds/meta.ts` `inArchiveCorner`); **Archive (off the map)** / **Back on the map**
- [x] Verification: unit tests (`treeOf`, the map model's archive corner), typecheck; screenshots in both themes of the map, guide, plan, inbox, me, places and a category and an island

*Done when:* the owner switches to light and everything reads well, the guide shows four clear things, a place reads from the whole to its parts, and done work no longer crowds the map.


### Phase 38 — Readable in both themes, a 24-hour clock, goals with their work, a place's own map
The owner's requests (2026-11-05): some text was unreadable in light mode (a project's next step in white) — check every page in both themes; the whole app on a 24-hour clock, no AM/PM; a page of its own for goals, each with the work that serves it, ticked there; and in each category and island a tab with a graph like the mind map holding only that place's items. Spec: UI-DESIGN "Type" (Clock), "Goals", "Places", "Light theme"; decision of 2026-11-05.
- [x] Light-theme fixes: Markdown bold and link hover, forced map labels, urgent and priority chips, the fix box, streak counts, switches; card titles in an item's or a place's own colour darkened on light (`CardTitle` `is-tinted`), icons of place cards
- [x] 24-hour clock: `fmtDate` `hourCycle: 'h23'`, `components/TimeField.tsx` in the guide and the plan, the brain's runtime context; `sep()` for facts in one line (the chat list read «۲ پیام · ۹:۲۹» as «۲۰»)
- [x] `views/GoalsView.tsx` + `lib/goals.ts` `goalPlans` (with tests), the sidebar's Goals
- [x] `components/PlaceGraph.tsx`: a place's Map tab
- [x] Verification: typecheck, unit tests, screenshots of every page in both themes (plan, goals, guide, inbox, me, chat, settings, a place's map, the map with an item open, the add dialog)

*Done when:* every page reads well in light and dark, no time shows AM/PM, each goal shows and ticks its own work, and a place's Map tab shows only that place.

### Phase 39 — Open source
The owner's request (2026-11-05): publish Synapse as open source for everyone, in a new repository with none of the owner's personal data, with a README in English and Persian that draws people in, informed by how similar projects present themselves. Decision of 2026-11-05.
- [x] Research: READMEs and community files of Logseq, AFFiNE, AppFlowy, Joplin, Anytype, SiYuan, Khoj, Reor, Obsidian, Trilium, Mem0, Open WebUI; GitHub's RTL rendering (`<div dir="rtl">`, `dir="auto"` on paragraphs)
- [x] `README.md` (English) and `README.fa.md` (Persian, with a guide for users in Iran); screenshots of the fictional sample vault in `docs/images/`
- [x] `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, bilingual issue forms and a pull request template in `.github/`
- [x] Personal data removed from tracked files (a test's owner name, a lesson's time zone, the license holder is the GitHub account); the public repository starts from one commit, with a public `docs/STATUS.md`
- [x] `Mahdi-Ai-Agent/synapse-os` created, public, with description, topics, Discussions and private vulnerability reporting

*Done when:* the public repository renders both READMEs correctly, holds no personal data or secrets in its files or history, and builds and tests from a fresh clone.

## Out of scope (for now)
Sync service, multi-user, cloud hosting, spatial canvas (JSON Canvas), embeddings before an API-key engine exists.

## Risks
- `claude -p` startup latency (user hooks/plugins load): measure; `--strict-mcp-config` skips MCP; consider `--settings` to disable plugins.
- Nested spawning from a Claude Code dev session: strip `CLAUDECODE*`/`CLAUDE_CODE_*` env vars (see BRAIN-ENGINES.md).
- RTL labels on canvas/WebGL: verify in Phase 1; fall back to HTML labels (3D) / `ctx.direction = 'rtl'` (2D).
- ToS: personal use is fine; public distribution must follow Anthropic's "preinstalled Claude Code" conditions. Synapse never handles credentials.
- Vault growth: index tiers by type; add per-area sub-indexes before `INDEX.md` exceeds ~1.5k tokens.
