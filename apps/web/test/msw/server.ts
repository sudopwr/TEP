import { setupServer } from 'msw/node';

import { handlers } from './handlers';

/**
 * One MSW server for the whole suite, started once in `setup.ts`.
 *
 * `onUnhandledRequest: 'error'` is the important setting. Without it, a
 * component that fetches a URL nobody wrote a handler for gets a silent
 * failure and the test sees an empty table — which passes, if the assertion
 * was weak. With it, the typo is the error.
 */
export const server = setupServer(...handlers);
