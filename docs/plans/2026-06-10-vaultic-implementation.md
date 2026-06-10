# vaultic Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI ajanlarının secret değerini hiç görmeden çalıştığı, self-host edilebilir, workspace tabanlı credentials vault — MCP broker + hook koruması + onaylı istisnai erişim.

**Architecture:** Infisical CE (self-host backend) + `vaultic-broker` (TS, stdio MCP server — değer döndürmez) + `vaultic` CLI (insan tarafı) + Claude Code/Codex hook'ları (fingerprint tabanlı sızıntı engeli) + agent-vault proxy (opsiyonel paranoid mod). Tasarım: `docs/plans/2026-06-10-vaultic-design.md`.

**Tech Stack (doğrulanmış sürümler, 2026-06-10):** Node ≥20.10, pnpm workspaces, TypeScript 5, vitest, `@modelcontextprotocol/sdk@^1.29.0` (v2 alpha KULLANMA), `zod@^4`, `@infisical/sdk@^5.0.2`, `grammy@^1.43.0`, `yaml@^2`, `commander`, agent-vault **v0.32.0 pinli**, Swift helper (macOS Touch ID).

**Kritik doğrulanmış kurallar (tüm görevlerde geçerli):**
- MCP stdio modunda **stdout'a asla log yazma** — `console.error` kullan (JSON-RPC kanalı bozulur).
- `registerTool`'da `inputSchema`/`outputSchema` **raw zod shape**'tir: `{ key: z.string() }`, `z.object(...)` DEĞİL.
- PreToolUse engelleme çıktısı: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` + exit 0. (`exit 2` + stderr alternatiftir ama JSON ile karıştırılamaz.)
- Infisical SDK'da `siteUrl` verilmezse istekler cloud'a gider — self-host'ta her zaman ver.
- Secret key adları `^[A-Z][A-Z0-9_]*$` (UPPER_SNAKE_CASE) — agent-vault sync uyumu için zorunlu.
- Boş `catch` yasak; her hata anlamlı mesajla fırlatılır. Broker fail-closed: backend erişilemezse değer ASLA cache/disk'ten verilmez.
- Commit formatı: `[alan]: [ne yapıldı]` — Türkçe, geçmiş zaman, ≤72 karakter.

---

## Faz 0 — Monorepo iskeleti

### Task 1: pnpm workspace + TS + vitest kurulumu

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `CLAUDE.md`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/broker/package.json`, `packages/broker/tsconfig.json`
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`

**Step 1: Kök dosyaları yaz**

`package.json`:
```json
{
  "name": "ai-credentials-vault",
  "private": true,
  "engines": { "node": ">=20.10" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "pnpm -r exec tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^3.0.0",
    "tsx": "^4.0.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
*.local.json
deploy/.env
```

`CLAUDE.md` (kök):
```markdown
# vaultic

AI credentials vault. Tasarım: docs/plans/2026-06-10-vaultic-design.md

## Komutlar
- Build: `pnpm build` — Test: `pnpm test` — Tek test: `pnpm vitest run <dosya>`
- Typecheck: `pnpm typecheck`

## Kurallar
- MCP stdio: log SADECE console.error ile (stdout JSON-RPC kanalıdır).
- Secret değeri hiçbir log/test fixture/commit'e girmez. Testlerde sahte değer kullan: `sk-test-...`
- Broker fail-closed: backend yoksa değer verilmez, anlamlı hata fırlatılır.
- registerTool şemaları raw zod shape (z.object değil).
```

Her paket için `package.json` (örnek `packages/shared/package.json`; broker/cli'da `name` alanı değişir):
```json
{
  "name": "@vaultic/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc" },
  "engines": { "node": ">=20.10" }
}
```

Her paket için `tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

**Step 2: Bağımlılıkları kur**

Run: `cd /Users/abdullahgokmen/Desktop/ai-credentials-vault && pnpm install`
Expected: lockfile oluşur, hatasız biter.

Run: `pnpm add -w -D typescript vitest tsx && pnpm --filter @vaultic/shared add yaml zod && pnpm --filter vaultic-broker add @modelcontextprotocol/sdk@^1.29.0 zod @infisical/sdk grammy && pnpm --filter vaultic add commander yaml zod`
Expected: sürümler `@modelcontextprotocol/sdk` 1.29.x, `@infisical/sdk` 5.x, `grammy` 1.43+ olarak çözülür. `pnpm ls --depth 0 -r` ile doğrula. broker ve cli, shared'a workspace bağımlılığı alır: `pnpm --filter vaultic-broker --filter vaultic add @vaultic/shared@workspace:*`

**Step 3: Boş giriş dosyaları + typecheck**

`packages/*/src/index.ts` → her birine `export {};` yaz.
Run: `pnpm typecheck`
Expected: PASS (0 hata).

**Step 4: Commit**

```bash
git add -A && git commit -m "iskelet: pnpm monorepo, ts ve vitest kurulumu yapıldı"
```

---

## Faz 1 — @vaultic/shared çekirdeği

### Task 2: vault:// referans parser'ı

**Files:**
- Create: `packages/shared/src/ref.ts`
- Test: `packages/shared/test/ref.test.ts`

**Step 1: Failing test yaz**

```typescript
import { describe, it, expect } from 'vitest';
import { parseVaultRef, formatVaultRef } from '../src/ref.js';

describe('parseVaultRef', () => {
  it('geçerli referansı parse eder', () => {
    expect(parseVaultRef('vault://blackhole-labs/payment-api/prod/OPENAI_API_KEY')).toEqual({
      workspace: 'blackhole-labs', project: 'payment-api',
      environment: 'prod', key: 'OPENAI_API_KEY',
    });
  });
  it('roundtrip çalışır', () => {
    const ref = 'vault://ws/proj/dev/MY_KEY_2';
    expect(formatVaultRef(parseVaultRef(ref))).toBe(ref);
  });
  it.each([
    'vault://ws/proj/dev/lower_case',
    'vault://ws/proj/dev',
    'http://ws/proj/dev/KEY',
    'vault://ws/proj/dev/KEY/extra',
    'vault://WS/proj/dev/KEY',
  ])('geçersiz referansı reddeder: %s', (bad) => {
    expect(() => parseVaultRef(bad)).toThrow(/Invalid vault reference/);
  });
});
```

**Step 2:** Run: `pnpm vitest run packages/shared/test/ref.test.ts` — Expected: FAIL (modül yok).

**Step 3: Implement**

`packages/shared/src/ref.ts`:
```typescript
export interface VaultRef {
  workspace: string;
  project: string;
  environment: string;
  key: string;
}

const REF_PATTERN = /^vault:\/\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/([A-Z][A-Z0-9_]*)$/;

export function parseVaultRef(ref: string): VaultRef {
  const m = REF_PATTERN.exec(ref);
  if (!m) {
    throw new Error(
      `Invalid vault reference: ${ref} (expected vault://workspace/project/env/UPPER_SNAKE_KEY)`,
    );
  }
  return { workspace: m[1], project: m[2], environment: m[3], key: m[4] };
}

export function formatVaultRef(r: VaultRef): string {
  return `vault://${r.workspace}/${r.project}/${r.environment}/${r.key}`;
}
```

`packages/shared/src/index.ts`'e ekle: `export * from './ref.js';`

**Step 4:** Run: `pnpm vitest run packages/shared/test/ref.test.ts` — Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared && git commit -m "shared: vault referans parser'ı eklendi"
```

### Task 3: .aiv.yaml manifest yükleyici

**Files:**
- Create: `packages/shared/src/manifest.ts`
- Test: `packages/shared/test/manifest.test.ts`

**Step 1: Failing test yaz**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest } from '../src/manifest.js';

const VALID = `workspace: blackhole-labs
project: payment-api
mode: standard
needs:
  OPENAI_API_KEY: vault://blackhole-labs/payment-api/prod/OPENAI_API_KEY
`;

function writeTmpManifest(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vaultic-'));
  writeFileSync(join(dir, '.aiv.yaml'), content);
  return dir;
}

describe('loadManifest', () => {
  it('geçerli manifesti yükler', () => {
    const m = loadManifest(writeTmpManifest(VALID));
    expect(m?.project).toBe('payment-api');
    expect(m?.mode).toBe('standard');
    expect(Object.keys(m!.needs)).toEqual(['OPENAI_API_KEY']);
  });
  it('dosya yoksa undefined döner', () => {
    expect(loadManifest(mkdtempSync(join(tmpdir(), 'vaultic-empty-')))).toBeUndefined();
  });
  it('mode verilmezse standard varsayar', () => {
    const m = loadManifest(writeTmpManifest(VALID.replace('mode: standard\n', '')));
    expect(m?.mode).toBe('standard');
  });
  it('geçersiz referansı anlamlı hatayla reddeder', () => {
    const bad = VALID.replace('vault://blackhole-labs/payment-api/prod/OPENAI_API_KEY', 'not-a-ref');
    expect(() => loadManifest(writeTmpManifest(bad))).toThrow(/Invalid vault reference/);
  });
  it('env değişken adı UPPER_SNAKE değilse reddeder', () => {
    const bad = VALID.replace('OPENAI_API_KEY:', 'openai_key:');
    expect(() => loadManifest(writeTmpManifest(bad))).toThrow(/env var name/i);
  });
});
```

**Step 2:** Run: `pnpm vitest run packages/shared/test/manifest.test.ts` — Expected: FAIL.

**Step 3: Implement**

`packages/shared/src/manifest.ts`:
```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import * as z from 'zod';
import { parseVaultRef } from './ref.js';

