---
name: vaultic
description: Use when the project needs API keys/secrets, when a .aiv.yaml manifest exists, or when the user mentions credentials, .env files, or API keys — a secure vault workflow where the AI works with vault:// references and never sees or writes raw secret values.
---

# vaultic — Secure Credentials Workflow

## The Rule
NEVER ask the user to paste a secret. NEVER write a real secret value into any file, command, commit, or message. Secret values live in the vault; you work with references (`vault://workspace/project/env/KEY`).

## The Tools (MCP server `vaultic`)
- `vault_check` — at session start (or when a .aiv.yaml exists), see which declared secrets are present/missing. No values.
- `vault_list` — list secret NAMES + metadata in a scope. No values.
- `vault_ref` — build a `vault://...` reference to embed in code/config instead of a literal value.
- `vault_run` — run a shell command with the manifest's secrets injected as env vars; output is redacted. USE THIS instead of asking for values when you need to execute something that consumes a secret.
- `vault_set_request` — when a secret is missing: this tells you to ask the user to run `vaultic set <ref>` in their terminal. The HUMAN enters the value; you never collect it.
- `vault_reveal_request` — LAST RESORT only: request a one-time reveal of an actual value (e.g. to paste into a third-party web dashboard for the user). Requires human approval (Touch ID / Telegram) and is audited. Never write the revealed value anywhere.

## First run — not wired up yet?
If `vault_check` reports the broker isn't configured, or `~/.config/vaultic/config.json` has no
linked project, or the user asks you to "set up / connect the vault" — the backend isn't deployed
yet. Open [`SETUP.md`](./SETUP.md) (next to this file) and run that setup playbook YOURSELF: you
deploy the Infisical backend, create the machine identity, and wire the local client. Don't tell
the user to paste commands — execute them. The human only picks where it goes and types secret
values at hidden prompts. Once `claude mcp list` shows vaultic **Connected**, continue below.

## Workflow
1. Session start / `.aiv.yaml` present → call `vault_check`.
2. Need a secret referenced in code/config → write the env var NAME; map it in `.aiv.yaml` (use `vault_ref` for the reference string). Read it at runtime from `process.env` / the injected env, never inline the value.
3. Need to RUN something that uses secrets → `vault_run` (values injected into the child env, output redacted).
4. Secret missing → `vault_set_request` → tell the user the exact `vaultic set` command. Do not collect the value yourself.
5. Genuinely need to SEE a value (rare) → `vault_reveal_request` with a clear reason → human approves → use it once, write it nowhere.

## Red flags — STOP if you catch yourself:
- About to write `sk-...`, `sk-ant-...`, `AKIA...`, `ghp_...`, a JWT, or any literal token into a file/command/commit.
- About to ask "can you share the API key / paste the secret?"
- Copying `.env` contents into another file or message.

The PreToolUse hook will BLOCK these (it detects known secret values and secret-shaped strings). Don't try to work around the hook — use the tools above. If the hook blocks you, that's a signal you were about to leak a value; switch to a `vault://` reference or `vault_run`.

## Host-agnostic note (Codex / other agents)
The same MCP tools work from any MCP-capable host. For Codex, the hooks install to `~/.codex/` and require a one-time `/hooks` trust approval. The principle is identical everywhere: references and `vault_run`, never raw values.
