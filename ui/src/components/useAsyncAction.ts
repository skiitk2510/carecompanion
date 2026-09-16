import { useCallback, useState } from 'react';
import { errorMessage } from './format';

/**
 * Busy/error bookkeeping for one action promise (a button's click). `run` resolves to the action's result, or to
 * `undefined` when it threw — the message is kept in `error` for inline display, never rethrown.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { busy, error, run, clearError };
}