export const MANIFEST_FILENAME = '.aiv.yaml';
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const ManifestSchema = z.object({
  workspace: z.string().min(1),
  project: z.string().min(1),
  mode: z.enum(['standard', 'paranoid']).default('standard'),
  needs: z.record(z.string(), z.string()),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export function loadManifest(dir: string): Manifest | undefined {
  const path = join(dir, MANIFEST_FILENAME);
  if (!existsSync(path)) return undefined;
  const manifest = ManifestSchema.parse(parse(readFileSync(path, 'utf8')));
  for (const [envName, ref] of Object.entries(manifest.needs)) {
    if (!ENV_NAME_PATTERN.test(envName)) {
      throw new Error(`Invalid env var name in manifest: ${envName} (expected UPPER_SNAKE_CASE)`);
    }
    parseVaultRef(ref);
  }
  return manifest;
}
```

`index.ts`'e `export * from './manifest.js';` ekle.

**Step 4:** Run testler — Expected: PASS. **Step 5: Commit:** `git commit -m "shared: aiv.yaml manifest yükleyici eklendi"`

### Task 4: Fingerprint store (salted hash ile sızıntı tespiti)

**Files:**
- Create: `packages/shared/src/fingerprint.ts`
- Test: `packages/shared/test/fingerprint.test.ts`

Tasarım notu: değerlerin kendisi değil, `sha256(salt + varyant)` hash'leri saklanır. Varyantlar: ham değer, base64, URL-encoded. Tespit, metni token'lara bölüp (secret'lar pratikte ayrık token olarak yazılır) her token'ı hash'leyerek yapılır — O(token sayısı). Satır-bölme bypass'ı bilinen sınırdır; generic regex katmanı (Task 5) ve kaynak redaksiyonu (Task 9) tamamlar.

**Step 1: Failing test yaz**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FingerprintStore } from '../src/fingerprint.js';

const SECRET = 'sk-test-Abc123XyzVaulticFake0042';

describe('FingerprintStore', () => {
  let store: FingerprintStore;
  beforeEach(() => {
    store = new FingerprintStore(join(mkdtempSync(join(tmpdir(), 'fp-')), 'fp.json'));
  });

  it('eklenen değeri metin içinde yakalar', () => {
    store.addValue(SECRET);
    expect(store.containsSecret(`const k = "${SECRET}";`)).toBe(true);
  });
  it('base64 varyantını yakalar', () => {
    store.addValue(SECRET);
    const b64 = Buffer.from(SECRET).toString('base64');
    expect(store.containsSecret(`echo ${b64} | base64 -d`)).toBe(true);
  });
  it('temiz metinde false döner', () => {
    store.addValue(SECRET);
    expect(store.containsSecret('console.log("hello world")')).toBe(false);
  });
  it('diske yazıp tekrar yükler, ham değer dosyada YOKTUR', () => {
    store.addValue(SECRET);
    const reloaded = new FingerprintStore(store.filePath);
    expect(reloaded.containsSecret(SECRET)).toBe(true);
    const raw = require('node:fs').readFileSync(store.filePath, 'utf8');
    expect(raw).not.toContain(SECRET);
  });
  it('8 karakterden kısa değerleri eklemeyi reddeder', () => {
    expect(() => store.addValue('short')).toThrow(/too short/i);
  });
});
```

**Step 2:** Run — Expected: FAIL.

**Step 3: Implement**

`packages/shared/src/fingerprint.ts`:
```typescript
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const MIN_SECRET_LENGTH = 8;
const MIN_TOKEN_LENGTH = 8;
const TOKEN_SPLIT = /[^A-Za-z0-9+/=_\-.~]+/;

interface StoreFile {
  salt: string;
  prints: string[];
}

export class FingerprintStore {
  readonly filePath: string;
  private salt: string;
  private prints: Set<string>;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8')) as StoreFile;
      this.salt = data.salt;
      this.prints = new Set(data.prints);
    } else {
      this.salt = randomBytes(16).toString('hex');
      this.prints = new Set();
    }
  }

  private hash(value: string): string {
    return createHash('sha256').update(this.salt + value).digest('hex');
  }

  addValue(value: string): void {
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(`Refusing to fingerprint value: too short (<${MIN_SECRET_LENGTH} chars)`);
    }
    for (const variant of [value, Buffer.from(value).toString('base64'), encodeURIComponent(value)]) {
      this.prints.add(this.hash(variant));
    }
    this.persist();
  }

  containsSecret(text: string): boolean {
    if (this.prints.size === 0) return false;
    for (const token of text.split(TOKEN_SPLIT)) {
      if (token.length >= MIN_TOKEN_LENGTH && this.prints.has(this.hash(token))) return true;
    }
    return false;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    writeFileSync(this.filePath, JSON.stringify({ salt: this.salt, prints: [...this.prints] } satisfies StoreFile));
    chmodSync(this.filePath, 0o600);
  }
}
```

`index.ts`'e export ekle.

**Step 4:** Run — Expected: PASS. **Step 5: Commit:** `git commit -m "shared: salted fingerprint store eklendi"`

### Task 5: Generic secret regex'leri + redaksiyon

**Files:**
- Create: `packages/shared/src/patterns.ts`, `packages/shared/src/redact.ts`
- Test: `packages/shared/test/patterns.test.ts`, `packages/shared/test/redact.test.ts`

**Step 1: Failing testler**

`patterns.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { matchGenericSecret } from '../src/patterns.js';

describe('matchGenericSecret', () => {
  it.each([
    ['sk-proj-abcdefghijklmnopqrstuv123456', 'openai'],
    ['AKIAIOSFODNN7EXAMPLE', 'aws-access-key'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github-pat'],
    ['xoxb-test-not-a-real-token-0000', 'slack-token'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
    ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc123def456', 'jwt'],
  ])('yakalar: %s → %s', (text, id) => {
    expect(matchGenericSecret(text)?.id).toBe(id);
  });
  it('normal metni yakalamaz', () => {
    expect(matchGenericSecret('const apiKey = process.env.OPENAI_API_KEY')).toBeUndefined();
  });
});
```

`redact.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/redact.js';

describe('redactSecrets', () => {
  it('bilinen değerleri maskeler', () => {
    const out = redactSecrets('key=sk-test-12345678 other=sk-test-12345678', ['sk-test-12345678']);
    expect(out).toBe('key=[vaultic:redacted] other=[vaultic:redacted]');
  });
  it('boş değer listesinde metni aynen döner', () => {
    expect(redactSecrets('hello', [])).toBe('hello');
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement**

`packages/shared/src/patterns.ts`:
```typescript
export interface SecretPattern {
  id: string;
  pattern: RegExp;
}

export const GENERIC_SECRET_PATTERNS: SecretPattern[] = [
  { id: 'openai', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-pat', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: 'generic-assignment', pattern: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{16,}['"]/i },
];

export function matchGenericSecret(text: string): SecretPattern | undefined {
  return GENERIC_SECRET_PATTERNS.find((p) => p.pattern.test(text));
}
```

Not: `anthropic` pattern'i `openai`'den ÖNCE eşleşsin istiyorsan diziyi spesifikten genele sırala (`sk-ant-` önce). Testte hangi id beklendiğine göre sırayı ayarla.

`packages/shared/src/redact.ts`:
```typescript
export const REDACTED_PLACEHOLDER = '[vaultic:redacted]';

export function redactSecrets(text: string, values: string[]): string {
  let result = text;
  for (const value of values) {
    if (value.length === 0) continue;
    result = result.split(value).join(REDACTED_PLACEHOLDER);
  }
  return result;
}
```

`index.ts`'e exportları ekle.

**Step 4:** Run tüm shared testleri: `pnpm vitest run packages/shared` — PASS. **Step 5: Commit:** `git commit -m "shared: generic secret regex'leri ve redaksiyon eklendi"`

---

## Faz 2 — vaultic-broker

### Task 6: Config yükleyici + VaultBackend interface

**Files:**
- Create: `packages/broker/src/config.ts`, `packages/broker/src/backend.ts`
- Test: `packages/broker/test/config.test.ts`

Config dosyaları (`~/.config/vaultic/`, 0600):
- `config.json`: `{ siteUrl, workspaces: { "<ws>": { projects: { "<proj>": { projectId } } } }, approval: { telegramAllowedUserId? } }`
- `credentials.json`: `{ clientId, clientSecret, telegramBotToken? }` — `vaultic login` yazar.
- `fingerprints.json`: FingerprintStore dosyası.

Test ortamında konum `VAULTIC_CONFIG_DIR` env ile override edilir.

**Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveProjectId } from '../src/config.js';

function tmpConfigDir(config: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'vcfg-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}

const CFG = {
  siteUrl: 'https://infisical.example.com',
  workspaces: { ws1: { projects: { proj1: { projectId: 'pid-123' } } } },
};

describe('config', () => {
  it('config dosyasını yükler', () => {
    expect(loadConfig(tmpConfigDir(CFG)).siteUrl).toBe('https://infisical.example.com');
  });
  it('eksik config anlamlı hata verir', () => {
    expect(() => loadConfig(mkdtempSync(join(tmpdir(), 'vcfg-e-')))).toThrow(/vaultic login/);
  });
  it('workspace/proje → projectId çözer', () => {
    expect(resolveProjectId(loadConfig(tmpConfigDir(CFG)), 'ws1', 'proj1')).toBe('pid-123');
  });
  it('eşlenmemiş proje için vaultic link öneren hata verir', () => {
    expect(() => resolveProjectId(loadConfig(tmpConfigDir(CFG)), 'ws1', 'nope')).toThrow(/vaultic link/);
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement**

`packages/broker/src/config.ts`:
```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as z from 'zod';

const ConfigSchema = z.object({
  siteUrl: z.string().url(),
  workspaces: z.record(z.string(), z.object({
    projects: z.record(z.string(), z.object({ projectId: z.string() })),
  })),
  approval: z.object({ telegramAllowedUserId: z.number().optional() }).optional(),
});
const CredentialsSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  telegramBotToken: z.string().optional(),
});

export type VaulticConfig = z.infer<typeof ConfigSchema>;
export type VaulticCredentials = z.infer<typeof CredentialsSchema>;

export function configDir(): string {
  return process.env.VAULTIC_CONFIG_DIR ?? join(homedir(), '.config', 'vaultic');
}

function loadJsonFile(dir: string, name: string, hint: string): unknown {
  const path = join(dir, name);
  if (!existsSync(path)) throw new Error(`vaultic config missing: ${path} — run \`${hint}\` first`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadConfig(dir = configDir()): VaulticConfig {
  return ConfigSchema.parse(loadJsonFile(dir, 'config.json', 'vaultic login'));
}

export function loadCredentials(dir = configDir()): VaulticCredentials {
  return CredentialsSchema.parse(loadJsonFile(dir, 'credentials.json', 'vaultic login'));
}

export function resolveProjectId(config: VaulticConfig, workspace: string, project: string): string {
  const projectId = config.workspaces[workspace]?.projects[project]?.projectId;
  if (!projectId) {
    throw new Error(
      `No Infisical project mapped for ${workspace}/${project} — run \`vaultic link ${workspace}/${project} <projectId>\``,
    );
  }
  return projectId;
}

export function fingerprintPath(dir = configDir()): string {
  return join(dir, 'fingerprints.json');
}
```

`packages/broker/src/backend.ts` (DIP — broker tool'ları sadece bu interface'i bilir):
```typescript
import type { VaultRef } from '@vaultic/shared';

export interface SecretMeta {
  key: string;
  environment: string;
  lastUpdated?: string;
}

export interface VaultBackend {
  listSecrets(ref: Pick<VaultRef, 'workspace' | 'project' | 'environment'>): Promise<SecretMeta[]>;
  getSecretValue(ref: VaultRef): Promise<string>;
  setSecret(ref: VaultRef, value: string): Promise<void>;
}
```

**Step 4:** Run — PASS. **Step 5: Commit:** `git commit -m "broker: config yükleyici ve backend arayüzü eklendi"`

### Task 7: InfisicalBackend (SDK sarmalayıcı)

**Files:**
- Create: `packages/broker/src/infisical.ts`
- Test: `packages/broker/test/infisical.test.ts`

SDK'yı doğrudan mock'lamak yerine constructor'a factory enjekte edilir (test edilebilirlik + DIP).

**Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { InfisicalBackend } from '../src/infisical.js';

const fakeSecretsApi = {
  listSecrets: vi.fn().mockResolvedValue({ secrets: [{ secretKey: 'OPENAI_API_KEY', updatedAt: '2026-06-01' }] }),
  getSecret: vi.fn().mockResolvedValue({ secretKey: 'OPENAI_API_KEY', secretValue: 'sk-test-12345678' }),
  createSecret: vi.fn().mockResolvedValue({}),
};
const fakeSdk = {
  auth: () => ({ universalAuth: { login: vi.fn().mockResolvedValue(undefined) } }),
  secrets: () => fakeSecretsApi,
};

function makeBackend() {
  return new InfisicalBackend({
    config: {
      siteUrl: 'https://inf.example.com',
      workspaces: { ws: { projects: { proj: { projectId: 'pid-1' } } } },
    },
    credentials: { clientId: 'cid', clientSecret: 'cs' },
    sdkFactory: () => fakeSdk as never,
  });
}

describe('InfisicalBackend', () => {
  it('listSecrets projectId ve environment ile çağırır, değer istemez', async () => {
    const metas = await makeBackend().listSecrets({ workspace: 'ws', project: 'proj', environment: 'prod' });
    expect(metas[0].key).toBe('OPENAI_API_KEY');
    expect(fakeSecretsApi.listSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'pid-1', environment: 'prod', viewSecretValue: false }),
    );
  });
  it('getSecretValue değeri döner', async () => {
    const v = await makeBackend().getSecretValue({ workspace: 'ws', project: 'proj', environment: 'prod', key: 'OPENAI_API_KEY' });
    expect(v).toBe('sk-test-12345678');
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement**

`packages/broker/src/infisical.ts`:
```typescript
import { InfisicalSDK } from '@infisical/sdk';
import type { VaultRef } from '@vaultic/shared';
import type { SecretMeta, VaultBackend } from './backend.js';
import { resolveProjectId, type VaulticConfig, type VaulticCredentials } from './config.js';

interface InfisicalBackendOptions {
  config: VaulticConfig;
  credentials: VaulticCredentials;
  sdkFactory?: (siteUrl: string) => InfisicalSDK;
}

export class InfisicalBackend implements VaultBackend {
  private readonly options: InfisicalBackendOptions;
  private client?: InfisicalSDK;

  constructor(options: InfisicalBackendOptions) {
    this.options = options;
  }

  private async getClient(): Promise<InfisicalSDK> {
    if (this.client) return this.client;
    const factory = this.options.sdkFactory ?? ((siteUrl: string) => new InfisicalSDK({ siteUrl }));
    const client = factory(this.options.config.siteUrl);
    const { clientId, clientSecret } = this.options.credentials;
    await client.auth().universalAuth.login({ clientId, clientSecret });
    this.client = client;
    return client;
  }

  async listSecrets(ref: Pick<VaultRef, 'workspace' | 'project' | 'environment'>): Promise<SecretMeta[]> {
    const client = await this.getClient();
    const projectId = resolveProjectId(this.options.config, ref.workspace, ref.project);
    const result = await client.secrets().listSecrets({
      projectId,
      environment: ref.environment,
      secretPath: '/',
      viewSecretValue: false,
      expandSecretReferences: false,
    });
    return result.secrets.map((s: { secretKey: string; updatedAt?: string }) => ({
      key: s.secretKey,
      environment: ref.environment,
      lastUpdated: s.updatedAt,
    }));
  }

  async getSecretValue(ref: VaultRef): Promise<string> {
    const client = await this.getClient();
    const projectId = resolveProjectId(this.options.config, ref.workspace, ref.project);
    const secret = await client.secrets().getSecret({
      projectId,
      environment: ref.environment,
      secretPath: '/',
      secretName: ref.key,
    });
    return secret.secretValue;
  }

  async setSecret(ref: VaultRef, value: string): Promise<void> {
    const client = await this.getClient();
    const projectId = resolveProjectId(this.options.config, ref.workspace, ref.project);
    await client.secrets().createSecret(ref.key, {
      projectId,
      environment: ref.environment,
      secretPath: '/',
      secretValue: value,
      type: 'shared',
    });
  }
}
```

Not: SDK'nın gerçek dönüş tipleri kurulumdan sonra `node_modules/@infisical/sdk` tip tanımlarından kontrol edilip cast'ler düzeltilir — alan adları (`secretKey`, `secretValue`, `viewSecretValue`) resmi dokümandan doğrulandı.

**Step 4:** Run — PASS. **Step 5: Commit:** `git commit -m "broker: infisical sdk backend sarmalayıcısı eklendi"`

### Task 8: vault_check, vault_list, vault_ref tool'ları

**Files:**
- Create: `packages/broker/src/tools/readonly.ts`
- Test: `packages/broker/test/readonly.test.ts`

Tool handler'ları saf fonksiyon: `(deps, args) => result`. MCP kaydı Task 13'te.

**Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { vaultCheck, vaultList, vaultRef } from '../src/tools/readonly.js';
import type { VaultBackend } from '../src/backend.js';

const backend: VaultBackend = {
  listSecrets: async () => [{ key: 'OPENAI_API_KEY', environment: 'prod' }],
  getSecretValue: async () => { throw new Error('not used'); },
  setSecret: async () => {},
};

const manifest = {
  workspace: 'ws', project: 'proj', mode: 'standard' as const,
  needs: {
    OPENAI_API_KEY: 'vault://ws/proj/prod/OPENAI_API_KEY',
    MISSING_KEY: 'vault://ws/proj/prod/MISSING_KEY',
  },
};

describe('vaultCheck', () => {
  it('mevcut ve eksik secret\'ları raporlar, değer içermez', async () => {
    const r = await vaultCheck({ backend, manifest });
    expect(r.present).toEqual(['OPENAI_API_KEY']);
    expect(r.missing).toEqual(['MISSING_KEY']);
  });
  it('manifest yoksa yol gösteren hata verir', async () => {
    await expect(vaultCheck({ backend, manifest: undefined })).rejects.toThrow(/\.aiv\.yaml|vaultic init/);
  });
});

describe('vaultList', () => {
  it('sadece isim+metadata döner', async () => {
    const r = await vaultList({ backend }, { workspace: 'ws', project: 'proj', environment: 'prod' });
    expect(r).toEqual([{ key: 'OPENAI_API_KEY', environment: 'prod' }]);
  });
});

describe('vaultRef', () => {
  it('geçerli referans string\'i üretir', () => {
    expect(vaultRef({ workspace: 'ws', project: 'proj', environment: 'prod', key: 'MY_KEY' }))
      .toBe('vault://ws/proj/prod/MY_KEY');
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement**

`packages/broker/src/tools/readonly.ts`:
```typescript
import { formatVaultRef, parseVaultRef, type Manifest, type VaultRef } from '@vaultic/shared';
import type { SecretMeta, VaultBackend } from '../backend.js';

export interface CheckResult {
  mode: 'standard' | 'paranoid';
  present: string[];
  missing: string[];
}

export async function vaultCheck(deps: { backend: VaultBackend; manifest: Manifest | undefined }): Promise<CheckResult> {
  const { backend, manifest } = deps;
  if (!manifest) {
    throw new Error('No .aiv.yaml manifest found in project root — run `vaultic init` to create one');
  }
  const present: string[] = [];
  const missing: string[] = [];
  const cache = new Map<string, Set<string>>();
  for (const [envName, refString] of Object.entries(manifest.needs)) {
    const ref = parseVaultRef(refString);
    const scope = `${ref.workspace}/${ref.project}/${ref.environment}`;
    if (!cache.has(scope)) {
      const metas = await backend.listSecrets(ref);
      cache.set(scope, new Set(metas.map((m) => m.key)));
    }
    (cache.get(scope)!.has(ref.key) ? present : missing).push(envName);
  }
  return { mode: manifest.mode, present, missing };
}

export async function vaultList(
  deps: { backend: VaultBackend },
  scope: Pick<VaultRef, 'workspace' | 'project' | 'environment'>,
): Promise<SecretMeta[]> {
  return deps.backend.listSecrets(scope);
}

export function vaultRef(ref: VaultRef): string {
  return formatVaultRef(ref);
}
```

**Step 4:** Run — PASS. **Step 5: Commit:** `git commit -m "broker: check/list/ref tool çekirdekleri eklendi"`

### Task 9: vault_run — env inject + çıktı redaksiyonu

**Files:**
- Create: `packages/broker/src/tools/run.ts`
- Test: `packages/broker/test/run.test.ts`

**Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultRun } from '../src/tools/run.js';
import { FingerprintStore } from '@vaultic/shared';
import type { VaultBackend } from '../src/backend.js';

const SECRET = 'sk-test-RunSecret12345678';
const backend: VaultBackend = {
  listSecrets: async () => [{ key: 'MY_API_KEY', environment: 'prod' }],
  getSecretValue: async () => SECRET,
  setSecret: async () => {},
};
const manifest = {
  workspace: 'ws', project: 'proj', mode: 'standard' as const,
  needs: { MY_API_KEY: 'vault://ws/proj/prod/MY_API_KEY' },
};
function makeStore() {
  return new FingerprintStore(join(mkdtempSync(join(tmpdir(), 'run-')), 'fp.json'));
}

describe('vaultRun', () => {
  it('secret\'ı env\'e inject eder, çıktıda redakte eder', async () => {
    const r = await vaultRun(
      { backend, manifest, fingerprints: makeStore() },
      { command: 'echo "key is $MY_API_KEY"' },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('[vaultic:redacted]');
    expect(r.stdout).not.toContain(SECRET);
  });
  it('fingerprint store\'a değeri kaydeder', async () => {
    const store = makeStore();
    await vaultRun({ backend, manifest, fingerprints: store }, { command: 'true' });
    expect(store.containsSecret(`x=${SECRET}`)).toBe(true);
  });
  it('komut hata kodunu aynen taşır', async () => {
    const r = await vaultRun({ backend, manifest, fingerprints: makeStore() }, { command: 'exit 3' });
    expect(r.exitCode).toBe(3);
  });
  it('manifest yoksa hata verir', async () => {
    await expect(
      vaultRun({ backend, manifest: undefined, fingerprints: makeStore() }, { command: 'true' }),
    ).rejects.toThrow(/vaultic init/);
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement**

`packages/broker/src/tools/run.ts`:
```typescript
import { spawn } from 'node:child_process';
import { parseVaultRef, redactSecrets, type FingerprintStore, type Manifest } from '@vaultic/shared';
import type { VaultBackend } from '../backend.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function vaultRun(
  deps: { backend: VaultBackend; manifest: Manifest | undefined; fingerprints: FingerprintStore },
  args: { command: string; cwd?: string; timeoutMs?: number },
): Promise<RunResult> {
  const { backend, manifest, fingerprints } = deps;
  if (!manifest) {
    throw new Error('No .aiv.yaml manifest found — run `vaultic init` first');
  }
  const injected: Record<string, string> = {};
  const values: string[] = [];
  for (const [envName, refString] of Object.entries(manifest.needs)) {
    const value = await backend.getSecretValue(parseVaultRef(refString));
    injected[envName] = value;
    values.push(value);
    fingerprints.addValue(value);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', args.command], {
      cwd: args.cwd ?? process.cwd(),
      env: { ...process.env, ...injected },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: redactSecrets(stdout.slice(0, MAX_OUTPUT_CHARS), values),
        stderr: redactSecrets(stderr.slice(0, MAX_OUTPUT_CHARS), values),
        timedOut,
      });
    });
  });
}
```

**Step 4:** Run — PASS. **Step 5: Commit:** `git commit -m "broker: vault_run env inject ve redaksiyon eklendi"`

### Task 10: Audit log

**Files:**
- Create: `packages/broker/src/audit.ts`
- Test: `packages/broker/test/audit.test.ts`

**Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '../src/audit.js';

describe('AuditLog', () => {
  it('JSONL satırı ekler, değer alanı içermez', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'audit-')), 'audit.jsonl');
    const log = new AuditLog(path);
    log.record({ action: 'reveal', ref: 'vault://ws/p/prod/KEY', decision: 'approved', channel: 'touchid' });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[0]);
    expect(entry.action).toBe('reveal');
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(entry)).not.toMatch(/value|secret/i);
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement**

`packages/broker/src/audit.ts`:
```typescript
import { appendFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEvent {
  action: 'reveal' | 'run' | 'set' | 'check' | 'list';
  ref?: string;
  decision?: 'approved' | 'denied' | 'timeout';
  channel?: 'touchid' | 'telegram' | 'none';
  detail?: string;
}

export class AuditLog {
  constructor(private readonly path: string) {}

  record(event: AuditEvent): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const isNew = !existsSync(this.path);
    appendFileSync(this.path, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
    if (isNew) chmodSync(this.path, 0o600);
  }
}
```

**Step 4:** Run — PASS. **Step 5: Commit:** `git commit -m "broker: jsonl audit log eklendi"`

### Task 11: Onay servisi — interface + TouchIdApprover + TelegramApprover

**Files:**
- Create: `packages/broker/src/approval/types.ts`, `packages/broker/src/approval/touchid.ts`, `packages/broker/src/approval/telegram.ts`, `packages/broker/src/approval/resolve.ts`
- Test: `packages/broker/test/approval.test.ts`

Doğrulanmış kısıtlar: Touch ID sadece macOS + GUI session (SSH'ta `SSH_CONNECTION`/`SSH_TTY` varsa atla); Telegram'da `callback_data` ≤64 byte → sadece nonce taşı, istek in-memory map'te; `ctx.from.id` allowlist kontrolü (chat.id DEĞİL); nonce tek kullanımlık + TTL sonunda otomatik DENY; `answerCallbackQuery` çağrısı zorunlu.

**Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { TouchIdApprover } from '../src/approval/touchid.js';
import { resolveApprover } from '../src/approval/resolve.js';

describe('TouchIdApprover', () => {
  it('helper exit 0 → approved', async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0 });
    const a = new TouchIdApprover({ helperPath: '/x/helper', exec, env: {} });
    expect(await a.requestApproval({ ref: 'vault://w/p/e/K', reason: 'test' })).toBe('approved');
  });
  it('helper exit 1 → denied', async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 1 });
    const a = new TouchIdApprover({ helperPath: '/x/helper', exec, env: {} });
    expect(await a.requestApproval({ ref: 'vault://w/p/e/K', reason: 'test' })).toBe('denied');
  });
  it('SSH oturumunda kullanılamaz', () => {
    const a = new TouchIdApprover({ helperPath: '/x/helper', exec: vi.fn(), env: { SSH_CONNECTION: '1' } });
    expect(a.isAvailable()).toBe(false);
  });
});

describe('resolveApprover', () => {
  it('hiçbir kanal yoksa anlamlı hata verir', () => {
    expect(() => resolveApprover({ approvers: [] })).toThrow(/no approval channel/i);
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement**

`packages/broker/src/approval/types.ts`:
```typescript
export type ApprovalDecision = 'approved' | 'denied' | 'timeout';

export interface ApprovalRequest {
  ref: string;
  reason: string;
}

export interface ApprovalProvider {
  readonly channel: 'touchid' | 'telegram';
  isAvailable(): boolean;
  requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}
```

`packages/broker/src/approval/touchid.ts`:
```typescript
import { execFile } from 'node:child_process';
import type { ApprovalDecision, ApprovalProvider, ApprovalRequest } from './types.js';

type ExecFn = (path: string, args: string[]) => Promise<{ exitCode: number }>;

const defaultExec: ExecFn = (path, args) =>
  new Promise((resolve) => {
    const child = execFile(path, args, () => resolve({ exitCode: child.exitCode ?? 1 }));
  });

export class TouchIdApprover implements ApprovalProvider {
  readonly channel = 'touchid' as const;
  constructor(
    private readonly options: {
      helperPath: string;
      exec?: ExecFn;
      env?: NodeJS.ProcessEnv;
    },
  ) {}

  isAvailable(): boolean {
    const env = this.options.env ?? process.env;
    if (env.SSH_CONNECTION || env.SSH_TTY) return false;
    return process.platform === 'darwin' || this.options.env !== undefined;
  }

  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    const exec = this.options.exec ?? defaultExec;
    const { exitCode } = await exec(this.options.helperPath, [`vaultic: ${req.ref} — ${req.reason}`]);
    if (exitCode === 0) return 'approved';
    return 'denied';
  }
}
```

`packages/broker/src/approval/telegram.ts`:
```typescript
import { randomBytes } from 'node:crypto';
import { Bot, InlineKeyboard } from 'grammy';
import type { ApprovalDecision, ApprovalProvider, ApprovalRequest } from './types.js';

