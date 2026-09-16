/**
 * The caregiver pane: the shared Dashboard component (ui/) fed by the REST routes, with the 7/30-day window toggle,
 * the "Add medication" disclosure and the voice-first summary sentence the server produced alongside the data.
 */
import { useMemo } from 'react';
import { Dashboard } from '@ui/components/Dashboard';
import type { DashboardActions } from '@ui/components/types';
import { logDose, resolveAlert } from '../lib/api';
import { formatClock } from '../lib/text';
import type { AdherenceWindow, DashboardState } from '../lib/useDashboard';
import { AddMedicationForm } from '../components/AddMedicationForm';
import { RefreshIcon } from '../components/icons';

interface DashboardPanelProps {
  dashboard: DashboardState;
  caregiverId: string;
  onCaregiverChange(caregiverId: string): void;
}

const WINDOWS: AdherenceWindow[] = [7, 30];

export function DashboardPanel({ dashboard, caregiverId, onCaregiverChange }: DashboardPanelProps) {
  const { data, spoken, loading, error, lastUpdated, days, setDays, refresh } = dashboard;

  const actions = useMemo<DashboardActions>(
    () => ({
      async resolveAlert(alertId, action, resolution) {
        await resolveAlert(alertId, { caregiverId, action, ...(resolution ? { resolution } : {}) });
        await refresh();
      },
      async markTaken(medicationName, override) {
        const outcome = await logDose({
          medication: medicationName,
          ...(override ? { confirmOverride: true, overrideReason: override.reason } : {}),
        });
        if (outcome.recorded) await refresh();
        return {
          recorded: outcome.recorded,
          requiresConfirmation: outcome.requiresConfirmation,
          spoken: outcome.spoken,
        };
      },
      refresh,
    }),
    [caregiverId, refresh]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Adherence window"
          className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm"
        >
          {WINDOWS.map((window) => (
            <button
              key={window}
              type="button"
              onClick={() => setDays(window)}
              aria-pressed={days === window}
              className={`rounded-md px-3 py-1 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                days === window ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {window} days
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-indigo-400 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        >
          <RefreshIcon className="h-4 w-4" />
          Refresh
        </button>
        <span className="text-xs text-slate-500" aria-live="polite">
          {lastUpdated ? `Updated ${formatClock(lastUpdated)} · polls every 3 s while visible` : 'Loading…'}
        </span>
        {error && data && (
          <span role="alert" className="text-xs font-medium text-rose-700">
            Last refresh failed: {error}
          </span>
        )}
      </div>

      <AddMedicationForm caregiverId={caregiverId} onAdded={() => void refresh()} />

      {spoken && (
        <blockquote className="rounded-xl border-l-4 border-indigo-400 bg-indigo-50 px-4 py-3 text-sm leading-relaxed text-indigo-950">
          <span className="font-semibold">Spoken summary — </span>
          {spoken}
        </blockquote>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Dashboard
          data={data}
          loading={loading}
          error={data ? null : error}
          caregiverId={caregiverId}
          onCaregiverChange={onCaregiverChange}
          actions={actions}
          lastUpdated={lastUpdated}
        />
      </div>
    </div>
  );
}
