# vaultic — First-run setup playbook (agent-driven)

You (the AI agent) follow this when vaultic is installed but not yet wired to a backend —
i.e. the user says "set up vaultic / connect the vault", or `vault_check` reports the broker is
not configured, or `~/.config/vaultic/config.json` has no `siteUrl`/linked project.

**You run the setup yourself.** Do not hand the user a list of commands to paste. If you have shell
/ SSH access, execute every step. The only things the human does are: pick where it goes, type
secret VALUES at a hidden prompt, and the one-time account choices you cannot make for them
(email/password for the admin account, DNS A record at their registrar). Everything else is yours.

## Invariants (never violate)
- A secret VALUE never reaches your context, a log, an `echo`, a command's argv, or a commit.
  Generate backend secrets *on the target* with `openssl`; pipe credential values through stdin.
- `.env` and `~/.config/vaultic/credentials.json` are mode `0600`; their dirs `0700`.
- Fail-closed: check every API response; on the first hard error, stop and report — do not limp on.
- Idempotent: re-running must detect an existing dir / identity / link and skip, not duplicate.
- The PreToolUse hook blocks any command that references `~/.config/vaultic` — never read/edit that
  store directly. Use the `vaultic` CLI (it writes the store for you).

## Step 0 — Ask where the backend goes
Ask the user (batch the questions):
1. **Target host** — this machine, or a remote server over SSH? If remote, get the SSH host/alias
   and verify with `ssh -o BatchMode=yes <host> true`.
2. **Public URL** — a domain they'll point at it (e.g. `vault.example.com`), or none (localhost /
   SSH-tunnel only). If a domain, they own the DNS.

Define a `run()` indirection for the rest: local target → run the command locally; remote → wrap it
in `ssh <host> '<cmd>'`. Same step list either way.

## Step 1 — Preconditions
On the target: `docker` + `docker compose` present. Locally: `curl`, `jq`, `openssl`, and the
`vaultic` CLI on PATH (the client install from `install.sh`). Missing → stop with a clear message.

## Step 2 — Deploy the Infisical backend
- Pick an install dir: remote default `/opt/vaultic`, local default `~/.config/vaultic/infisical`.
  If it already holds a running stack, skip to Step 3.
- Download the **official** compose + env, never vendor them:
  ```
  curl -fsSLO https://raw.githubusercontent.com/Infisical/infisical/main/docker-compose.prod.yml
  curl -fsSL  https://raw.githubusercontent.com/Infisical/infisical/main/.env.example -o .env
  ```
- **Pin the image** to the latest stable release, never `latest`:
  ```
  TAG=$(curl -fsSL https://api.github.com/repos/Infisical/infisical/releases?per_page=10 \
        | jq -r '[.[]|select(.prerelease==false)][0].tag_name')
  ```
  Replace `infisical/infisical:latest` with `infisical/infisical:$TAG` in the compose file.
  (Note: recent tags have **no** `-postgres` suffix — use the bare `vX.Y.Z`.)
- **Port**: the backend must bind localhost only. Find a free port (scan from 8085) and rewrite the
  published port `80:8080` → `127.0.0.1:<port>:8080`. If a reverse proxy already owns 80/443 (common
  on a shared box), this is mandatory; check with `ss -tlnp`.
- **Secrets, generated on the target, never printed**:
  ```
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 16)|" .env
  sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32)|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
  sed -i "s|^SITE_URL=.*|SITE_URL=<https://domain  OR  http://127.0.0.1:port>|" .env
  chmod 600 .env
  ```
  Leave SMTP blank for a single-user deploy. `ENCRYPTION_KEY` is unrecoverable if lost — tell the
  user at the end to back up `.env` together with the `pg_data` volume.
- `docker compose -f docker-compose.prod.yml up -d`, then poll `http://127.0.0.1:<port>/api/status`
  until HTTP 200 (first boot runs migrations — can take a minute).

