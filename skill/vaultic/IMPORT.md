# vaultic — Import existing .env files (agent-driven)

You (the AI agent) follow this when the user wants to move secrets that already live in `.env` files
into the vault — "import my .envs", "put these secrets in the vault", "migrate this project to
vaultic". One Infisical **project per repo**; one Infisical **environment per .env variant**
(`.env`→`prod`, `.env.development`→`dev`, `.env.local`→`dev`).

## The hard rule of importing
**A secret VALUE must never enter your context.** You do NOT open the `.env` and read it. You drive
an import loop that reads each line and pipes the value straight into `vaultic set` — the value goes
file → CLI → vault, never file → you. Your tools only ever see KEY NAMES and `OK`/`FAILED`. If you
ever find a raw value in your context, you did it wrong — stop and redo via the loop.

## Step 0 — Inventory (names only, never values)
Find the `.env` files and list their KEY NAMES without values — `grep` for the `KEY=` prefix only:
```
grep -hoE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' "$f" \
  | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//; s/=$//' | sort -u
```
Split the keys into **secrets** (import these) vs **public config** (leave them; they're not
secrets):
- **Skip (public/config):** anything prefixed `VITE_` or `NEXT_PUBLIC_` (compiled into client JS),
  plus `NODE_ENV`, `PORT`, `*_HOST`, `*_PORT`, `*_ENDPOINT`, `*_USE_SSL`, `*_API_VERSION`, feature
  flags like `*_DEBUG_MODE`. Putting these in a vault is noise.
- **Import (real secrets):** API keys/secrets, `*_PASSWORD`, `*_SECRET`, `*_TOKEN`, `JWT_*`,
  `DATABASE_URL`/`REDIS_URL` (they embed credentials), private keys, webhook tokens.
Show the user the split and which project each `.env` maps to before importing.

## Step 1 — Get a provisioning token (creating projects needs admin)
The `vaultic-broker` machine identity is org `no-access` by design — it can read/write secrets in
projects it's a member of, but it **cannot create projects**. To open a new project you need an
admin (user) token:
- If the instance was just bootstrapped and you still hold the bootstrap token, use it.
- Otherwise the admin logs in through the UI (Infisical login is SRP, not a plain POST). With a
  browser tool: open `<SITE_URL>/login`, fill email+password, submit, save `storageState`, read the
  `jid` cookie, then `POST /api/v1/auth/token` with `Cookie: jid=...` for a fresh admin JWT.
- For repeated/unattended imports, create a dedicated **admin machine identity** once (org role that
  can create projects) and store its Universal Auth credentials — then skip the browser dance.

## Step 2 — Per project: create it and grant the broker access
With `Authorization: Bearer <adminToken>` (re-check idempotency: skip if the project already exists):
1. `POST /api/v1/projects` `{projectName:"<repo>"}` → `project.id` (default envs `dev`/`staging`/`prod` are created).
2. `POST /api/v1/projects/{projectId}/identity-memberships/{brokerIdentityId}` `{role:"member"}`
   (so the broker — and thus the AI at runtime — can resolve these secrets).
3. `vaultic link <ws>/<repo> <projectId>` on the client machine.

## Step 3 — Value-blind import loop
Read the `.env`, pipe each value into `vaultic set`, print only the key + result. The value is never
echoed, never in argv — it lives only in the loop's `$val` and goes straight to the CLI's stdin:
```sh
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in ''|\#*) continue;; esac
  [ "${line#*=}" = "$line" ] && continue
  key="${line%%=*}"; val="${line#*=}"
  key="$(printf '%s' "$key" | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//; s/[[:space:]]*$//')"
  val="${val#\"}"; val="${val%\"}"; val="${val#\'}"; val="${val%\'}"   # strip one layer of quotes
  case "$key" in <SKIP_PATTERN>) continue;; esac                        # skip public/config keys
  printf '%s\n' "$val" | vaultic set "vault://<ws>/<repo>/prod/$key" >/dev/null 2>&1 \
    && echo "  $key: OK" || echo "  $key: FAILED"
  unset val
done < "$ENV_FILE"
```
`vaultic set` also fingerprints each value, so the PreToolUse hook will block it if it ever
reappears in a tool call. Never widen this loop to print `$val`.

## Step 4 — Write the manifest (references only)
Generate `.aiv.yaml` in the repo from the KEY NAMES (no values), mapping each imported key to its
`vault://` ref, and ensure `.env` is gitignored:
```
workspace: <ws>
project: <repo>
mode: standard
needs:
  <KEY>: vault://<ws>/<repo>/prod/<KEY>
  ...
```
Leave the original `.env` in place — don't delete it. The app keeps working off `.env`; the vault is
now the source of truth and the AI works off references. (Optionally the user later replaces `.env`
consumption with `vaultic run`.)

## Step 5 — Verify (no values)
- `vault_check` (or `cd <repo> && vaultic check`) → every imported key reports **present**.
- `vault_run -- sh <script>` echoing the vars → values come out `[vaultic:redacted]`.
  (CLI `vaultic run -- …` joins argv with spaces and breaks complex quoting — put the command in a
  small script file and run `vaultic run -- sh script.sh`. The MCP `vault_run` tool takes one
  command string and has no such issue.)

## Notes
- One identity membership per project. The broker reads only projects it's been added to — adding a
  project does not expose the others.
- Customer/shared repos: confirm with the user before importing; prefer starting with personal repos.
- `.aiv.yaml` is safe to commit (references only, no values). `.env` must stay gitignored.