const APPROVAL_TIMEOUT_MS = 120_000;
const CALLBACK_PREFIX = 'apr:';

export class TelegramApprover implements ApprovalProvider {
  readonly channel = 'telegram' as const;
  constructor(private readonly options: { botToken?: string; allowedUserId?: number }) {}

  isAvailable(): boolean {
    return Boolean(this.options.botToken && this.options.allowedUserId);
  }

  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    const { botToken, allowedUserId } = this.options;
    if (!botToken || !allowedUserId) throw new Error('Telegram approver not configured');
    const bot = new Bot(botToken);
    const nonce = randomBytes(16).toString('hex');

    return new Promise<ApprovalDecision>((resolve) => {
      let settled = false;
      const finish = async (decision: ApprovalDecision) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await bot.stop();
        resolve(decision);
      };
      const timer = setTimeout(() => void finish('timeout'), APPROVAL_TIMEOUT_MS);

      bot.on('callback_query:data', async (ctx) => {
        if (ctx.from.id !== allowedUserId) return;
        const data = ctx.callbackQuery.data;
        if (!data.startsWith(`${CALLBACK_PREFIX}${nonce}:`)) return;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`vaultic: ${req.ref} — ${data.endsWith(':y') ? 'ONAYLANDI' : 'REDDEDİLDİ'}`);
        await finish(data.endsWith(':y') ? 'approved' : 'denied');
      });

