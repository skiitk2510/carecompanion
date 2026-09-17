/**
 * The MCP App view for `caregiver_summary`. The host delivers the tool result through the app bridge; the view
 * refreshes and acts (resolve alerts, mark doses) by calling server tools through the same bridge — it never
 * opens a network connection of its own (the resource ships with an empty CSP).
 *
 * Display modes follow the Alexa+ design guide: in `inline` mode (when the host can also offer `fullscreen`) the
 * view shows a wider-than-tall summary block with an "open full dashboard" control; in `fullscreen`, or in hosts
 * that do not report display modes, it shows the complete dashboard.
 */
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardData } from '@shared/dashboard';
import { Dashboard } from './components/Dashboard';
import type { DashboardActions, DashboardLayout } from './components/types';

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

/** Inline summary only when the host is in inline mode AND can expand to fullscreen; otherwise the full dashboard. */
function layoutFor(ctx: McpUiHostContext | null | undefined): DashboardLayout {
  if (!ctx) return 'full';
  const canExpand = (ctx.availableDisplayModes ?? []).includes('fullscreen');
  return ctx.displayMode === 'inline' && canExpand ? 'inline' : 'full';
}

function insetStyle(ctx: McpUiHostContext | null | undefined): React.CSSProperties | undefined {
  const s = ctx?.safeAreaInsets;
  return s ? { padding: `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px` } : undefined;
}

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [caregiverId, setCaregiverId] = useState(DEFAULT_CAREGIVER);
  const [tornDown, setTornDown] = useState(false);
  const [hostContext, setHostContext] = useState<McpUiHostContext | null>(null);
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
    capabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    onAppCreated: (created) => {
      created.ontoolinput = (params) => {
        argsRef.current = (params.arguments ?? {}) as ToolArgs;
      };
      created.ontoolresult = (result) => applyResult(result);
      created.ontoolcancelled = ({ reason }) => {
        setLoading(false);
        setError(reason ? `The host cancelled the request (${reason}).` : 'The host cancelled the request.');
      };
      created.onhostcontextchanged = (changed) => {
        setHostContext((current) => ({ ...(current ?? {}), ...changed }));
      };
      created.onteardown = async () => {
        setTornDown(true);
        return {};
      };
    },
  });
  useHostStyles(app, app?.getHostContext());

  // The initial context is available once connected; later changes arrive through onhostcontextchanged.
  useEffect(() => {
    if (isConnected && app) setHostContext((current) => current ?? app.getHostContext() ?? null);
  }, [isConnected, app]);

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

  const layout = layoutFor(hostContext);
  const expand = useCallback(async () => {
    if (!app) return;
    try {
      const { mode } = await app.requestDisplayMode({ mode: 'fullscreen' });
      setHostContext((current) => ({ ...(current ?? {}), displayMode: mode }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [app]);

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
    <main className="cc-app" style={insetStyle(hostContext)}>
      <Dashboard
        data={data}
        loading={loading && !data}
        error={error}
        caregiverId={caregiverId}
        onCaregiverChange={setCaregiverId}
        actions={actions}
        compact
        lastUpdated={lastUpdated}
        layout={layout}
        onExpand={layout === 'inline' ? expand : undefined}
      />
    </main>
  );
}
