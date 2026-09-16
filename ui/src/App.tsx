/**
 * The MCP App view for `caregiver_summary`. The host delivers the tool result through the app bridge; the view
 * refreshes and acts (resolve alerts, mark doses) by calling server tools through the same bridge — it never
 * opens a network connection of its own (the resource ships with an empty CSP).
 */
import type { CallToolResult } from '@modelcontextprotocol/client';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardData } from '@shared/dashboard';
import { Dashboard } from './components/Dashboard';
import type { DashboardActions } from './components/types';

const APP_INFO = { name: 'carecompanion-dashboard', version: '0.1.0' };
const POLL_MS = 10_000;
const DEFAULT_CAREGIVER = 'cg_priya';

interface ToolArgs {
  elderId?: string;
  days?: number;
}

function textOf(result: CallToolResult): string {
  return (result.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join(' ');
}

function isDashboardData(value: unknown): value is DashboardData {
  return !!value && typeof value === 'object' && Array.isArray((value as DashboardData).todaysDoses);
}

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [caregiverId, setCaregiverId] = useState(DEFAULT_CAREGIVER);
  const [tornDown, setTornDown] = useState(false);
  const argsRef = useRef<ToolArgs>({});

  const applyResult = useCallback((result: CallToolResult) => {
    setLoading(false);
    if (result.isError) {
      setError(textOf(result) || 'The server returned an error.');
      return;
    }
    if (isDashboardData(result.structuredContent)) {
      setData(result.structuredContent);
      setError(null);
      setLastUpdated(new Date().toISOString());
    }
  }, []);

  // Every handler is attached before connect() — the host may deliver the tool input/result immediately.
  const {
    app,
    isConnected,
    error: appError,
  } = useApp({
    appInfo: APP_INFO,
    capabilities: {},
    onAppCreated: (created) => {
      created.ontoolinput = (params) => {
        argsRef.current = (params.arguments ?? {}) as ToolArgs;
      };
      created.ontoolresult = (result) => applyResult(result);
      created.ontoolcancelled = ({ reason }) => {
        setLoading(false);
        setError(reason ? `The host cancelled the request (${reason}).` : 'The host cancelled the request.');
      };
      created.onteardown = async () => {
        setTornDown(true);
        return {};
      };
    },
  });
  useHostStyles(app, app?.getHostContext());

  const refresh = useCallback(async () => {
    if (!app || tornDown) return;
    setLoading(true);
    try {
      const result = await app.callServerTool({
        name: 'caregiver_summary',
        arguments: { ...argsRef.current, days: argsRef.current.days === 30 ? 30 : 7 },
      });
      applyResult(result);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [app, tornDown, applyResult]);

  // If the host opened the view without a tool result (e.g. from the resource list), fetch once on connect.
  useEffect(() => {
    if (isConnected && !data) {
      const timer = setTimeout(() => void refresh(), 750);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isConnected, data, refresh]);

  // Keep the family view live while it is on screen; stop on teardown.
  useEffect(() => {
    if (!isConnected || tornDown) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [isConnected, tornDown, refresh]);

  const actions: DashboardActions = useMemo(
    () => ({
      async resolveAlert(alertId, action, resolution) {
        if (!app) throw new Error('Not connected to the host.');
        const result = await app.callServerTool({
          name: 'resolve_alert',
          arguments: { alertId, caregiverId, action, ...(resolution ? { resolution } : {}) },
        });
        if (result.isError) throw new Error(textOf(result));
        await refresh();
      },
      async markTaken(medication, override) {
        if (!app) throw new Error('Not connected to the host.');
        const result = await app.callServerTool({
          name: 'log_dose',
          arguments: { medication, ...(override ? { confirmOverride: true, overrideReason: override.reason } : {}) },
        });
        const structured = (result.structuredContent ?? {}) as { recorded?: boolean; requiresConfirmation?: boolean };
        const spoken = textOf(result);
        if (result.isError) throw new Error(spoken);
        if (structured.recorded) await refresh();
        return { recorded: !!structured.recorded, requiresConfirmation: !!structured.requiresConfirmation, spoken };
      },
      refresh,
    }),
    [app, caregiverId, refresh]
  );

  if (appError) {
    return (
      <main className="cc-app">
        <p className="cc-error" role="alert">
          Could not connect to the host: {appError.message}
        </p>
      </main>
    );
  }

  return (
    <main className="cc-app">
      <Dashboard
        data={data}
        loading={loading && !data}
        error={error}
        caregiverId={caregiverId}
        onCaregiverChange={setCaregiverId}
        actions={actions}
        compact
        lastUpdated={lastUpdated}
      />
    </main>
  );
}