      void bot.start({
        onStart: async () => {
          const keyboard = new InlineKeyboard()
            .text('Onayla', `${CALLBACK_PREFIX}${nonce}:y`)
            .text('Reddet', `${CALLBACK_PREFIX}${nonce}:n`);
          await bot.api.sendMessage(
            allowedUserId,
            `vaultic onay isteği\nReferans: ${req.ref}\nGerekçe: ${req.reason}\n120 sn içinde yanıtlanmazsa reddedilir.`,
            { reply_markup: keyboard },
          );
        },
      });
    });
  }
}
```

`packages/broker/src/approval/resolve.ts`:
```typescript
import type { ApprovalProvider } from './types.js';

export function resolveApprover(deps: { approvers: ApprovalProvider[] }): ApprovalProvider {
  const available = deps.approvers.find((a) => a.isAvailable());
  if (!available) {
    throw new Error(
      'No approval channel available — configure Touch ID helper (macOS) or Telegram (vaultic login --telegram)',
    );
  }
  return available;
}
```

**Step 4:** Run — PASS. **Step 5: Commit:** `git commit -m "broker: touch id ve telegram onay servisleri eklendi"`

### Task 12: vault_reveal_request + vault_set_request

**Files:**
- Create: `packages/broker/src/tools/reveal.ts`
- Test: `packages/broker/test/reveal.test.ts`

**Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultRevealRequest, vaultSetRequest } from '../src/tools/reveal.js';
import { AuditLog } from '../src/audit.js';
import { FingerprintStore } from '@vaultic/shared';
import type { ApprovalProvider } from '../src/approval/types.js';
import type { VaultBackend } from '../src/backend.js';

const SECRET = 'sk-test-Reveal0987654321';
const backend: VaultBackend = {
  listSecrets: async () => [],
  getSecretValue: async () => SECRET,
  setSecret: async () => {},
};
function deps(decision: 'approved' | 'denied') {
  const dir = mkdtempSync(join(tmpdir(), 'rev-'));
  const approver: ApprovalProvider = {
    channel: 'touchid',
    isAvailable: () => true,
    requestApproval: async () => decision,
  };
  return {
    backend, approver,
    audit: new AuditLog(join(dir, 'audit.jsonl')),
    fingerprints: new FingerprintStore(join(dir, 'fp.json')),
  };
}

describe('vaultRevealRequest', () => {
  it('onaylanırsa değeri döner ve fingerprint kaydeder', async () => {
    const d = deps('approved');
    const r = await vaultRevealRequest(d, { ref: 'vault://ws/proj/prod/KEY_NAME', reason: 'dashboard' });
    expect(r.value).toBe(SECRET);
    expect(d.fingerprints.containsSecret(SECRET)).toBe(true);
  });
  it('reddedilirse değer İÇERMEYEN hata fırlatır', async () => {
    await expect(
      vaultRevealRequest(deps('denied'), { ref: 'vault://ws/proj/prod/KEY_NAME', reason: 'x' }),
    ).rejects.toThrow(/denied/i);
  });
});

describe('vaultSetRequest', () => {
  it('AI\'ya değer girdirmez, CLI komutu tarif eder', async () => {
    const r = await vaultSetRequest({ ref: 'vault://ws/proj/prod/NEW_KEY' });
    expect(r.instruction).toContain('vaultic set vault://ws/proj/prod/NEW_KEY');
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement**

`packages/broker/src/tools/reveal.ts`:
```typescript
import { parseVaultRef, type FingerprintStore } from '@vaultic/shared';
import type { AuditLog } from '../audit.js';
import type { ApprovalProvider } from '../approval/types.js';
import type { VaultBackend } from '../backend.js';