## Step 3 — Reverse proxy + TLS (only if a domain was given AND the target has nginx + certbot)
If the target has no nginx/certbot, skip this: keep `SITE_URL=http://127.0.0.1:<port>` and tell the
user to put their own proxy/tunnel in front. Otherwise:
- **Temporary IP lock first.** A fresh cert hits Certificate Transparency logs within seconds and
  bots race to grab the "first signup = instance admin" slot. Before issuing the cert, restrict the
  vhost to the user's current public IP (`curl -s ifconfig.me`):
  `location / { allow <user_ip>; allow 127.0.0.1; deny all; proxy_pass http://127.0.0.1:<port>; ... }`
- Add `include snippets/deny-dotfiles.conf;` inside the `server {}` block (404s `.env`/dotfiles).
- `nginx -t && systemctl reload nginx`, then `certbot --nginx -d <domain> --redirect`.
- Remind the user to add the DNS **A record** `<domain> → <server IP>` at their registrar if it
  isn't resolving yet (you can't do this unless you have their DNS API).
- Leak test from off-box: `curl -sk https://<domain>/.env` must be **404**.

## Step 4 — Admin account + machine identity (bootstrap API)
Ask for the admin **email** and a **password** (password via hidden prompt; never echo it). Then:
```
BOOT=$(curl -s -X POST <SITE_URL>/api/v1/admin/bootstrap -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"...","organization":"<name>"}')
TOKEN=$(jq -r '.identity.credentials.token' <<<"$BOOT")   # admin API token
ORG_ID=$(jq -r '.organization.id' <<<"$BOOT")
```
With `Authorization: Bearer $TOKEN`, create the broker identity and a project:
1. `POST /api/v1/identities` `{name:"vaultic-broker", organizationId:$ORG_ID, role:"no-access"}` → `identity.id`
2. `POST /api/v1/auth/universal-auth/identities/{id}` `{}` → `identityUniversalAuth.clientId`
3. `POST /api/v1/auth/universal-auth/identities/{id}/client-secrets` `{description:"..."}` → `clientSecret` (capture, never print)
4. `POST /api/v1/projects` `{projectName:"<proj>"}` → `project.id`
5. `POST /api/v1/projects/{projectId}/identity-memberships/{identityId}` `{role:"member"}`
   (try `"developer"` first; if the response has no `identityMembership`, fall back to `"member"`)

**Fallback — "Instance has already been set up":** bootstrap only works once. If it returns that,
the admin must log in through the UI (Infisical login is SRP, not a plain POST). Two ways to get an
admin API token without the UI dance:
- If you can drive a browser (Playwright MCP): open `<SITE_URL>/login`, fill email+password, submit;
  save `storageState`, read the `jid` cookie, then `POST /api/v1/auth/token` with `Cookie: jid=...`
  to get a fresh JWT. Use that as the Bearer for steps 1–5.
- Otherwise ask the user to create the identity + project in the UI and paste `clientId`,
  `clientSecret` (hidden prompt), and `projectId`; skip to Step 6.

## Step 5 — Drop the IP lock
If you set the temporary `allow/deny` in Step 3, remove it now and `systemctl reload nginx`.
A single reload doesn't always propagate to workers — if an off-box request still 403s, reload
again and re-test after a second.

## Step 6 — Wire the local client
```
printf '%s\n' "$clientSecret" | vaultic login --site-url <SITE_URL> --client-id <clientId>
vaultic link <ws>/<proj> <projectId>
```
Optionally, in a project the user names: `vaultic init --workspace <ws> --project <proj>`.
Confirm the broker connects: `claude mcp list | grep vaultic` → should show **Connected**.

## Step 7 — End-to-end verification
Prove it works before declaring done:
- Set a throwaway: `printf '%s\n' 'sk-test-fake-0000' | vaultic set vault://<ws>/<proj>/prod/TEST_KEY`
- `vault_check` (or `vaultic check`) → `TEST_KEY present`.
- `vaultic run -- env | grep TEST_KEY` → value shows as `[vaultic:redacted]`, never the real string.
- Off-box `curl -sk https://<domain>/.env` → 404; backend port not reachable from outside.
Then delete the throwaway key if it was only a test.

## Step 8 — Hand back
Summarize: URL, install dir, pinned version, that secrets never touched the transcript, and the
**ENCRYPTION_KEY backup** reminder (`.env` + `pg_data` together; losing the key = losing all data).
