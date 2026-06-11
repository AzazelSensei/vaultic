# vaultic — AI credentials vault

> Türkçe özet: AI kodlama ajanlarının secret değerini hiç görmediği, self-host edilebilir bir kasa.
> Ajan yalnızca `vault://` referanslarıyla çalışır; gerçek değer çalıştırma anında enjekte edilir,
> istisnai erişim Touch ID / Telegram onayına ve audit kaydına bağlıdır.

vaultic is a self-hostable credentials vault built for one constraint: **the AI agent never holds
the secret value.** The agent works with `vault://workspace/project/env/KEY` references; real values
are injected into a child process environment at execution time (`vault_run`), or into outgoing
HTTPS requests at the network boundary (paranoid mode). The one escape hatch — a one-time reveal —
requires explicit human approval (Touch ID or Telegram) and is audited.

## Why

AI coding agents leak secrets, measurably:

- GitGuardian's *State of Secrets Sprawl 2026* found **29 million new hardcoded secrets** on public
  GitHub in 2025 — up **34% year over year**.
- The same report found **24,008 secrets inside MCP config files**, of which **2,117 were verified
  live** at the time of scanning.
- Commits **co-authored by AI leak secrets at roughly 2x the baseline** rate of human-only commits.
- Claude Code was shown (April 2026, Martin Paul Eve / Knostic) to **read `.env` files despite a
  `permissions.deny` rule** and carry their contents into model context.