export async function vaultRevealRequest(
  deps: { backend: VaultBackend; approver: ApprovalProvider; audit: AuditLog; fingerprints: FingerprintStore },
  args: { ref: string; reason: string },
): Promise<{ value: string; warning: string }> {
  const { backend, approver, audit, fingerprints } = deps;
  const ref = parseVaultRef(args.ref);
  const decision = await approver.requestApproval({ ref: args.ref, reason: args.reason });
  audit.record({ action: 'reveal', ref: args.ref, decision, channel: approver.channel, detail: args.reason });
  if (decision !== 'approved') {
    throw new Error(`Reveal ${decision} for ${args.ref} — user did not approve`);
  }
  const value = await backend.getSecretValue(ref);
  fingerprints.addValue(value);
  return {
    value,
    warning: 'One-time reveal. Do NOT write this value to any file or command — hooks will block it.',
  };
}

export async function vaultSetRequest(args: { ref: string }): Promise<{ instruction: string }> {
  parseVaultRef(args.ref);
  return {
    instruction:
      `Ask the user to run \`vaultic set ${args.ref}\` in their own terminal. ` +
      'The value is entered by the human via hidden prompt; the AI never sees it.',
  };
}
```

**Step 4:** Run — PASS. **Step 5: Commit:** `git commit -m "broker: onaylı reveal ve set-request tool'ları eklendi"`

### Task 13: MCP server kablolama (stdio)

**Files:**
- Create: `packages/broker/src/server.ts`
- Modify: `packages/broker/package.json` (bin alanı)
- Test: `packages/broker/test/server.test.ts`

**Step 1: Failing test** — SDK'nın in-memory transport'u ile tool listesini doğrula:

```typescript
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/server.js';
import type { VaultBackend } from '../src/backend.js';

const backend: VaultBackend = {
  listSecrets: async () => [{ key: 'K1', environment: 'prod' }],
  getSecretValue: async () => 'sk-test-srv-12345678',
  setSecret: async () => {},
};

