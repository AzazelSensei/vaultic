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
