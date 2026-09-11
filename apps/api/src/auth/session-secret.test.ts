import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generateSessionSecret,
  loadOrCreateSessionSecret,
} from './session-secret';

const scratchEnv = (contents?: string): string => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), 'payout-env-')),
    '.env',
  );
  if (contents !== undefined) {
    writeFileSync(file, contents, 'utf8');
  }
  return file;
};

describe('generateSessionSecret', () => {
  it('is 32 bytes of randomness, base64url encoded', () => {
    const secret = generateSessionSecret();

    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
  });

  it('is different every time', () => {
    const secrets = new Set(
      Array.from({ length: 50 }, () => generateSessionSecret()),
    );

    expect(secrets.size).toBe(50);
  });
});

describe('loadOrCreateSessionSecret', () => {
  it('prefers a real environment variable over the file', () => {
    const file = scratchEnv('SESSION_SECRET=from-the-file\n');

    const result = loadOrCreateSessionSecret(file, {
      SESSION_SECRET: 'from-the-environment',
    });

    expect(result).toEqual({
      secret: 'from-the-environment',
      source: 'environment',
    });
  });

  it('reads one out of the file when the environment has none', () => {
    const file = scratchEnv('SESSION_SECRET=from-the-file\n');

    expect(loadOrCreateSessionSecret(file, {})).toEqual({
      secret: 'from-the-file',
      source: 'file',
    });
  });

  it('ignores comments and blank lines', () => {
    const file = scratchEnv(
      '# a comment\n\n  # SESSION_SECRET=commented-out\nSESSION_SECRET=real\n',
    );

    expect(loadOrCreateSessionSecret(file, {}).secret).toBe('real');
  });

  it('strips one layer of quotes', () => {
    const file = scratchEnv('SESSION_SECRET="quoted-value"\n');

    expect(loadOrCreateSessionSecret(file, {}).secret).toBe('quoted-value');
  });

  it('ignores a key that merely starts the same way', () => {
    const file = scratchEnv('SESSION_SECRET_OLD=wrong\nSESSION_SECRET=right\n');

    expect(loadOrCreateSessionSecret(file, {}).secret).toBe('right');
  });

  describe('first run', () => {
    it('generates one and writes it to a file that does not exist yet', () => {
      const file = scratchEnv();

      const result = loadOrCreateSessionSecret(file, {});

      expect(result.source).toBe('generated');
      expect(readFileSync(file, 'utf8')).toContain(
        `SESSION_SECRET=${result.secret}`,
      );
    });

    it('is stable on the second call — it reads back what it wrote', () => {
      const file = scratchEnv();

      const first = loadOrCreateSessionSecret(file, {});
      const second = loadOrCreateSessionSecret(file, {});

      expect(second.secret).toBe(first.secret);
      expect(second.source).toBe('file');
    });

    it('appends, so hand-written settings survive', () => {
      const file = scratchEnv('PAYOUT_DB=/somewhere/else/app.db\n');

      loadOrCreateSessionSecret(file, {});

      expect(readFileSync(file, 'utf8')).toContain(
        'PAYOUT_DB=/somewhere/else/app.db',
      );
    });

    it('adds the missing newline rather than joining two settings', () => {
      const file = scratchEnv('PAYOUT_DB=/somewhere/app.db');

      loadOrCreateSessionSecret(file, {});

      const written = readFileSync(file, 'utf8');
      expect(written).not.toContain('app.dbSESSION_SECRET');
      expect(written).toMatch(/^SESSION_SECRET=/m);
    });

    it('treats an empty value as absent', () => {
      const file = scratchEnv('SESSION_SECRET=\n');

      expect(loadOrCreateSessionSecret(file, {}).source).toBe('generated');
    });

    it('treats an empty environment variable as absent', () => {
      const file = scratchEnv('SESSION_SECRET=from-the-file\n');

      expect(
        loadOrCreateSessionSecret(file, { SESSION_SECRET: '' }).source,
      ).toBe('file');
    });
  });
});
