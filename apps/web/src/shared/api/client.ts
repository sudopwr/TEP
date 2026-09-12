/**
 * The one place the browser talks to the server.
 *
 * Relative URLs only. In development Vite proxies `/api` and `/auth` to
 * `127.0.0.1:3000`; in production the same origin serves both. Either way the
 * cookie is same-origin, which is what lets §5a's `sameSite=lax` work and what
 * keeps the session id out of JavaScript's reach.
 */

/** The error shape every route returns — see `apps/api/src/routes/errors.ts`. */
export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 401. The session is gone; the UI should show the sign-in screen. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /**
   * 403 with F15's code. Not a permission problem — the shipped password is
   * still in place and every data route is closed until it changes (§5a).
   */
  get needsPasswordChange(): boolean {
    return this.status === 403 && this.code === 'password_change_required';
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';

  if (!type.includes('application/json')) {
    return null;
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function errorFrom(status: number, body: unknown): ApiError {
  if (typeof body === 'object' && body !== null && 'code' in body) {
    const shaped = body as ApiErrorBody;
    return new ApiError(status, shaped.code, shaped.message, shaped.details);
  }

  // The server always sends the shape above. Anything else is a proxy, a
  // crash before the handler, or a disconnection — so say that rather than
  // rendering `undefined`.
  return new ApiError(
    status,
    'unexpected_response',
    `The server returned ${String(status)} without an error body.`,
  );
}

/**
 * Resolve a relative path against the page's own origin.
 *
 * In a browser `fetch('/api/x')` resolves against the document and this is a
 * no-op. Outside one it is not: Node's fetch has no document to resolve
 * against and throws `Failed to parse URL` on a relative path, which is how a
 * jsdom test ends up reporting "the server is not reachable" for a request
 * that was never made. Being explicit costs nothing and means the client
 * behaves the same in both places.
 *
 * Still same-origin, so §5a's `sameSite=lax` cookie is still sent, and in
 * development Vite's proxy still forwards `/api` and `/auth` to the API.
 */
function absolute(path: string): string {
  const origin = globalThis.location?.origin;

  return origin === undefined ? path : new URL(path, origin).toString();
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Fetch JSON, or throw an `ApiError` carrying the server's own code.
 *
 * `credentials: 'same-origin'` is explicit rather than relying on the default:
 * without the cookie every request is a 401, and a default that silently
 * changed would be a confusing afternoon.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(absolute(path), {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers:
      options.body === undefined
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'content-type': 'application/json' },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  const body = await parseBody(response);

  if (!response.ok) {
    throw errorFrom(response.status, body);
  }

  return body as T;
}
