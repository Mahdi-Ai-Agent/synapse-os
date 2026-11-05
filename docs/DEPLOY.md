# Deploy Synapse on a server

One Docker image runs everything — the brain host, the web UI and your Claude Code CLI — with your vault in a volume. This guide uses [Coolify](https://coolify.io); plain Docker is at the end. The pieces are specified in `ARCHITECTURE.md` ("Access control", "Ports").

What you get: Synapse at `https://your.domain`, behind your own username and password, usable from your phone and every computer, for one user (you), with the vault at `/data/vault` in the volume and its full git history.

## 1. The brain

The image carries the Claude Code and Codex CLIs. You connect them after the first deploy, from **Settings → Brain** (step 4 below): **Sign in with your Claude subscription** opens Anthropic's page and takes the code it shows; **Sign in with your ChatGPT account** opens OpenAI's page and shows a code to type there. Each CLI keeps its sign-in in the volume. API keys (Anthropic, OpenAI, OpenRouter) are pasted on the same page.

Prefer to sign Claude Code in before the first open? On a machine where `claude` is signed in run `claude setup-token` and put the token it prints into `CLAUDE_CODE_OAUTH_TOKEN` (a secret); the CLI signs in with it and Synapse never reads it.

The server must be able to reach the vendors (claude.com and api.anthropic.com, auth.openai.com and chatgpt.com, openrouter.ai): a server in a region they do not serve cannot sign in, and Settings shows the CLI's own error.

## 2. Coolify

1. **New resource → Git repository**, this repository, branch `main`. Build pack: **Dockerfile** (the `Dockerfile` at the root, base directory `/`).
2. **Ports Exposes: `4317`.** Coolify fills in `3000` by default; left that way, the proxy talks to a port nothing listens on and every page is **502 Bad Gateway**.
3. **Persistent Storage → Add → Volume Mount**, destination path **`/data`**. Without it every redeploy starts again from an empty vault. Use a volume, not a host directory: the app runs as an unprivileged user that a root-owned host folder would lock out (the log then says so).
4. **Environment Variables** (optional; mark secrets as such):

   | Name | Value |
   |---|---|
   | `CLAUDE_CODE_OAUTH_TOKEN` | optional: the token from step 1, if you do not sign in from Settings |

   Everything else has a default in the image: `SYNAPSE_VAULT=/data/vault`, `SYNAPSE_HOST=0.0.0.0`, `SYNAPSE_PORT=4317`, `SYNAPSE_TRUST_LOOPBACK=false`, `HOME=/data/home` (the CLI keeps its state in the volume). Optional: `SYNAPSE_PAIR_TOKEN` (at least 32 characters of `A-Z a-z 0-9 _ -`) for pair links without a password; `SYNAPSE_PUBLIC_URL` (for example `https://your.domain`) when Settings → Connections shows another address than the one you open the app at.
5. **Domain:** your domain with HTTPS (Coolify's proxy issues the certificate). Never reach the app over plain HTTP from outside: the password travels in the request.
6. **Deploy.** The first build installs dependencies, builds the web UI and installs the Claude Code CLI; later deploys are faster. On its first start the container creates an empty vault and prints a **setup code**.

## 3. First open: your account

1. In Coolify open **Logs** and find the line with **`setup code`** (the "Find in logs" box helps): `no account yet: open Synapse and create one. setup code: XXXX-XXXX-XXXX`.
2. Open `https://your.domain`. Synapse shows **Create your account**: choose a username and a password (at least 8 characters), and type the setup code. The code proves you can see the server; without it anyone who found the address first could claim your Synapse.
3. That's it: this browser is signed in. Every other device (your phone, another computer) shows **Sign in** — the same username and password. On the phone, after signing in, **Add to Home Screen**.

4. **Settings → Brain:** press **Sign in with your Claude subscription**, open Anthropic's page, sign in, copy the code it shows and paste it back in Settings right away (it expires within minutes). For ChatGPT press **Sign in with your ChatGPT account**, open OpenAI's page and type the code Settings shows. Then choose the model and effort on each card and **Use this engine** on the one you want. For OpenRouter or another API, paste the key on its card.

## 4. Living with it

- **Account:** Settings → Account shows who is signed in, **Sign out**, and **Change password** (which signs every other device out).
- **Forgot the password:** Coolify → **Terminal** for the container: `rm /data/vault/.synapse/auth.json`, then **Restart**. The account setup comes back with a new setup code in the log. Your vault is untouched.
- **Updates:** redeploy from the repository; the vault lives in the volume and is untouched.
- **Backups:** the vault is a git repository at `/data/vault`. In Coolify's terminal: `cd /data/vault && git log --oneline | head`, or `tar czf /tmp/vault.tgz -C /data vault` and download it. It is plain Markdown; Obsidian opens a copy.
- **Erase everything:** Settings → Erase everything (a typed word). The vault starts again empty; the account, settings, pairing and connected apps stay.
- **Claude, ChatGPT and other AI apps:** Settings → Connections shows the address to add, `https://your.domain/mcp`, and the steps for each app. In Claude (web, desktop or phone): Settings → Connectors → Add custom connector. In ChatGPT (web, a paid plan): Settings → Apps & Connectors → Advanced settings → Developer mode, then Create with that address and OAuth. Either app opens your Synapse's sign-in page: sign in, choose whether it may also add and change items, and **Allow**. Connected apps are listed in Settings → Connections, where **Disconnect** ends one; changing the password ends them all. Their servers must reach your domain: a CDN or firewall in front of it must let `/mcp`, `/oauth/*` and `/.well-known/*` through without a browser challenge. A CDN that swaps error replies for its own page (ParsPack does, for all but a `Basic` 401) hides the 401's `WWW-Authenticate` header; the apps then find the sign-in through `/.well-known/oauth-protected-resource/mcp` instead (the official MCP client does).
- **Logs and health:** Coolify shows the container's log (`synapse server ready` is the line to look for). `GET /api/health` answers without signing in, for uptime checks and the image's own health check.

## On a Mac: an app

Synapse can be an app on your Mac instead of a server: `Synapse.app`, with its own window and Dock icon and the server inside it. The server starts and stops with the app. The brain is whatever Claude Code or the ChatGPT app on the Mac is signed in to (Settings → Brain), and nothing leaves the Mac except what the brain sends its vendor.

```bash
git clone https://github.com/Mahdi-Ai-Agent/synapse-os.git && cd synapse-os
pnpm install
pnpm mac:dmg     # → apps/desktop/release/Synapse-<version>-arm64.dmg (Apple silicon)
```

Open the DMG and drag Synapse to Applications. On first open, Synapse offers to make your vault (empty, or with sample data) in `~/Library/Application Support/Synapse/vault`; to bring your data in instead, use Settings → Backup and move. On first open, choose an app password and optionally enable Touch ID. Existing desktop data is copied and verified into encrypted storage with an independent encrypted recovery image before plaintext cleanup. Closing the window locks the data and stops the server (while the brain works, once its run ends); the Dock icon brings back the lock screen. ⌘Q quits the shell too. Write down the recovery key it shows once: with the password forgotten and Touch ID unavailable, only it opens the data. Choose light or dark at the foot of the sidebar. While unlocked, the log is `~/Library/Application Support/Synapse/private-volume/logs/server.log` (Help → Open the Server Log). The app is signed only ad hoc, on the Mac that built it; on another Mac, right-click → Open the first time. To update, build a new DMG and replace the app; your data stays where it is. The microphone is hidden in the app (ARCHITECTURE.md "Desktop app" → Voice); in Chrome it works as before.

## Plain Docker

```bash
CLAUDE_CODE_OAUTH_TOKEN=... docker compose up -d --build
docker compose logs synapse | grep "setup code"
```

`docker-compose.yml` publishes `4317` and keeps the vault in the `synapse-data` volume (the variable can also sit in a `.env` file next to it). Put a reverse proxy with HTTPS in front before you reach it from outside your machine.

## Notes

- This is a single-user instance: one account owns the vault. Sessions last 90 days from their last use; after eight wrong tries a device has to wait a quarter of an hour (forty in all, from anywhere, shut sign-in for everyone for that long).
- The brain runs your own subscription or key on your own server, for you; the vendor's terms apply as on your desktop. One instance is yours, not a shared service.
- The container runs as the unprivileged `node` user; everything it writes is under `/data`.
