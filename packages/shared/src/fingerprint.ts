import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as z from 'zod';

const MIN_SECRET_LENGTH = 8;
const MIN_TOKEN_LENGTH = 8;
const SALT_BYTES = 16;
const TOKEN_SPLIT = /[^A-Za-z0-9+/=_\-.~%]+/;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const StoreFileSchema = z.strictObject({
  salt: z.string().min(1),
  prints: z.array(z.string()),
});

type StoreFile = z.infer<typeof StoreFileSchema>;

export class FingerprintStore {
  readonly filePath: string;
  private salt: string;
  private prints: Set<string>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureFile();
    const data = this.readFile();
    this.salt = data.salt;
    this.prints = new Set(data.prints);
  }

  private ensureFile(): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: DIR_MODE });
    const fresh: StoreFile = { salt: randomBytes(SALT_BYTES).toString('hex'), prints: [] };
    try {
      writeFileSync(this.filePath, JSON.stringify(fresh), { flag: 'wx', mode: FILE_MODE });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }

  private readFile(): StoreFile {
    const raw = readFileSync(this.filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`vaultic fingerprint store corrupt: ${this.filePath}`);
    }
    const result = StoreFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`vaultic fingerprint store corrupt: ${this.filePath}`);
    }
    return result.data;
  }

  private writeAtomic(data: StoreFile): void {
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data), { mode: FILE_MODE });
    renameSync(tmpPath, this.filePath);
  }

  private hashWith(salt: string, value: string): string {
    return createHash('sha256').update(salt + value).digest('hex');
  }

  addValue(value: string): void {
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(`Refusing to fingerprint value: too short (<${MIN_SECRET_LENGTH} chars)`);
    }
    const disk = this.readFile();
    const merged = new Set(disk.prints);
    for (const variant of [value, Buffer.from(value).toString('base64'), encodeURIComponent(value)]) {
      merged.add(this.hashWith(disk.salt, variant));
    }
    this.writeAtomic({ salt: disk.salt, prints: [...merged] });
    this.salt = disk.salt;
    this.prints = merged;
  }

  containsSecret(text: string): boolean {
    const disk = this.readFile();
    this.salt = disk.salt;
    this.prints = new Set(disk.prints);
    if (this.prints.size === 0) return false;
    for (const token of text.split(TOKEN_SPLIT)) {
      if (this.matchesToken(token)) return true;
    }
    return false;
  }

  private matchesToken(token: string): boolean {
    if (token.length >= MIN_TOKEN_LENGTH && this.prints.has(this.hashWith(this.salt, token))) {
      return true;
    }
    const eq = token.lastIndexOf('=');
    if (eq === -1) return false;
    const tail = token.slice(eq + 1);
    return tail.length >= MIN_TOKEN_LENGTH && this.prints.has(this.hashWith(this.salt, tail));
  }
}
