import type { z } from 'zod';

/**
 * A request that did not match its schema.
 *
 * Carries the field-level detail rather than a sentence, because a client
 * showing "grossAmount: expected a decimal number" next to the input is doing
 * something useful, and one showing "Bad Request" is not.
 *
 * Not a `DomainError`: nothing about a malformed request reached the domain.
 * It is handled alongside them in the error handler, at 400.
 */
export class RequestValidationError extends Error {
  readonly statusCode = 400;

  constructor(
    readonly where: 'body' | 'query' | 'params',
    readonly issues: readonly { path: string; message: string }[],
  ) {
    super(`Invalid request ${where}.`);
    this.name = 'RequestValidationError';
  }
}

/**
 * Parse, or throw something the error handler can render.
 *
 * Zod is used directly rather than through Fastify's schema compiler. The
 * compiler wants JSON Schema, and the two things this project needs most —
 * money as a validated decimal *string*, and a rate transformed into a
 * 1e8-scaled bigint — are a refinement and a transform, neither of which
 * survives that translation. Parsing at the top of a handler keeps the
 * transform, and keeps the parsed type flowing into the use case call.
 */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  where: 'body' | 'query' | 'params',
): z.infer<T> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new RequestValidationError(
      where,
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  return result.data;
}