describe('buildServer', () => {
  it('6 tool kayıtlıdır ve vault_list değer döndürmez', async () => {
    const server = buildServer({ backend, projectDir: '/tmp' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'vault_check', 'vault_list', 'vault_ref', 'vault_reveal_request', 'vault_run', 'vault_set_request',
    ]);

    const result = await client.callTool({
      name: 'vault_list',
      arguments: { workspace: 'ws', project: 'proj', environment: 'prod' },
    });
    expect(JSON.stringify(result)).not.toContain('sk-test-srv');
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement**

`packages/broker/src/server.ts` (shebang ilk satırda — tsc korur):
```typescript
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
import { vaultCheck, vaultList, vaultRef } from './tools/readonly.js';
import { vaultRun } from './tools/run.js';
import { vaultRevealRequest, vaultSetRequest } from './tools/reveal.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}
function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

export function buildServer(deps: { backend: VaultBackend; projectDir: string }): McpServer {
  const { backend, projectDir } = deps;
  const server = new McpServer({ name: 'vaultic', version: '0.1.0' });
  const fingerprints = new FingerprintStore(fingerprintPath());
  const audit = new AuditLog(join(configDir(), 'audit.jsonl'));
  const manifest = () => loadManifest(projectDir);

  server.registerTool('vault_check',
    { description: 'Check which secrets the project manifest (.aiv.yaml) needs and which exist in the vault. Never returns values.', inputSchema: {} },
    async () => { try { return ok(await vaultCheck({ backend, manifest: manifest() })); } catch (e) { return fail(e); } });

  server.registerTool('vault_list',
    { description: 'List secret NAMES and metadata in a scope. Never returns values.',
      inputSchema: { workspace: z.string(), project: z.string(), environment: z.string() } },
    async (args) => { try { return ok(await vaultList({ backend }, args)); } catch (e) { return fail(e); } });

  server.registerTool('vault_ref',
    { description: 'Build a vault:// reference string to embed in code/config instead of a real value.',
      inputSchema: { workspace: z.string(), project: z.string(), environment: z.string(), key: z.string() } },
    async (args) => { try { return ok({ ref: vaultRef(args) }); } catch (e) { return fail(e); } });

  server.registerTool('vault_run',
    { description: 'Run a shell command with manifest secrets injected as env vars. Output is redacted. Use this instead of asking for values.',
      inputSchema: { command: z.string(), cwd: z.string().optional(), timeoutMs: z.number().optional() } },
    async (args) => {
      try {
        const result = await vaultRun({ backend, manifest: manifest(), fingerprints }, args);
        audit.record({ action: 'run', detail: args.command.slice(0, 200) });
        return ok(result);
      } catch (e) { return fail(e); }
    });

  server.registerTool('vault_reveal_request',
    { description: 'LAST RESORT: request one-time reveal of a secret value. Requires human approval (Touch ID / Telegram). Audited.',
      inputSchema: { ref: z.string(), reason: z.string() } },
    async (args) => {
      try {
        const credentials = loadCredentials();
        const config = loadConfig();
        const approver = resolveApprover({
          approvers: [
            new TouchIdApprover({ helperPath: join(homedir(), '.config', 'vaultic', 'vaultic-auth-helper') }),
            new TelegramApprover({
              botToken: credentials.telegramBotToken,
              allowedUserId: config.approval?.telegramAllowedUserId,
            }),
          ],
        });
        return ok(await vaultRevealRequest({ backend, approver, audit, fingerprints }, args));
      } catch (e) { return fail(e); }
    });

  server.registerTool('vault_set_request',
    { description: 'Request creation of a new secret. The HUMAN enters the value via `vaultic set` in their terminal — never paste values here.',
      inputSchema: { ref: z.string() } },
    async (args) => { try { return ok(await vaultSetRequest(args)); } catch (e) { return fail(e); } });

  return server;
}

const isDirectRun = process.argv[1]?.endsWith('server.js');
if (isDirectRun) {
  const config = loadConfig();
  const credentials = loadCredentials();
  const backend = new InfisicalBackend({ config, credentials });
  const server = buildServer({ backend, projectDir: process.env.CLAUDE_PROJECT_DIR ?? process.cwd() });
  await server.connect(new StdioServerTransport());
  console.error('vaultic-broker running on stdio');
}
```

`packages/broker/package.json`'a ekle: `"bin": { "vaultic-broker": "dist/server.js" }`

**Step 4:** Run: `pnpm vitest run packages/broker` — Expected: tümü PASS. `pnpm build` — hatasız.

**Step 5: Commit:** `git commit -m "broker: mcp server kablolaması ve stdio girişi eklendi"`

---

## Faz 3 — Hook'lar

### Task 14: PreToolUse guard (fingerprint + regex + korumalı yollar)

**Files:**
- Create: `hooks/vaultic-pretooluse.mjs`
- Test: `packages/broker/test/hook-pretooluse.test.ts` (script'i child process olarak çalıştırır)

Tasarım: script `tool_input`'un TAMAMINI string'e serileştirip tarar — Claude'un Write/Edit/Bash şemaları VE Codex'in `apply_patch` patch metni aynı kodla yakalanır. Ek olarak korumalı yol kontrolü: `~/.config/vaultic/` altına dokunan her tool çağrısı deny.

**Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { FingerprintStore } from '@vaultic/shared';

const pExecFile = promisify(execFile);
const HOOK = join(process.cwd(), 'hooks', 'vaultic-pretooluse.mjs');
const SECRET = 'sk-test-HookSecret246813579';

async function runHook(input: object, configDir: string) {
  const { stdout } = await pExecFile('node', [HOOK], {
    env: { ...process.env, VAULTIC_CONFIG_DIR: configDir },
    // stdin'e JSON yaz
    ...({} as object),
  }).catch((e) => e);
  return stdout ? JSON.parse(stdout) : undefined;
}
// Not: execFile stdin yazımı için spawn kullan — implementasyonda spawn + stdin.end(JSON.stringify(input)) tercih et.

function makeConfigDirWithSecret(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-'));
  const store = new FingerprintStore(join(dir, 'fingerprints.json'));
  store.addValue(SECRET);
  return dir;
}

describe('vaultic-pretooluse hook', () => {
  it('Write içinde bilinen secret → deny', async () => {
    const out = await runHook({
      hook_event_name: 'PreToolUse', tool_name: 'Write',
      tool_input: { file_path: '/tmp/x.ts', content: `const k = "${SECRET}";` },
    }, makeConfigDirWithSecret());
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });
  it('Bash komutunda generic OpenAI pattern → deny', async () => {
    const out = await runHook({
      hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: 'export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuv1234' },
    }, makeConfigDirWithSecret());
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });
  it('vaultic config dizinine dokunan Bash → deny', async () => {
    const out = await runHook({
      hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: `cat ${homedir()}/.config/vaultic/credentials.json` },
    }, makeConfigDirWithSecret());
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });
  it('temiz Write → karar yok (boş çıktı, exit 0)', async () => {
    const out = await runHook({
      hook_event_name: 'PreToolUse', tool_name: 'Write',
      tool_input: { file_path: '/tmp/x.ts', content: 'console.log(1)' },
    }, makeConfigDirWithSecret());
    expect(out).toBeUndefined();
  });
});
```

(Testteki `runHook` yardımcısını `spawn` + `child.stdin.end(JSON.stringify(input))` ile yaz — execFile stdin vermez.)

**Step 2:** Run — FAIL.

**Step 3: Implement**

`hooks/vaultic-pretooluse.mjs`:
```javascript
#!/usr/bin/env node
// Bağımsız script: @vaultic/shared'e import bağımlılığı YOK (global kurulumda
// node_modules garantisi olmadığı için fingerprint/pattern mantığı burada inline).
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MIN_TOKEN_LENGTH = 8;
const TOKEN_SPLIT = /[^A-Za-z0-9+/=_\-.~]+/;
const GENERIC_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const configDir = process.env.VAULTIC_CONFIG_DIR ?? join(homedir(), '.config', 'vaultic');

function loadPrints() {
  const path = join(configDir, 'fingerprints.json');
  if (!existsSync(path)) return { salt: '', prints: new Set() };
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return { salt: data.salt, prints: new Set(data.prints) };
}

function containsFingerprinted(text, { salt, prints }) {
  if (prints.size === 0) return false;
  for (const token of text.split(TOKEN_SPLIT)) {
    if (token.length < MIN_TOKEN_LENGTH) continue;
    if (prints.has(createHash('sha256').update(salt + token).digest('hex'))) return true;
  }
  return false;
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

const input = JSON.parse(readFileSync(0, 'utf8'));
const serialized = JSON.stringify(input.tool_input ?? {});

const protectedDir = join(homedir(), '.config', 'vaultic');
if (serialized.includes(protectedDir) || serialized.includes('.config/vaultic')) {
  deny('vaultic: the vaultic config/credential store is off-limits to agents');
}
if (containsFingerprinted(serialized, loadPrints())) {
  deny('vaultic: known secret value detected in tool input — use vault:// references or vault_run instead');
}
for (const pattern of GENERIC_PATTERNS) {
  if (pattern.test(serialized)) {
    deny('vaultic: secret-shaped string detected — store it with `vaultic set` and use a vault:// reference');
  }
}
process.exit(0);
```

**Step 4:** Run — PASS. Edge: hook kendi hatasında da güvenli olmalı — JSON parse hatasında `process.exit(0)` (fail-open sadece parse hatasında; bilinçli karar: aksi tüm tool'ları kilitler. Not düş).

**Step 5: Commit:** `git commit -m "hook: pretooluse fingerprint ve regex koruması eklendi"`

### Task 15: SessionStart hook'u

**Files:**
- Create: `hooks/vaultic-sessionstart.mjs`
- Test: `packages/broker/test/hook-sessionstart.test.ts`

**Step 1: Failing test** — manifest'li dizinde additionalContext üretir; manifest yoksa sessiz çıkar:

```typescript
import { describe, it, expect } from 'vitest';
// runHook benzeri spawn yardımcıyla:
// CLAUDE_PROJECT_DIR=manifestli tmp dizin → stdout JSON'da additionalContext
//   "payment-api" ve "OPENAI_API_KEY" içerir, vault_check kullanımını tarif eder.
// manifest'siz dizin → stdout boş, exit 0.
```

(Test gövdesini Task 14'teki spawn yardımcısını ortak bir `test/helpers/spawn-hook.ts` dosyasına çıkararak yaz — DRY.)

**Step 2:** Run — FAIL.

**Step 3: Implement**

`hooks/vaultic-sessionstart.mjs`:
```javascript
#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const manifestPath = join(projectDir, '.aiv.yaml');
if (!existsSync(manifestPath)) process.exit(0);

const raw = readFileSync(manifestPath, 'utf8');
const needs = [...raw.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
const mode = /mode:\s*paranoid/.test(raw) ? 'paranoid' : 'standard';

const context = [
  `vaultic active (mode: ${mode}). This project declares ${needs.length} secret(s) in .aiv.yaml: ${needs.join(', ')}.`,
  'Rules: (1) NEVER ask for or write real secret values. (2) Use vault_check to see status,',
  'vault_ref for references in code/config, vault_run to execute commands that need secrets.',
  '(3) One-time value access only via vault_reveal_request (requires human approval).',
].join(' ');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
}));
```

(Bilinçli sadelik: YAML'ı regex ile okuyoruz — hook'un bağımlılığı yok ve `needs` blok formatı Task 3'te sabitlendi. Network çağrısı YOK: SessionStart gecikmesi yaratmamak için durum sorgusu AI'nın ilk `vault_check` çağrısına bırakıldı.)

**Step 4:** Run — PASS. **Step 5: Commit:** `git commit -m "hook: sessionstart manifest bildirimi eklendi"`

---

## Faz 4 — vaultic CLI

### Task 16: CLI iskeleti + login + link

**Files:**
- Create: `packages/cli/src/index.ts`, `packages/cli/src/commands/login.ts`, `packages/cli/src/commands/link.ts`
- Modify: `packages/cli/package.json` (`"bin": { "vaultic": "dist/index.js" }`)
- Test: `packages/cli/test/login.test.ts`

`vaultic login`: `--site-url`, `--client-id` flag'leri; clientSecret ve (opsiyonel `--telegram`) bot token'ı **gizli prompt** ile alınır (`node:readline` + `output.write` maskeleme ya da minimal kendi raw-mode okuyucumuz — ek bağımlılık alma). `credentials.json` 0600 yazılır. `vaultic link <ws>/<proj> <projectId>`: config.json'daki eşlemeyi günceller.

**Step 1: Failing test** — `writeCredentials`/`writeProjectLink` saf fonksiyonlarını test et (prompt'u değil):

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCredentials } from '../src/commands/login.js';
import { writeProjectLink } from '../src/commands/link.js';

describe('writeCredentials', () => {
  it('credentials.json 0600 ile yazılır', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-'));
    writeCredentials(dir, { clientId: 'a', clientSecret: 'b' });
    expect(statSync(join(dir, 'credentials.json')).mode & 0o777).toBe(0o600);
  });
});

describe('writeProjectLink', () => {
  it('mevcut config\'e workspace/proje ekler', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-'));
    writeCredentials(dir, { clientId: 'a', clientSecret: 'b' });
    writeProjectLink(dir, 'https://inf.example.com', 'ws1/proj1', 'pid-9');
    const cfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(cfg.workspaces.ws1.projects.proj1.projectId).toBe('pid-9');
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement** — `login.ts`/`link.ts` saf yazma fonksiyonları + `index.ts`'te commander kaydı:

```typescript
// packages/cli/src/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { registerLogin } from './commands/login.js';
import { registerLink } from './commands/link.js';

const program = new Command('vaultic').description('AI credentials vault — human-side CLI').version('0.1.0');
registerLogin(program);
registerLink(program);
program.parseAsync();
```

`writeCredentials(dir, creds)`: `mkdirSync(dir, {recursive: true, mode: 0o700})` + `writeFileSync` + `chmodSync(0o600)`. `writeProjectLink(dir, siteUrl, wsProj, projectId)`: config.json'ı oku-veya-başlat (`{siteUrl, workspaces:{}}`), `ws/proj` parse et, eşlemeyi yaz. Komut handler'ları bu fonksiyonları çağırır; gizli prompt `process.stdin` raw mode ile yazılır (yankısız okuma, Ctrl-C iptal).

**Step 4:** Run — PASS. **Step 5: Commit:** `git commit -m "cli: login ve link komutları eklendi"`

### Task 17: vaultic init + check + set

**Files:**
- Create: `packages/cli/src/commands/init.ts`, `packages/cli/src/commands/check.ts`, `packages/cli/src/commands/set.ts`
- Test: `packages/cli/test/init.test.ts`, `packages/cli/test/set.test.ts`

- `vaultic init --workspace ws --project proj [--env prod]`: `.aiv.yaml` şablonu yazar (varsa üzerine yazmaz, hata verir) + `.gitignore`'a `.env` ekler (yoksa) + gitleaks pre-commit önerisini basar.
- `vaultic check`: manifest + InfisicalBackend ile `vaultCheck` çağırır, tablo basar (broker'daki saf fonksiyon yeniden kullanılır — `packages/cli`, `vaultic-broker`'a workspace bağımlılığı alır).
- `vaultic set <ref>`: değeri gizli prompt'la alır, `backend.setSecret` çağırır, fingerprint store'a ekler, audit'e yazar. **Değer asla argv ile alınmaz** (shell history sızıntısı) — argv'de değer verilirse reddet.

**Step 1: Failing test** (`init` şablon doğruluğu + ikinci çağrının hatası; `set`'in argv değer reddi — saf `assertNoValueInArgv` fonksiyonu):

```typescript
// init.test.ts: writeManifestTemplate(dir, {workspace, project, env}) →
//   .aiv.yaml içerik doğrulaması (loadManifest ile parse edilebilmeli),
//   ikinci çağrı /already exists/ fırlatmalı.
// set.test.ts: assertNoValueInArgv(['vault://w/p/e/K', 'sk-live-...']) → throw /never pass values/
```

**Step 2-4:** FAIL → implement → PASS. (Şablon: Task 3'teki VALID manifest yapısı; `needs` başlangıçta boş object yorum satırıyla.)

**Step 5: Commit:** `git commit -m "cli: init, check ve set komutları eklendi"`

### Task 18: vaultic share + run

**Files:**
- Create: `packages/cli/src/commands/share.ts`, `packages/cli/src/commands/run.ts`
- Test: `packages/cli/test/share.test.ts`

- `vaultic share <ws>/<proj>`: v1 kapsamı — Infisical proje erişim sayfası URL'ini üretir (`{siteUrl}/project/{projectId}/access-management`) ve `open`/`xdg-open` ile açar; "default private, seçimli paylaşım" Infisical UI üzerinden yürür. (API tabanlı davet v1.1 — plan dışı.)
- `vaultic run [-- cmd...]`: broker'daki `vaultRun`'ı CLI'dan kullanır (AI'sız insan akışı). `--paranoid` bayrağı Task 20'de.

**Step 1: Failing test** (`buildShareUrl(config, 'ws1/proj1')` → doğru URL; eşlenmemiş proje → `vaultic link` öneren hata).
**Step 2-4:** FAIL → implement → PASS.
**Step 5: Commit:** `git commit -m "cli: share ve run komutları eklendi"`

---

## Faz 5 — Touch ID helper

### Task 19: Swift helper + derleme

**Files:**
- Create: `helpers/touchid/vaultic-auth-helper.swift`, `helpers/touchid/build.sh`

Doğrulandı (2026-06-10, bu makinede): `swiftc` çıktısı ad-hoc/linker imzayla LAContext'e erişiyor, app bundle GEREKMİYOR. Politika: `.deviceOwnerAuthentication` (Touch ID + parola fallback). Her istek yeni process = her istek yeni LAContext (reuse güvenliği doğal).

**Step 1: Helper'ı yaz**

`helpers/touchid/vaultic-auth-helper.swift`:
```swift
import LocalAuthentication
import Foundation

// Exit codes: 0=approved, 1=denied/error, 2=biometry unavailable, 3=user cancel
let reason = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "vaultic approval"
let context = LAContext()
context.touchIDAuthenticationAllowableReuseDuration = 0

var error: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
    FileHandle.standardError.write("biometry unavailable: \(error?.localizedDescription ?? "unknown")\n".data(using: .utf8)!)
    exit(2)
}

let semaphore = DispatchSemaphore(value: 0)
var exitCode: Int32 = 1
context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, evalError in
    if success {
        exitCode = 0
    } else if let laError = evalError as? LAError, laError.code == .userCancel {
        exitCode = 3
    }
    semaphore.signal()
}
semaphore.wait()
exit(exitCode)
```

`helpers/touchid/build.sh`:
```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O vaultic-auth-helper.swift -o vaultic-auth-helper
echo "built: $(pwd)/vaultic-auth-helper"
codesign -dv vaultic-auth-helper 2>&1 | head -2
```

**Step 2: Derle ve elle doğrula**

Run: `bash helpers/touchid/build.sh`
Expected: binary oluşur, codesign çıktısında `adhoc` görünür.
Run (elle, fiziksel onayla): `./helpers/touchid/vaultic-auth-helper "vaultic test" && echo APPROVED`
Expected: Touch ID prompt'u açılır; onayda `APPROVED` basılır. (Bu adım insan etkileşimi ister — executing agent burada kullanıcıdan doğrulamayı İSTEMELİ, atlamamalı.)

**Step 3: Commit:** `git commit -m "helper: touch id swift yardımcısı eklendi"`

---

## Faz 6 — Paranoid mod (agent-vault)

### Task 20: agent-vault entegrasyon paketi

**Files:**
- Create: `deploy/agent-vault/README.md`, `deploy/agent-vault/services.example.yaml`
- Modify: `packages/cli/src/commands/run.ts` (`--paranoid` bayrağı)

Doğrulanmış kısıtlar (README'ye AYNEN yazılacak):
- **v0.32.0'a pinle** — research preview, API değişebilir.
- Ajan ile agent-vault **farklı host'ta** çalışmalı (aynı makinede ajan SQLite/DEK'e erişebilir). Lokal tek-makine kullanımında bu güvenlik garantisinin DÜŞTÜĞÜNÜ açıkça yaz.
- Proxy auth token'ı ajan↔broker arası düz metin (`http://` proxy) — sadece localhost/VPN/private subnet.
- **Infisical kopunca fail-open**: cache'lenmiş snapshot sunulmaya devam eder; revoke edilen secret poll aralığı boyunca yaşar. `--poll-interval-seconds` düşük tut (60).
- Placeholder formatı: `__openai_api_key__` (min 4 karakter, `__` zorunlu kuralına uyar).
- `NO_PROXY` varsayılanı dar — ajanın iç servisleri için genişlet; tanımsız host'lara `passthrough` servis ekle.

