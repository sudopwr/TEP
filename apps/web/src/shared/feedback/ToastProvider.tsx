import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Brief confirmation that something was recorded.
 *
 * Deliberately small. A toast is the right shape for exactly one message —
 * "the thing you just did worked" — and the wrong shape for everything else:
 * an error that needs a decision must not vanish after four seconds, and a
 * failure that needs context belongs next to the form that caused it. So this
 * carries successes and notes, and errors are rendered in place by the screen
 * that knows what failed.
 *
 * Messages queue rather than replace. Recording two legs in quick succession
 * should confirm both; a toast that overwrote the previous one would leave
 * the reader unsure whether the first write happened at all.
 */

export type ToastTone = 'success' | 'info';

export interface Toast {
  readonly message: string;
  readonly tone: ToastTone;
}

export interface ToastApi {
  /** "Payout recorded", "Document attached" — past tense, sentence case. */
  readonly notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** How long a confirmation stays up. Long enough to read twice. */
const TOAST_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<readonly Toast[]>([]);

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    setQueue((current) => [...current, { message, tone }]);
  }, []);

  const dismiss = useCallback(() => {
    setQueue((current) => current.slice(1));
  }, []);

  const api = useMemo<ToastApi>(() => ({ notify }), [notify]);
  const current = queue[0];

  return (
    <ToastContext.Provider value={api}>
      {children}

      <Snackbar
        open={current !== undefined}
        autoHideDuration={TOAST_MS}
        onClose={(_event, reason) => {
          // A click anywhere else must not dismiss it: the commonest click
          // right after recording something is on the next field.
          if (reason !== 'clickaway') dismiss();
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        // Keyed by content so a queued message replaces the previous one
        // cleanly rather than animating the same element's text mid-fade.
        key={
          current === undefined ? 'idle' : `${current.tone}:${current.message}`
        }
      >
        <Alert
          severity={current?.tone === 'info' ? 'info' : 'success'}
          variant="outlined"
          onClose={dismiss}
          sx={{ backgroundColor: 'background.paper' }}
        >
          {current?.message ?? ''}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

/**
 * Throws outside the provider rather than returning a no-op.
 *
 * A silent no-op would mean a screen that believes it confirmed a write while
 * nothing appeared — and the bug would surface as "recording sometimes does
 * not seem to do anything", which is the worst possible complaint about an
 * application that records money.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);

  if (api === null) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }

  return api;
}
