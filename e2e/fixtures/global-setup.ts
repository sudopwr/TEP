import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const WEB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'web',
);

/**
 * Build the web app once, before any worker starts.
 *
 * The journeys run against `vite preview` rather than the dev server, for two
 * reasons. The bundle a person actually opens is the one that has been through
 * the production build — minified, with the real class names and the real font
 * loading — and a test against the dev server would not catch a build that
 * broke either of those. And a preview server starts in milliseconds, which
 * matters when every test gets one of its own.
 *
 * Vite's own API rather than `npm run build`: Node refuses to spawn a `.cmd`
 * without a shell, and a shell would concatenate the arguments back into a
 * string. Calling the builder directly has neither problem, loads the same
 * `apps/web/vite.config.ts`, and skips the `tsc -b` half of that script —
 * which `npm run typecheck` already runs and which is not what this suite is
 * for.
 *
 * Unconditional: deciding whether `dist` is stale means comparing timestamps
 * across a workspace, and getting that wrong means a green run against code
 * that no longer exists.
 */
export default async function buildWebApp(): Promise<void> {
  await build({ root: WEB, logLevel: 'warn' });
}
