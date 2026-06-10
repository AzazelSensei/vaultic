import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const MIN_SECRET_LENGTH = 8;
const MIN_TOKEN_LENGTH = 8;
const TOKEN_SPLIT = /[^A-Za-z0-9+/=_\-.~%]+/;

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
