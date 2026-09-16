/**
 * The "Demo" menu in the top bar: shows the demo status (scenario, household clock, timezone) and which brain is
 * answering, keeps the reset token in sessionStorage, and re-seeds the household at the scripted demo moments.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { AgentStatus } from '@shared/agent';
import { ApiError, describeError, getDemoStatus, resetDemo, type DemoResetInput, type DemoStatus } from '../lib/api';
import { brainLabel } from '../lib/text';

interface DemoMenuProps {
  agentStatus: AgentStatus | null;
  /** Fired after a successful reset with the new demo status. */
  onReset(status: DemoStatus): void;
}

const TOKEN_KEY = 'carecompanion.demoToken';

function readToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeToken(token: string): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // sessionStorage can be unavailable; the token still lives in component state for this page.
  }
}

const RESETS: Array<{ label: string; body: DemoResetInput }> = [
  { label: 'Reset: mid-morning (10:30)', body: { scenario: 'mid-morning', targetLocalTime: '10:30' } },
  { label: 'Reset: evening (19:30)', body: { scenario: 'evening', targetLocalTime: '19:30' } },
  { label: 'Reset: now', body: { scenario: 'default', clockOffsetMin: 0 } },
];

function describeBrain(status: AgentStatus | null): string {
  if (!status) return 'unknown';
  const label = brainLabel(status.brain, status.model);
  if (status.brain === 'bedrock' && status.bedrockPaused) return `${label} — paused, rule brain answering`;
  return label;
}

export function DemoMenu({ agentStatus, onReset }: DemoMenuProps) {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [token, setToken] = useState(readToken);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

  const loadStatus = async () => {
    try {
      setStatus(await getDemoStatus());
      setStatusError(null);
    } catch (err) {
      setStatusError(describeError(err));
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadStatus();
    tokenRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const updateToken = (value: string) => {
    setToken(value);
    writeToken(value);
  };

  const runReset = async (label: string, body: DemoResetInput) => {
    if (!token.trim()) {
      setMessage({ tone: 'error', text: 'Enter the demo reset token first.' });
      tokenRef.current?.focus();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const next = await resetDemo(token.trim(), body);
      setStatus(next);
      setMessage({ tone: 'ok', text: `${label.replace('Reset: ', 'Reset to ')} — household clock ${next.localTime}.` });
      onReset(next);
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) setMessage({ tone: 'error', text: 'Token rejected.' });
      else setMessage({ tone: 'error', text: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-400 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        Demo
      </button>

      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-label="Demo controls"
          className="absolute right-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-xl"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Demo status</h2>
          {statusError ? (
            <p role="alert" className="mt-2 text-rose-700">
              {statusError}
            </p>
          ) : (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-700">
              <dt className="text-slate-500">Scenario</dt>
              <dd className="font-medium">{status?.scenario ?? '…'}</dd>
              <dt className="text-slate-500">Local time</dt>
              <dd className="font-medium tabular-nums">
                {status ? `${status.localTime} · ${status.today}` : '…'}
                {status && status.clockOffsetMin !== 0 && (
                  <span className="ml-1 text-xs text-slate-500">
                    (clock shifted {status.clockOffsetMin > 0 ? '+' : ''}
                    {status.clockOffsetMin} min)
                  </span>
                )}
              </dd>
              <dt className="text-slate-500">Timezone</dt>
              <dd className="font-medium">{status?.timezone ?? '…'}</dd>
              <dt className="text-slate-500">Brain</dt>
              <dd className="font-medium">
                {describeBrain(agentStatus)}
                {agentStatus && (
                  <span className="ml-1 text-xs text-slate-500">
                    ({agentStatus.turnsToday}/{agentStatus.dailyTurnCap} turns today)
                  </span>
                )}
              </dd>
            </dl>
          )}

          <label className="mt-4 block">
            <span className="mb-1 block font-medium text-slate-700">Reset token</span>
            <input
              ref={tokenRef}
              type="password"
              value={token}
              onChange={(event) => updateToken(event.target.value)}
              placeholder="DEMO_RESET_TOKEN"
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <span className="mt-1 block text-xs text-slate-500">Kept in this tab's session storage only.</span>
          </label>

          <div className="mt-3 grid gap-2">
            {RESETS.map((reset) => (
              <button
                key={reset.label}
                type="button"
                onClick={() => void runReset(reset.label, reset.body)}
                disabled={busy}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-left font-medium text-indigo-900 transition hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reset.label}
              </button>
            ))}
          </div>

          {message && (
            <p
              role="status"
              className={`mt-3 rounded-lg px-3 py-2 ${
                message.tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-800'
              }`}
            >
              {message.text}
            </p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            A reset re-seeds the Hart household at that moment and clears the transcript.
          </p>
        </div>
      )}
    </div>
  );
}
