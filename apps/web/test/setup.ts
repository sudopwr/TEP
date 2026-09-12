import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './msw/server';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  cleanup();
  // Any handler a test added with `server.use` is dropped here, so one test
  // cannot leave a 401 behind for the next one.
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
