/**
 * Owns the caregiver dashboard data for the web app: GET /api/dashboard, polled every 3 s while the tab is visible,
 * plus an explicit `refresh()` the app calls after every agent reply and every mutation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardData } from '@shared/dashboard';
import { describeError, getDashboard, type DashboardPayload } from './api';

export type AdherenceWindow = 7 | 30;

export interface DashboardState {
  data: DashboardData | null;
  /** The voice-first `caregiver_summary` sentence that came with the data. */
  spoken: string | null;
  /** True until the first response (success or failure). */
  loading: boolean;
  /** The most recent fetch error; cleared by the next successful poll. */
  error: string | null;
  /** ISO time of the last successful refresh. */
  lastUpdated: string | null;
  days: AdherenceWindow;
  setDays(days: AdherenceWindow): void;
  refresh(): Promise<void>;
}

const POLL_MS = 3_000;

export function useDashboard(): DashboardState {
  const [days, setDays] = useState<AdherenceWindow>(7);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    inFlight.current += 1;
    try {
      const next = await getDashboard(days);
      if (id !== sequence.current) return; // a newer request already landed
      setPayload(next);
      setError(null);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      if (id !== sequence.current) return;
      setError(describeError(err));
    } finally {
      inFlight.current -= 1;
      if (id === sequence.current) setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    let timer: number | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => {
        if (inFlight.current === 0) void refresh();
      }, POLL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const sync = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [refresh]);

  return {
    data: payload,
    spoken: payload?.spoken ?? null,
    loading,
    error,
    lastUpdated,
    days,
    setDays,
    refresh,
  };
}
