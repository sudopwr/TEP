/**
 * The error a promise rejected with, typed.
 *
 * `promise.catch((error) => error as E)` looks equivalent and is not: it
 * widens the result to `E | T`, so every property access afterwards fails to
 * typecheck, and — worse — it passes silently when the call *resolves*. This
 * fails loudly in that case, which is the assertion the test meant to make.
 */
export async function rejection<E extends Error>(
  promise: Promise<unknown>,
): Promise<E> {
  try {
    await promise;
  } catch (error: unknown) {
    return error as E;
  }

  throw new Error('expected the call to reject, and it resolved instead');
}
