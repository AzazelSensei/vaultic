# Infisical self-host — vaultic backend deploy

> Türkçe özet: vaultic'in secret backend'i kendi sunucunda barındırılan
> [Infisical](https://infisical.com) Community Edition'dır. Resmi compose dosyasını upstream'den
> indir, `.env`'i doldur, ayağa kaldır, sonra vaultic'in bağlanacağı bir **machine identity** oluştur.

vaultic stores and resolves secrets through an [Infisical](https://infisical.com) instance. This
directory documents how to self-host that backend with the **official** Infisical
`docker-compose.prod.yml`.

We do **not** vendor a copy of the compose file — it would go stale and drift from upstream. You
download the current one at install time (see below). This repo only ships the
[`.env.example`](./.env.example) **subset** that vaultic cares about.

> This is the **Infisical backend** doc. For paranoid-mode MITM proxy deployment see
> [`agent-vault/README.md`](./agent-vault/README.md) — a separate, unrelated component.

> **Prefer to let the agent do it?** The vaultic skill ships an agent-driven setup playbook —
> [`skill/vaultic/SETUP.md`](../skill/vaultic/SETUP.md). With the skill installed, tell your AI
> agent to "set up vaultic" and it runs every step below itself (asks where to deploy, generates
> secrets on the target, wires the machine identity and local client), never asking you to paste
> commands. The steps here are the manual reference the playbook automates.

---

## 1. Bring up the backend

```bash
cd deploy
curl -fsSLO https://raw.githubusercontent.com/Infisical/infisical/main/docker-compose.prod.yml
curl -fsSL  https://raw.githubusercontent.com/Infisical/infisical/main/.env.example -o .env

# Fill .env (see ./.env.example in THIS repo for the vaultic-relevant subset):
#   ENCRYPTION_KEY=$(openssl rand -hex 16)    # CANNOT be changed later — losing it = losing
#                                             # all secrets. BACK IT UP.
#   AUTH_SECRET=$(openssl rand -base64 32)
#   SITE_URL=https://vault.example.com        # local: http://localhost:80

# Pin the image: in docker-compose.prod.yml change `infisical/infisical:latest`
# to infisical/infisical:<specific-version>. Do NOT run 'latest'.

docker compose -f docker-compose.prod.yml up -d
```

The backend publishes on **host port 80** (internal 8080). With the default `SITE_URL` the UI is at
`http://localhost:80`.

---

## 2. Read before you deploy — verified warnings

These are real, confirmed behaviors. Treat each as a hard warning.

### First signup becomes the instance administrator

The **first person to sign up** at the instance is made the **instance administrator**. If the
instance is reachable from the internet, register **immediately** after first boot — or firewall it
off until you have — so an outsider cannot claim admin before you do.

### ENCRYPTION_KEY loss = permanent data loss

If you lose `ENCRYPTION_KEY`, **all encrypted secret data is unrecoverable**. There is no recovery
path. Back up **`.env` and the Postgres volume together** — the key in `.env` and the ciphertext in
the `pg_data` volume are useless without each other.

### SMTP is required for invites / email verification

`SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM_ADDRESS` / `SMTP_FROM_NAME`
are needed for **user invites and email verification** — the team scenario. A **single-user** deploy
can skip SMTP entirely.

### Self-host Community Edition limits

- Community Edition (self-host) has **NO user / project / identity limits**. The 5-identity and
  3-project caps are **Cloud free-tier only** — they do not apply here.
- **Pro** is required (even on self-host) for **RBAC custom roles**, **secret versioning**, and
  **secret rotation**.
- **Approval workflows** require **Enterprise** — but vaultic implements its **own** approval layer
  (the broker), so you do **not** need Infisical's.

---

## 3. Create the machine identity vaultic uses

vaultic connects as a **machine identity**, never as a human user. Set one up:

1. **Org Settings → Access Control → Identities → Create identity.** Name it e.g.
   `vaultic-broker`, with **org role `no-access`**.
2. On the identity, the auth method is **Universal Auth** (the default). Set the **Access Token TTL**
   (or an **Access Token Period** if you want renewable tokens), **Max TTL**, and **Max Uses** as
   you see fit.
3. **Create Client Secret** → copy the **`clientId`** and **`clientSecret`**. The secret is shown
   **once** — store it now.
4. In the **target project**: **Project Settings → Access Control → Machine Identities → Add
   identity** → assign a **project role** (e.g. **Developer** for read+write, **Viewer** for
   read-only). Without this project membership the identity can read **nothing** — its org role is
   `no-access` by design.
5. Point vaultic at it:

   ```bash
   vaultic login --site-url <SITE_URL> --client-id <clientId>
   # paste clientSecret at the hidden prompt

   vaultic link <ws>/<proj> <projectId>
   # projectId comes from the project URL / Project Settings
   ```

---

## 4. Post-deploy security check

These match the standard server hardening rules — run them after every internet-facing deploy.

- **No dotfile leak.** `.env` (and any dotfile) must not be served:

  ```bash
  curl -sk https://HOST/.env    # must return 404
  ```

  If this returns the file contents, your reverse proxy / docroot is leaking credentials — fix it
  before going further.
- **Credentials stay out of the web docroot.** Keep `.env` and the project directory **separate**
  from whatever the web server serves. A secret backend's `.env` must never live under a public
  document root.
