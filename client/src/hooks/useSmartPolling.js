import { useEffect, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 15000;

const useSmartPolling = (
  callback,
  {
    intervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
    runOnVisibility = true,
  } = {},
) => {
  const callbackRef = useRef(callback);
  const inFlightRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || typeof callbackRef.current !== 'function') {
      return undefined;
    }

    let disposed = false;

    const run = async () => {
      if (disposed) return;
      if (runOnVisibility && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      try {
        await callbackRef.current();
      } catch {
        // Polling errors are handled by the caller.
      } finally {
        inFlightRef.current = false;
      }
    };

    const timerId = setInterval(run, Math.max(Number(intervalMs) || DEFAULT_INTERVAL_MS, 3000));
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        run();
      }
    };

    if (runOnVisibility && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      disposed = true;
      clearInterval(timerId);
      if (runOnVisibility && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [enabled, intervalMs, runOnVisibility]);
};

export default useSmartPolling;
