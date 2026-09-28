import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Reading a setting that may be in `.env`.
 *
 * **There is no dotenv here, and that is the point of this file.** Nothing
 * loads `.env` into `process.env`: the bootstrap reads the one value it
 * needs, by name, at the moment it needs it. So a setting only arrives if
 * somebody asked for it here — which is also the mistake F29 made first,
 * reading `process.env['ETHERSCAN_API_KEY']` for a key that was sitting in
 * the file all along.
 *
 * The order is always the same: a real environment variable beats the file,
 * so a deployment can inject one without the file being consulted.
 */

/** Pull one `KEY=value` out of a .env file. No interpolation, no export. */
export function readEnvFileValue(file: string, key: string): string | null {
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

/**
 * A setting from the environment, or from the file, or undefined.
 *
 * Empty is the same as absent: `ETHERSCAN_API_KEY=` in a file copied from
 * `.env.example` means "I have not set this", not "the key is the empty
 * string", and a blank key would otherwise be sent to the explorer and
 * rejected with a message nobody could act on.
 */
export function settingValue(
  key: string,
  envFile: string = path.resolve('.env'),
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnvironment = environment[key];
  if (fromEnvironment !== undefined && fromEnvironment.trim() !== '') {
    return fromEnvironment.trim();
  }

  const fromFile = readEnvFileValue(envFile, key);

  return fromFile === null || fromFile.trim() === ''
    ? undefined
    : fromFile.trim();
}