The common thread: once a raw value enters the agent's context, you have lost control of it — it can
end up in a transcript, a telemetry pipeline, a generated file, or a commit. vaultic's answer is to
keep the value out of the agent's reach entirely: the AI sees references and redacted output, never
the value itself.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  AI hosts: Claude Code · Codex · any MCP host        │
│  (work with vault:// references, never raw values)   │
└──────────────────────────┬───────────────────────────┘
                           │ MCP (stdio)
                           ▼
┌──────────────────────────────────────────────────────┐
│  vaultic-broker (MCP server, TypeScript)             │
│  fail-closed · never returns a value by default      │
└────────┬─────────────────┬─────────────────┬─────────┘
         │                 │                 │
         ▼                 ▼                 ▼
   vault_run         agent-vault proxy   approval flow
   (env inject,      (paranoid mode:     (Touch ID local /
    redacted          placeholder +       Telegram remote)
    output)           HTTPS MITM)         + audit.jsonl
         │                 │
         ▼                 ▼
┌─────────────────┐  ┌────────────────────────┐
│  Infisical CE   │  │  Target APIs           │
│  (self-hosted)  │  │  (OpenAI, AWS, ...)    │
└─────────────────┘  └────────────────────────┘
```

**Infisical CE** is the storage backend: a self-hosted, MIT-core secrets manager providing
workspaces, default-private projects, environments, machine identities, and its own audit log.
vaultic connects to it with a project-scoped machine identity, never as a human user. Deployment
guide: [`deploy/README.md`](deploy/README.md).

**vaultic-broker** is the only gate between AI hosts and the vault — an MCP server (stdio) exposing
six tools, none of which returns a secret value except the human-approved one-time reveal. It is
fail-closed: if the backend is unreachable, no value is served from any cache or fallback; the agent
gets an actionable error instead.

**vault_run / `vaultic run`** resolves the `.aiv.yaml` manifest, injects the values into the child
process environment, executes the command, and redacts every injected value from the captured
output before the agent sees it.

**agent-vault proxy (paranoid mode)** replaces env injection entirely: the child only ever sees
opaque placeholders, and Infisical's open-source MITM proxy substitutes the real credential into
outgoing HTTPS requests at the network boundary, with egress filtering. Constraints and deployment:
[`deploy/agent-vault/README.md`](deploy/agent-vault/README.md).

**Approval + audit**: a reveal request triggers Touch ID locally (macOS, via a small Swift helper —
[`helpers/touchid/README.md`](helpers/touchid/README.md)) or a Telegram bot message remotely.
Approval yields the value exactly once; every request, decision, and `vault_run` invocation is
appended to `~/.config/vaultic/audit.jsonl`.

**vaultic CLI** is the human side: `login`, `link`, `init`, `check`, `set`, `share`, `run`. Secret
values are only ever entered by a human at a hidden terminal prompt (`vaultic set`).

**Hooks + skill** wire the discipline into Claude Code (and Codex): a SessionStart hook announces
the manifest status, a PreToolUse hook blocks tool calls containing known secret values
(salted-hash fingerprints) or secret-shaped strings (regex), and the
[`skill/vaultic/SKILL.md`](skill/vaultic/SKILL.md) skill teaches the agent the reference-only
workflow.

## Quick start

```bash
# 1. Install: builds packages, symlinks the CLI, registers hooks + skill + MCP server
./install.sh            # add --dry-run to preview

# 2. Deploy the Infisical CE backend (docker compose) — see deploy/README.md
#    First signup becomes instance admin; back up ENCRYPTION_KEY.

# 3. Create a machine identity (Universal Auth) and add it to your project
#    — see deploy/README.md section 3.

# 4. Connect vaultic to it
vaultic login --site-url https://vault.example.com --client-id <clientId>
vaultic link <workspace>/<project> <projectId>

# 5. In your repo: create the manifest and store a secret
vaultic init
vaultic set vault://<workspace>/<project>/prod/OPENAI_API_KEY
```

From Claude Code (or any MCP host), the broker exposes six tools:

- `vault_check` — report which manifest secrets exist / are missing. No values.
- `vault_list` — list secret names + metadata in a scope. No values.
- `vault_ref` — build a `vault://` reference string for code/config. No values.
- `vault_run` — run a command with secrets injected into the child env; output redacted.
- `vault_reveal_request` — last resort: one-time value, only after Touch ID / Telegram approval; audited.
- `vault_set_request` — instructs the agent to ask the human to run `vaultic set`; the AI never collects the value.

## Security model

Each layer maps to the attack it cuts:

| Layer | Attack it cuts |
|---|---|
| Reference model (broker never returns values) | Transcript / context / telemetry leakage |
| Proxy + egress filtering (paranoid mode) | Prompt injection reading env vars / sending keys to a foreign domain |
| PreToolUse fingerprint check (salted hash + regex) | Writing the value into a file, code, or command |
| gitleaks pre-commit | Leaking into git history (last line of defense) |
| Approval (Touch ID local / Telegram remote) + audit | Uncontrolled exceptional access, confused-deputy reveals |
| Project-scoped machine identity | Blast radius of a compromised credential |
| Fail-closed broker | Silent fallback / leak while the vault is unreachable |

## Threat model — honest limits

These are real, verified limits of the current implementation. They are not softened; if one of
them matters for your threat model, account for it before relying on vaultic.

- **The fingerprint guard is token-based.** Tool input is split into tokens and each token's salted
  hash is compared against the store. An agent (or injected prompt) that **splits the value across
  lines** or **writes it as two concatenated halves** assembles a payload no single token of which
  matches — the fingerprint layer does not catch it. The `KEY=value` shape **is** covered (the
  segment after the last `=` is hashed separately), but an **unquoted, pattern-less secret** like
  `export DB_PASSWORD=randomvalue` whose value was never fingerprinted matches neither the
  fingerprint store nor any generic regex — it can pass both layers.
- **Redaction is literal-only.** `vault_run` replaces exact occurrences of injected values in the
  captured output. If the command itself transforms the value — base64, hex, any re-encoding — the
  transformed output is **not** redacted. Redaction defends against accidental echo, not against
  adversarial transformation by the executed command.
- **`vault_run` injects real values into the child process environment.** Any child process can
  exfiltrate them out-of-band (file write, network call) during execution; redaction only covers
  the captured stdout/stderr. The process-group kill bounds the timeout window, but a grandchild
  that calls `setsid()` or re-parents to PID 1 escapes the kill. SIGKILL on timeout gives the child
  no opportunity to scrub secrets from memory. On timeout the result is `exitCode: 124` with
  `timedOut: true`.
- **The fingerprint store has a multi-process write race.** `addValue` is read-modify-write with an
  atomic rename — two processes adding in the same microsecond window are last-writer-wins, and one
  fingerprint can be lost. The expected usage (one long-lived broker plus an occasional
  `vaultic set`) is sequential and safe; bulk concurrent writers are not.
- **agent-vault paranoid mode has hard constraints** (see
  [`deploy/agent-vault/README.md`](deploy/agent-vault/README.md)): running the agent and
  agent-vault on the **same host drops the security guarantee entirely** — the agent can read the
  proxy's SQLite DB and DEK off disk. If Infisical goes down, agent-vault is **fail-open**: it keeps
  serving its last cached snapshot, so a revoked secret stays usable until the next successful poll.
  The proxy auth token travels in **plaintext** between agent and broker — localhost/VPN/private
  subnet only.
- **The PreToolUse hook is fail-open on its own errors, by design.** Unreadable fingerprint store,
  malformed input — the hook lets the call through rather than blocking all tool use. The broker, by
  contrast, is fail-closed on values: no backend, no value. Know which guarantee you are relying on.
- **Host coverage differs.** In Claude Code the PreToolUse deny works even in `bypassPermissions`
  mode. The Codex port scans the same serialized tool input, which also covers Codex's
  `apply_patch` (its input shape differs from Write/Edit); Codex does **not** support the `ask`
  permission decision (vaultic only uses `deny`, so this does not bite), and Codex hooks require a
  one-time `/hooks` trust approval — hash-based, so every hook file change needs re-approval.

## End-to-end verification

The human-run acceptance test. All eight steps should pass on a fresh setup:

1. Deploy a local Infisical via [`deploy/README.md`](deploy/README.md); complete the first signup
   (becomes instance admin), create a machine identity and a test project, add the identity to the
   project.
2. `vaultic login`, `vaultic link`, `vaultic init` in a test repo, then
   `vaultic set vault://<ws>/<proj>/prod/TEST_KEY` and enter a value at the hidden prompt.
3. Open a **new Claude Code session** in the project → the SessionStart notice appears
   ("vaultic active... declares N secret(s)"); `vault_check` reports `TEST_KEY` present.
4. `vault_run 'echo $TEST_KEY'` → the output shows `[vaultic:redacted]`, never the value.
5. Ask the AI to write the secret to a file → the PreToolUse hook **denies** the tool call.
6. `vault_reveal_request` → Touch ID prompt appears → approve → the value is returned exactly once
   and a `reveal` line is appended to `~/.config/vaultic/audit.jsonl`.
7. `vaultic run -- env | grep TEST_KEY` → the value is redacted in the printed output.
8. For server deploys: `curl -sk https://HOST/.env` → must return **404** (no dotfile leak through
   the reverse proxy).

## Project layout

```
packages/shared/    manifest parsing, vault:// refs, fingerprint store, redaction, secret patterns
packages/broker/    MCP server (6 tools), Infisical backend, approval (Touch ID/Telegram), audit log
packages/cli/       vaultic CLI: login · link · init · check · set · share · run
hooks/              PreToolUse guard + SessionStart notice (Claude Code & Codex)
skill/vaultic/      Claude Code skill — the reference-only workflow discipline
helpers/touchid/    Swift Touch ID approval helper (macOS)
deploy/             Infisical CE self-host guide + agent-vault paranoid-mode guide
docs/plans/         design & implementation documents
install.sh          idempotent installer (build, CLI symlink, hooks, skill, MCP registration)
```

Licensed under the [GNU AGPL-3.0-or-later](LICENSE): you may use, modify and self-host vaultic
freely, but if you distribute it or run a modified version as a network service, you must publish
your changes under the same license — no closed-source forks. Contributions welcome — open an issue
or PR; never put a real secret value in a test fixture (use `sk-test-...` fakes).
