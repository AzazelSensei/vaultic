# agent-vault — paranoid mode for vaultic

`agent-vault` is [Infisical's](https://infisical.com) open-source MITM credential proxy. It is a
**separate Go binary** that vaultic does not build or vendor — you install it yourself and vaultic
delegates to it.

## What paranoid mode does

Normally `vaultic run -- <cmd>` resolves the manifest secrets and injects them into the child's
**environment**. In paranoid mode (`vaultic run --paranoid -- <cmd>`) vaultic instead delegates to
`agent-vault run -- <cmd>`. agent-vault man-in-the-middles the child's outgoing HTTPS traffic and
**substitutes placeholders for the real secret at the network boundary**, so the live credential
never appears in the child's environment, argv, or memory — only an opaque placeholder does.

vaultic v1 simply **detects the binary and delegates**. If `agent-vault` is not on your `PATH`,
`vaultic run --paranoid` aborts and prints install instructions:

```
curl -sSL https://get.agent-vault.dev | sh
```

## Quick start

1. Install the binary (see above) and **pin v0.32.0**.
2. Copy `services.example.yaml`, fill in the hosts/headers/keys you need.
3. On the agent host: `vaultic run --paranoid -- <your-command>`.

---

## Verified constraints — read before you deploy

These are real limitations of the current agent-vault research preview. Treat each as a hard
warning, not a nice-to-have.

### Pin to v0.32.0

> agent-vault is a **research preview** and its **API is subject to change**.

Pin v0.32.0 explicitly. Do not float to `latest` — a minor bump can break the proxy config,
placeholder format, or CLI surface without notice.

### Agent and agent-vault MUST run on DIFFERENT hosts

> The agent and agent-vault **must run on different hosts**.

If the agent process runs on the **same machine** as agent-vault, the agent can read agent-vault's
SQLite database and its **DEK (data encryption key)** directly off disk — at which point the proxy
provides no protection at all.

**On a single local dev machine this security guarantee DROPS.** Running both on your laptop is fine
for trying out the workflow, but it is **not** a security boundary: a compromised child can recover
every secret. Only the split-host deployment delivers the actual guarantee.

### Proxy auth token travels in PLAINTEXT

> The proxy auth token travels in **plaintext** between the agent and the broker.

The proxy listens over `http://` — the TLS wrapping that earlier versions had was **removed in
v0.23.0**. The token authenticating the agent to the broker is therefore exposed to anyone on the
wire. **Deploy only on localhost, a VPN, or a private subnet.** Never expose the proxy port to a
public or shared network.

### The Infisical backend is FAIL-OPEN

> If Infisical is unreachable, agent-vault keeps serving the **last cached snapshot**.

This is fail-open, not fail-closed. A secret you **revoke** in Infisical can stay live for as long as
**(poll interval + cache lifetime)** because agent-vault keeps serving its cached copy until the next
successful poll. Keep the poll interval low:

```
--poll-interval-seconds 60
```

Lower poll interval = shorter window in which a revoked secret remains usable. Do not raise it.

### Placeholder format

Placeholders look like `__openai_api_key__`. Rules:

- minimum **4 characters**
- must contain `__` **or** at least one **non-alphanumeric** character
- only **RFC 3986 unreserved** characters (`A-Z a-z 0-9 - . _ ~`)

If a placeholder doesn't match these rules agent-vault won't substitute it.

### NO_PROXY default is narrow

The default `NO_PROXY` is just `localhost,127.0.0.1`. Consequences:

- Any **internal service the agent must reach** (your own APIs, internal registries, etc.) has to be
  **added to `NO_PROXY`** explicitly, or its traffic will be routed through the proxy.
- **netguard blocks RFC-1918 ranges by default** (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
- **Cloud metadata (`169.254.169.254`) is always blocked** and cannot be allowlisted — this is a
  hard SSRF guard.

### ALL of the child's traffic goes through the proxy

Not just the AI API calls. **`git clone`, background updaters, telemetry pings — everything the child
emits** is routed through the proxy. Any tool that does **not** read the proxy environment variables
(`HTTP_PROXY`/`HTTPS_PROXY`) will fail TLS verification unless agent-vault's **CA certificate is in
the system trust store**. Install the CA cert before running tools that bypass proxy env vars.

### agent-vault writes a Claude Code skill on first run

`agent-vault run` **auto-writes a Claude Code skill** to:

```
~/.claude/skills/agent-vault-cli/SKILL.md
```

This is a **surprise on immutable / sandboxed / read-only images** — the write either fails the run
or mutates a filesystem you expected to be frozen. Pre-create the path, make it writable, or account
for the write when building those images.

---

## Example service config

See [`services.example.yaml`](./services.example.yaml) in this directory. It maps three common
providers:

| service   | host                | auth type | header / key                         |
|-----------|---------------------|-----------|--------------------------------------|
| anthropic | `api.anthropic.com` | api-key   | header `x-api-key`, key `ANTHROPIC_API_KEY` |
| openai    | `api.openai.com`    | bearer    | key `OPENAI_API_KEY`                 |
| github    | `api.github.com`    | bearer    | key `GITHUB_TOKEN`                   |
