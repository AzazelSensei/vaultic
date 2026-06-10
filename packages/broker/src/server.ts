#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { FingerprintStore, loadManifest } from '@vaultic/shared';
import type { VaultBackend } from './backend.js';
import { InfisicalBackend } from './infisical.js';
import { loadConfig, loadCredentials, configDir, fingerprintPath } from './config.js';
import { AuditLog } from './audit.js';
import { TouchIdApprover } from './approval/touchid.js';
import { TelegramApprover } from './approval/telegram.js';
import { resolveApprover } from './approval/resolve.js';
import type { ApprovalProvider } from './approval/types.js';
import { vaultCheck, vaultList, vaultRef } from './tools/readonly.js';
import { vaultRun } from './tools/run.js';
import { vaultRevealRequest, vaultSetRequest } from './tools/reveal.js';

const COMMAND_AUDIT_MAX = 200;

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

async function closeApprover(approver: ApprovalProvider): Promise<void> {
  try {
    await approver.close?.();
  } catch (err) {
    console.error(`vaultic: approver close failed: ${(err as Error).message}`);
  }
}

export function buildServer(deps: { backend: VaultBackend; projectDir: string }): McpServer {
  const { backend, projectDir } = deps;
  const server = new McpServer({ name: 'vaultic', version: '0.1.0' });
  const fingerprints = new FingerprintStore(fingerprintPath());
  const audit = new AuditLog(join(configDir(), 'audit.jsonl'));
  const manifest = () => loadManifest(projectDir);

  server.registerTool(
    'vault_check',
    {
      description:
        'Check which secrets the project manifest (.aiv.yaml) needs and which exist in the vault. Never returns values.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await vaultCheck({ backend, manifest: manifest() }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'vault_list',
    {
      description: 'List secret NAMES and metadata in a scope. Never returns values.',
      inputSchema: { workspace: z.string(), project: z.string(), environment: z.string() },
    },
    async (args) => {
      try {
        return ok(await vaultList({ backend }, args));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'vault_ref',
    {
      description: 'Build a vault:// reference string to embed in code/config instead of a real value.',
      inputSchema: { workspace: z.string(), project: z.string(), environment: z.string(), key: z.string() },
    },
    async (args) => {
      try {
        return ok({ ref: vaultRef(args) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'vault_run',
    {
      description:
        'Run a shell command with manifest secrets injected as env vars. Output is redacted. Use this instead of asking for values.',
      inputSchema: { command: z.string(), cwd: z.string().optional(), timeoutMs: z.number().optional() },
    },
    async (args) => {
      let outcome: 'ok' | 'error' = 'error';
      try {
        const result = await vaultRun({ backend, manifest: manifest(), fingerprints }, args);
        outcome = 'ok';
        return ok(result);
      } catch (e) {
        return fail(e);
      } finally {
        audit.record({ action: 'run', detail: args.command.slice(0, COMMAND_AUDIT_MAX), outcome });
      }
    },
  );

  server.registerTool(
    'vault_reveal_request',
    {
      description:
        'LAST RESORT: request one-time reveal of a secret value. Requires human approval (Touch ID / Telegram). Audited.',
      inputSchema: { ref: z.string(), reason: z.string() },
    },
    async (args) => {
      let approver: ReturnType<typeof resolveApprover> | undefined;
      try {
        const credentials = loadCredentials();
        const config = loadConfig();
        approver = resolveApprover({
          approvers: [
            new TouchIdApprover({ helperPath: join(homedir(), '.config', 'vaultic', 'vaultic-auth-helper') }),
            new TelegramApprover({
              botToken: credentials.telegramBotToken,
              allowedUserId: config.approval?.telegramAllowedUserId,
            }),
          ],
        });
        return ok(await vaultRevealRequest({ backend, approver, audit, fingerprints }, args));
      } catch (e) {
        return fail(e);
      } finally {
        if (approver) await closeApprover(approver);
      }
    },
  );

  server.registerTool(
    'vault_set_request',
    {
      description:
        'Request creation of a new secret. The HUMAN enters the value via `vaultic set` in their terminal — never paste values here.',
      inputSchema: { ref: z.string() },
    },
    async (args) => {
      try {
        return ok(await vaultSetRequest(args));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

const isDirectRun = process.argv[1]?.endsWith('server.js');
if (isDirectRun) {
  const config = loadConfig();
  const credentials = loadCredentials();
  const backend = new InfisicalBackend({ config, credentials });
  const server = buildServer({ backend, projectDir: process.env.CLAUDE_PROJECT_DIR ?? process.cwd() });
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await server.connect(new StdioServerTransport());
  console.error('vaultic-broker running on stdio');
}
