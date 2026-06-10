import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '../src/audit.js';

describe('AuditLog', () => {
  it('JSONL satırı ekler, ts ISO formatında', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'audit-')), 'audit.jsonl');
    const log = new AuditLog(path);
    log.record({ action: 'reveal', ref: 'vault://ws/p/prod/KEY', decision: 'approved', channel: 'touchid' });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[0]);
    expect(entry.action).toBe('reveal');
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('birden çok satırı sırayla ekler', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'audit-')), 'audit.jsonl');
    const log = new AuditLog(path);
    log.record({ action: 'check' });
    log.record({ action: 'run', detail: 'echo hi' });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).action).toBe('run');
  });
  it('dosya izni 0600', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'audit-')), 'audit.jsonl');
    new AuditLog(path).record({ action: 'list' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it('detail 200 karaktere kısaltılır', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'audit-')), 'audit.jsonl');
    new AuditLog(path).record({ action: 'run', detail: 'x'.repeat(500) });
    const entry = JSON.parse(readFileSync(path, 'utf8').trim());
    expect(entry.detail.length).toBeLessThanOrEqual(200);
    expect(entry.detail.endsWith('…')).toBe(true);
  });
});
