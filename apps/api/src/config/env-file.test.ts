import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { chainLookupFrom } from '../main';

import { readEnvFileValue, settingValue } from './env-file';

/**
 * Settings that live in `.env`, and the bug that made this file exist.
 *
 * F29 read its API key straight off `process.env`, which nothing ever loads
 * `.env` into — so a key written into the file was invisible and the
 * interface reported it as missing. The last describe is that wiring, tested
 * where it broke rather than one layer below it.
 */

const envFile = (contents: string): string => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), 'payout-env-')),
    '.env',
  );
  writeFileSync(file, contents, 'utf8');

  return file;
};

describe('readEnvFileValue', () => {
  it('reads a value, and ignores comments and blank lines', () => {
    const file = envFile('# a note\n\nETHERSCAN_API_KEY=ABC123\n');

    expect(readEnvFileValue(file, 'ETHERSCAN_API_KEY')).toBe('ABC123');
  });

  it('strips one layer of quotes, and nothing else', () => {
    const file = envFile('ETHERSCAN_API_KEY="ABC123"\n');

    expect(readEnvFileValue(file, 'ETHERSCAN_API_KEY')).toBe('ABC123');
  });

  it('is not fooled by a key that merely starts the same', () => {
    const file = envFile('ETHERSCAN_API_KEY_OLD=wrong\nETHERSCAN_API_KEY=right\n');

    expect(readEnvFileValue(file, 'ETHERSCAN_API_KEY')).toBe('right');
  });

  it('answers null for a file that is not there', () => {
    expect(readEnvFileValue('/no/such/.env', 'ANYTHING')).toBeNull();
  });
});

describe('settingValue', () => {
  it('prefers a real environment variable to the file', () => {
    const file = envFile('ETHERSCAN_API_KEY=from-the-file\n');

    expect(
      settingValue('ETHERSCAN_API_KEY', file, {
        ETHERSCAN_API_KEY: 'from-the-environment',
      }),
    ).toBe('from-the-environment');
  });

  it('falls back to the file, which is where a person puts it', () => {
    const file = envFile('ETHERSCAN_API_KEY=from-the-file\n');

    expect(settingValue('ETHERSCAN_API_KEY', file, {})).toBe('from-the-file');
  });

  it('treats empty as absent, in either place', () => {
    // `.env.example` ships the key with nothing after the `=`. Copying it
    // and not filling it in must read as "not set", not as an empty key
    // sent to the explorer and rejected for reasons nobody can act on.
    const file = envFile('ETHERSCAN_API_KEY=\n');

    expect(settingValue('ETHERSCAN_API_KEY', file, {})).toBeUndefined();
    expect(
      settingValue('ETHERSCAN_API_KEY', file, { ETHERSCAN_API_KEY: '   ' }),
    ).toBeUndefined();
  });
});

describe('chainLookupFrom (the F29 wiring)', () => {
  it('finds the key in .env, which is where the bug was', () => {
    const file = envFile('SESSION_SECRET=x\nETHERSCAN_API_KEY=ABC123\n');

    expect(chainLookupFrom(file, {})).toEqual({ etherscanApiKey: 'ABC123' });
  });

  it('leaves the key out entirely when nobody has set one', () => {
    const file = envFile('SESSION_SECRET=x\n');

    expect(chainLookupFrom(file, {})).toEqual({});
  });

  it('carries the explorer addresses a test or a mirror may override', () => {
    const file = envFile(
      'ETHERSCAN_API_KEY=k\nPAYOUT_ETHERSCAN_API=http://127.0.0.1:9/api\n',
    );

    expect(chainLookupFrom(file, {})).toEqual({
      etherscanApiKey: 'k',
      etherscanBaseUrl: 'http://127.0.0.1:9/api',
    });
  });
});