`services.example.yaml`:
```yaml
services:
  - name: anthropic
    host: api.anthropic.com
    auth:
      type: api-key
      header: x-api-key
      key: ANTHROPIC_API_KEY
  - name: openai
    host: api.openai.com
    auth:
      type: bearer
      key: OPENAI_API_KEY
  - name: github
    host: api.github.com
    auth:
      type: bearer
      key: GITHUB_TOKEN
```

`vaultic run --paranoid -- <cmd>`: `agent-vault` binary'sinin PATH'te olduğunu doğrula (yoksa kurulum komutunu yazdır: `curl -sSL https://get.agent-vault.dev | sh` + sürüm pin notu), sonra `agent-vault run -- <cmd>`'e exec ile devret.

**Step 1:** Test — `assertAgentVaultAvailable(execLookup)` saf fonksiyonu: PATH'te yoksa kurulum yönergeli hata. FAIL → implement → PASS.
**Step 2: Commit:** `git commit -m "paranoid: agent-vault entegrasyon paketi ve bayrağı eklendi"`

---

## Faz 7 — Dağıtım

### Task 21: Infisical self-host compose paketi

**Files:**
- Create: `deploy/README.md`, `deploy/.env.example`

Resmi `docker-compose.prod.yml` upstream'den indirilir (kendi kopyamızı bayatlatmamak için). `deploy/README.md` adımları:
```bash
cd deploy
curl -fsSLO https://raw.githubusercontent.com/Infisical/infisical/main/docker-compose.prod.yml
curl -fsSL https://raw.githubusercontent.com/Infisical/infisical/main/.env.example -o .env
# .env'i doldur:
#   ENCRYPTION_KEY=$(openssl rand -hex 16)   # SONRADAN DEĞİŞTİRİLEMEZ — yedekle!
#   AUTH_SECRET=$(openssl rand -base64 32)
#   SITE_URL=https://vault.example.com        # lokalde http://localhost:80
# İmajı pinle: compose dosyasında infisical/infisical:<sürüm> — 'latest' KULLANMA
docker compose -f docker-compose.prod.yml up -d
```
README'ye yazılacak doğrulanmış uyarılar: ilk signup yapan instance admin olur (internete açık kurulumda önce firewall); ENCRYPTION_KEY kaybı = tüm veri kaybı; SMTP yoksa davet akışı çalışmaz (tek kullanıcıda atlanabilir); machine identity kurulumu (Org Settings → Identities → Universal Auth → Create Client Secret → projeye Developer rolüyle ekle) adım adım; sunucu deploy'unda `curl -sk https://HOST/.env` leak testi 404 dönmeli.

