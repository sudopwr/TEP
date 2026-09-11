import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * `SESSION_SECRET` — the key the session cookie is signed with (§5a).
 *
 * It signs the cookie; it does not encrypt it, and it is not the session id.
 * Losing it invalidates every cookie (everyone signs in again) and reveals
 * nothing. That is why generating one on first run is acceptable where
 * generating a password would not be.
 */

/** 32 bytes, base64url — the same shape and strength as a session id. */
export function generateSessionSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Pull one `KEY=value` out of a .env file. No interpolation, no export. */
function readFromEnvFile(file: string, key: string): string | null {
  if (!existsSync(file)) {
    return null;
  }

  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const equals = trimmed.indexOf('=');
    if (equals === -1 || trimmed.slice(0, equals).trim() !== key) {
      continue;
    }

    const value = trimmed.slice(equals + 1).trim();
    // Strip one layer of surrounding quotes, the only quoting we emit.
    return value.replace(/^["'](.*)["']$/, '$1');
  }

  return null;
}

export interface SessionSecretResult {
  readonly secret: string;
  /** Where it came from, so the bootstrap can say so on a first run. */
  readonly source: 'environment' | 'file' | 'generated';
}

/**
 * Find the session secret, or make one and write it down.
 *
 * Order is deliberate: a real environment variable beats the file, so a
 * deployment can inject one without the file being consulted at all.
 *
 * Generating on first run rather than shipping a default: a shipped signing
 * key is the same key in every installation, which means anyone with the
 * source can forge a cookie for anyone's machine. `.env` is gitignored.
 *
 * The file is appended to, never rewritten, so a hand-edited `.env` full of
 * other settings survives this.
 */
export function loadOrCreateSessionSecret(
  envFile: string = path.resolve('.env'),
  environment: NodeJS.ProcessEnv = process.env,
): SessionSecretResult {
  const fromEnvironment = environment['SESSION_SECRET'];
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) {
    return { secret: fromEnvironment, source: 'environment' };
  }

  const fromFile = readFromEnvFile(envFile, 'SESSION_SECRET');
  if (fromFile !== null && fromFile.length > 0) {
    return { secret: fromFile, source: 'file' };
  }

  const secret = generateSessionSecret();
  const needsNewline = existsSync(envFile)
    ? !readFileSync(envFile, 'utf8').endsWith('\n')
    : false;

  appendFileSync(
    envFile,
    `${needsNewline ? '\n' : ''}# Generated on first run. Losing this only signs everyone out.\nSESSION_SECRET=${secret}\n`,
    'utf8',
  );

  return { secret, source: 'generated' };
}
