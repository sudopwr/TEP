import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { DomainError } from '@payout/core';

import { RequestValidationError } from './validate';

/**
 * Every domain error, and the status it means. One place, by design.
 *
 * Keyed by `error.name` rather than by constructor. A constructor key looks
 * tidier and breaks silently the moment two copies of core are loaded — which
 * has already happened once in this repository, when `@payout/core` resolved
 * to `dist` and `@core/*` to `src`, and every `instanceof` in the suite went
 * false at once. A name is a string and survives that.
 *
 * The default is 500. That is the safe direction, and it is also why
 * `errors.test.ts` asserts that every DomainError subclass core exports
 * appears here: a new error type should not become an accidental 500 with
 * nobody noticing.
 */
const STATUS_BY_ERROR: ReadonlyMap<string, number> = new Map([
  // 400 — the request described something the domain will not accept.
  ['CurrencyMismatchError', 400],
  ['InvalidMoneyAmountError', 400],
  ['InvalidDecimalStringError', 400],
  ['InvalidRateError', 400],
  ['InvalidBasisPointsError', 400],
  ['InvalidRoundingModeError', 400],
  ['SameAccountTransferError', 400],
  ['RateOnSameCurrencyError', 400],
  ['NonPositiveAmountError', 400],
  ['CurrencyNotAllowedError', 400],
  ['ParentPayoutMismatchError', 400],
  ['UnknownCurrencyError', 400],
  ['InvalidCurrencyError', 400],
  ['InvalidFeeScheduleError', 400],
  ['UnresolvableFeeBasisError', 400],
  ['InvalidUsernameError', 400],
  ['PasswordPolicyError', 400],

  // 401 — who are you. Both carry one message by design; see §5a.
  ['AuthenticationFailedError', 401],
  ['SessionInvalidError', 401],

  // 404 — you named something that is not there.
  ['PayoutNotFoundError', 404],
  ['TraderNotFoundError', 404],
  ['CompanyNotFoundError', 404],
  ['AccountNotFoundError', 404],
  ['TransactionNotFoundError', 404],
  ['UserNotFoundError', 404],
  ['DocumentNotFoundError', 404],

  // 409 — the request is fine, the world disagrees with it.
  ['UsernameTakenError', 409],
  ['CompanyCodeTakenError', 409],
  ['AccountCodeTakenError', 409],
  ['TraderCodeTakenError', 409],
  ['AccountInUseError', 409],

  // 422 — the data on file cannot answer this, and no request can fix it.
  ['AmbiguousFeeScheduleError', 422],
  ['DocumentFileMissingError', 422],
]);

/** The status a domain error means, or 500 if nobody has decided. */
export function statusForDomainError(error: DomainError): number {
  return STATUS_BY_ERROR.get(error.name) ?? 500;
}

/** Exposed so a test can prove the map covers every error core exports. */
export function mappedErrorNames(): readonly string[] {
  return [...STATUS_BY_ERROR.keys()];
}

interface ErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

/**
 * A Fastify error carrying a validation failure, or something close enough.
 *
 * Fastify puts `statusCode` on its own errors and ajv/rate-limit errors alike;
 * anything else that reaches here is ours or the runtime's, and gets a 500.
 */
function statusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 600) {
      return status;
    }
  }
  return null;
}

/**
 * The one error handler (§12: "errors are typed classes, never bare strings").
 *
 * Three rules it must never break:
 *
 *   1. A stack trace never leaves the process. Not in the body, not in a
 *      header, not on a 500. It is logged, where the one person running this
 *      can read it, and nowhere else.
 *   2. An unrecognised error is a 500 with a generic sentence. Echoing
 *      `error.message` from something we did not classify is how a SQLite
 *      error string, a file path, or half a query ends up on screen.
 *   3. A DomainError's message *is* for the reader. Those are written as
 *      sentences and carry no internals — that is the whole point of §12.
 */
export interface ErrorHandlerOptions {
  /**
   * What to do with an address that matched no route.
   *
   * Present when the built interface is being served: an unmatched GET that
   * is not an API address is a client-side route, and belongs to the router
   * rather than to a 404. Returning null means "not mine", and the JSON 404
   * below answers instead.
   */
  readonly notFound?: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => FastifyReply | null;
}

export function registerErrorHandler(
  app: FastifyInstance,
  options: ErrorHandlerOptions = {},
): void {
  app.setErrorHandler(
    (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof RequestValidationError) {
        // Field-level, because "Bad Request" next to a form is useless.
        return reply.status(400).send({
          code: 'invalid_request',
          message: error.message,
          details: { where: error.where, issues: error.issues },
        });
      }

      if (error instanceof DomainError) {
        const status = statusForDomainError(error);

        // A 500 from a domain error means the map has a gap. Log it as the
        // defect it is rather than letting it look like ordinary traffic.
        if (status === 500) {
          request.log.error(
            { err: error },
            `unmapped domain error '${error.name}' — add it to STATUS_BY_ERROR`,
          );
          return reply
            .status(500)
            .send({ code: 'internal_error', message: 'Something went wrong.' });
        }

        const body: ErrorBody = {
          code: toSnakeCase(error.name),
          message: error.message,
          ...(collectDetails(error) === undefined
            ? {}
            : { details: collectDetails(error) }),
        };

        return reply.status(status).send(body);
      }

      const status = statusOf(error);

      if (status !== null && status < 500) {
        // Fastify's own: a schema failure, a 429, a malformed body. Its
        // message describes the request, not the internals.
        return reply.status(status).send({
          code: codeOf(error) ?? 'bad_request',
          message: messageOf(error),
        });
      }

      request.log.error({ err: error }, 'unhandled error');

      return reply.status(status ?? 500).send({
        code: 'internal_error',
        message: 'Something went wrong.',
      });
    },
  );

  app.setNotFoundHandler((request, reply) => {
    // The interface first, where there is one: `/payouts/1` typed into the
    // address bar is a route the browser knows and the server does not.
    const served = options.notFound?.(request, reply);
    if (served !== null && served !== undefined) {
      return served;
    }

    // Otherwise a 404 in the same shape as every other error, so a client
    // never has to parse two formats.
    return reply.status(404).send({
      code: 'not_found',
      message: `No route for ${request.method} ${request.url}.`,
    });
  });
}

/** `PayoutNotFoundError` -> `payout_not_found`. Stable, and machine-readable. */
function toSnakeCase(name: string): string {
  return name
    .replace(/Error$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * The structured fields a domain error carries, minus the ones Error owns.
 *
 * §4 asks for errors that carry fields "not just a message string". This is
 * where those fields become useful to a client. Only own enumerable
 * properties, so nothing from the prototype chain and no stack.
 */
function collectDetails(
  error: DomainError,
): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(error)) {
    if (key === 'stack' || key === 'message' || key === 'name') {
      continue;
    }
    details[key] = typeof value === 'bigint' ? value.toString() : value;
  }

  return Object.keys(details).length === 0 ? undefined : details;
}

function codeOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code.toLowerCase();
    }
  }
  return null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'Bad request.';
}
