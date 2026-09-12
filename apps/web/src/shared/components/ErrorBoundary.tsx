import { Component, type ErrorInfo, type ReactNode } from 'react';

import { ErrorState } from './ErrorState';

/**
 * Catches a render-time throw below it and shows something instead of a
 * blank page.
 *
 * ```tsx
 * <ErrorBoundary>
 *   <Balances />
 * </ErrorBoundary>
 *
 * // Reset clears the caught error and re-renders the children. Give it a
 * // `resetKey` that changes when the underlying situation changes, so a
 * // broken screen recovers on navigation instead of staying broken.
 * <ErrorBoundary title="Could not draw the trail" resetKey={payoutId}>
 *   <Trail payoutId={payoutId} />
 * </ErrorBoundary>
 *
 * <ErrorBoundary fallback={(error, reset) => <MyOwnScreen error={error} onRetry={reset} />}>
 *   <Thing />
 * </ErrorBoundary>
 * ```
 */

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Heading for the default fallback. */
  readonly title?: string;
  /** Replace the default fallback entirely. */
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
  /**
   * Changing this clears a caught error.
   *
   * Without it a boundary that has caught once shows its fallback forever,
   * because nothing about navigating to a different payout tells React to
   * try rendering again.
   */
  readonly resetKey?: unknown;
  /** Somewhere to send the error. Called during `componentDidCatch`. */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * A class, because there is still no hook for this.
 *
 * `getDerivedStateFromError` is the only React API that stops an exception
 * during render from unmounting the whole tree, and it exists only on class
 * components. This is the one place in the app that needs to be one.
 *
 * What it deliberately does *not* do is show `error.message` by default. A
 * thrown message can carry an id, a path, or a fragment of whatever data was
 * being rendered, and this component's whole job is to appear at the moment
 * things are least predictable. The message goes to `onError` and the console;
 * the screen gets a sentence and a retry.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  /**
   * Anything can be thrown in JavaScript, including a string.
   *
   * Both entry points normalise, because React does not: `componentDidCatch`
   * is typed `(error: Error, ...)` and is handed the raw thrown value, so an
   * `onError` handler calling `error.stack` on a thrown string would itself
   * throw — inside the component whose job is to stop that happening.
   */
  static #asError(thrown: unknown): Error {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
  }

  static getDerivedStateFromError(thrown: unknown): ErrorBoundaryState {
    return { error: ErrorBoundary.#asError(thrown) };
  }

  override componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    this.props.onError?.(ErrorBoundary.#asError(thrown), info);
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      previous.resetKey !== this.props.resetKey
    ) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;

    if (error === null) {
      return this.props.children;
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <ErrorState
        title={this.props.title ?? 'Something broke while drawing this'}
        message="The page could not be rendered. Trying again may work; if it does not, the details are in the browser console."
        detail={error.name}
        onRetry={this.reset}
      />
    );
  }
}
