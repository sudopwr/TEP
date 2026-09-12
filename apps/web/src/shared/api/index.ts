/**
 * The one place the browser talks to the server.
 *
 * Everything below is reachable from a feature; nothing above it needs to know
 * a URL. Cache keys come from `queryKeys` and are never written inline; a 401
 * is handled once in `queryClient.ts` and never at a call site.
 */
export { ApiError } from './client';
export type { ApiErrorBody, RequestOptions } from './client';

export {
  describeError,
  fieldErrors,
  policyViolations,
} from './errors';
export type { ErrorDescription } from './errors';

export { queryKeys, cachesAffectedByTransaction } from './keys';

export { STALE_TIME_MS, createQueryClient } from './queryClient';
export type { QueryClientOptions } from './queryClient';

export { QueryProvider } from './QueryProvider';
export { AuthProvider, useAuth } from './AuthProvider';
export type { AuthState } from './AuthProvider';

export { documentUrl } from './endpoints';

export * from './hooks/index';
export type * from './types';