**Commit:** `git commit -m "deploy: infisical self-host kurulum paketi eklendi"`

### Task 22: Claude Code skill'i

**Files:**
- Create: `skill/vaultic/SKILL.md`

```markdown
---
name: vaultic
description: Use when the project needs API keys/secrets, when a .aiv.yaml exists, when the user mentions credentials, .env files, or API keys — secure vault workflow that never exposes secret values to the AI.
---

# vaultic — Secure Credentials Workflow

## The Rule
NEVER ask the user to paste a secret. NEVER write a real secret value into any file, command, or message. Values live in the vault; you work with references.

## Workflow
1. Session start: if `.aiv.yaml` exists, call `vault_check` to see what's available/missing.
2. Need a secret in code/config? Write the env var name; add the mapping to `.aiv.yaml` via `vault_ref`.
3. Need to RUN something that uses secrets? Use `vault_run` — values are injected into the child process env and redacted from output.
4. Missing secret? Call `vault_set_request` — it instructs the user to run `vaultic set <ref>` in their own terminal. Do not collect the value yourself.
5. Genuinely need to SEE a value (rare: pasting into an external dashboard for the user)? `vault_reveal_request` with a clear reason — the human approves via Touch ID/Telegram. Never write the revealed value to disk.

## Red flags — STOP if you catch yourself:
- Writing `sk-...`, `AKIA...`, `ghp_...` or any literal token anywhere
- Asking "can you share the API key?"
- Copying .env contents into another file
Hooks will block these; don't fight the hooks, use the tools above.
```

**Commit:** `git commit -m "skill: vaultic claude code skill'i eklendi"`

### Task 23: install.sh

**Files:**
- Create: `install.sh`

Adımlar (idempotent, `set -euo pipefail`):
1. Node ≥20 + pnpm kontrolü → `pnpm install && pnpm build`.
2. `npm link` yerine mutlak yol kullan: `~/.claude/settings.json`'a `jq` ile hook kayıtları merge et (yedek alarak):
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Write|Edit|Bash",
      "hooks": [{ "type": "command", "command": "node <REPO>/hooks/vaultic-pretooluse.mjs", "timeout": 10 }]
    }],
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "node <REPO>/hooks/vaultic-sessionstart.mjs", "timeout": 5 }]
    }]
  }
}
```
3. Skill kopyala: `skill/vaultic/` → `~/.claude/skills/vaultic/` (varsa diff göster, üzerine yazmadan önce sor).
4. MCP kaydı: `claude mcp add vaultic --scope user -- node <REPO>/packages/broker/dist/server.js` (komut yoksa `.mcp.json` snippet'ini bas).
5. macOS ise: `bash helpers/touchid/build.sh` + binary'yi `~/.config/vaultic/vaultic-auth-helper`'a kopyala.
6. Codex kuruluysa (`~/.codex` var): `~/.codex/hooks.json`'a aynı hook'ları yaz + **kullanıcıya Codex'te `/hooks` ile trust onayı gerektiğini söyle** (hash bazlı; her hook değişikliğinde yeniden onay). Codex notu: `apply_patch` matcher'ı `Edit|Write` alias'ı ile çalışır; `permissionDecision: "ask"` Codex'te DESTEKLENMEZ — sadece `deny` kullanıyoruz, sorun yok.
7. `gitleaks` kontrolü: yoksa `brew install gitleaks` öner.
8. Son çıktı: kalan manuel adımlar listesi (Infisical kurulumu, `vaultic login`, `vaultic link`, `vaultic init`).

Doğrulama: `bash install.sh` temiz ortam değişkenleriyle çalıştırılıp `claude mcp list` çıktısında `vaultic` görünmeli; testlerin tamamı `pnpm test` ile yeşil olmalı.

**Commit:** `git commit -m "dağıtım: install.sh kurulum betiği eklendi"`

### Task 24: README + uçtan uca doğrulama

**Files:**
- Create: `README.md`

İçerik: ne/neden (GitGuardian 2026 verisiyle motivasyon), mimari diyagram (ASCII), hızlı başlangıç (deploy → login → link → init → Claude Code'da kullanım), güvenlik modeli tablosu (tasarım dokümanındaki katman→saldırı matrisi), tehdit modeli sınırları (fingerprint token-split bypass'ı, agent-vault fail-open, paranoid modda aynı-makine zafiyeti — DÜRÜSTÇE), Codex farkları, katkı rehberi.

**Uçtan uca doğrulama (insan + AI birlikte):**
1. `docker compose up` ile lokal Infisical, ilk admin + machine identity + test projesi.
2. `vaultic login && vaultic link && vaultic init` + `vaultic set vault://.../TEST_KEY`.
3. Claude Code'da yeni session: SessionStart bildirimi görünmeli; `vault_check` doğru rapor vermeli; `vault_run 'echo $TEST_KEY'` çıktısı `[vaultic:redacted]` olmalı.
4. AI'dan secret'ı dosyaya yazmasını İSTE → PreToolUse deny görmeli.
5. `vault_reveal_request` → Touch ID prompt'u → onayda değer tek seferlik gelmeli, audit.jsonl'a kayıt düşmeli.

**Commit:** `git commit -m "dokümantasyon: readme ve uçtan uca doğrulama eklendi"`

---

## Bilinçli kapsam kesintileri (v1.1+ adayları)
- API tabanlı `vaultic share` daveti (v1: Infisical UI'ya yönlendirme)
- StreamableHTTP uzak broker (v1: stdio; SDK'da `createMcpExpressApp` hazır, iskelet uygun)
- Linux polkit onayı (v1: Linux'ta Telegram birincil)
- Fingerprint sliding-window taraması (v1: token bazlı + regex; bypass sınırı README'de)
- agent-vault fail-open telafisi (upstream issue takibi)
