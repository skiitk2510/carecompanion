/**
 * The CareCompanion MCP App view. One bundle, three screens, chosen by the shape of the tool result the host
 * delivers: the caregiver dashboard (`caregiver_summary`), the elder's today card (`get_todays_plan`) and the
 * dose-guard card (`log_dose`). The view acts only through the host bridge (`callServerTool`) and never opens a
 * network connection of its own (the resource ships with an empty CSP).
 *
 * Display modes follow the Alexa+ design guide: in `inline` mode (when the host can also offer `fullscreen`) the
 * dashboard shows a wider-than-tall summary block with an "open full dashboard" control; in `fullscreen`, or in
 * hosts that do not report display modes, it shows the complete dashboard. The elder screens are inline-sized.
 */
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardData } from '@shared/dashboard';
import { Dashboard } from './components/Dashboard';
import { DoseGuardScreen, type LogDoseCall } from './components/elder/DoseGuardScreen';
import { TodayScreen } from './components/elder/TodayScreen';
import { isLogDoseData, isTodaysPlanData, type LogDoseData, type TodaysPlanData } from './components/elder/types';
import type { DashboardActions, DashboardLayout } from './components/types';

const APP_INFO = { name: 'carecompanion-dashboard', version: '0.1.0' };
const POLL_MS = 10_000;
const DEFAULT_CAREGIVER = 'cg_priya';

interface ToolArgs {
  elderId?: string;
  days?: number;
}

type Screen =
  | { kind: 'dashboard'; data: DashboardData }
  | { kind: 'today'; data: TodaysPlanData; spoken: string | null }
  | { kind: 'dose'; data: LogDoseData; spoken: string | null };

function textOf(result: CallToolResult): string {
  return (result.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join(' ');
}

function isDashboardData(value: unknown): value is DashboardData {
  return !!value && typeof value === 'object' && Array.isArray((value as DashboardData).todaysDoses);
}

/** Which screen a tool result belongs to — by shape, so it works whatever the host reports as toolInfo. */
function classify(result: CallToolResult): Screen | null {
  const s = result.structuredContent;
  if (isDashboardData(s)) return { kind: 'dashboard', data: s };
  if (isTodaysPlanData(s)) return { kind: 'today', data: s, spoken: textOf(result) || null };
  if (isLogDoseData(s)) return { kind: 'dose', data: s, spoken: textOf(result) || null };
  return null;
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
  const [screen, setScreen] = useState<Screen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [caregiverId, setCaregiverId] = useState(DEFAULT_CAREGIVER);
  const [tornDown, setTornDown] = useState(false);
  const [hostContext, setHostContext] = useState<McpUiHostContext | null>(null);
  const argsRef = useRef<ToolArgs>({});
  const screenRef = useRef<Screen | null>(null);
  screenRef.current = screen;

  const applyResult = useCallback((result: CallToolResult) => {
    setLoading(false);
    if (result.isError) {
      setError(textOf(result) || 'The server returned an error.');
      return;
    }
    const next = classify(result);
    if (next) {
      setScreen(next);
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

  const callTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
      if (!app) throw new Error('Not connected to the host.');
      return app.callServerTool({ name, arguments: args });
    },
    [app]
  );

  /** Re-fetch whatever screen is showing (the dose screen moves on to today's plan). */
  const refresh = useCallback(async () => {
    if (!app || tornDown) return;
    setLoading(true);
    try {
      const kind = screenRef.current?.kind ?? 'dashboard';
      const result =
        kind === 'dashboard'
          ? await callTool('caregiver_summary', { ...argsRef.current, days: argsRef.current.days === 30 ? 30 : 7 })
          : await callTool('get_todays_plan', argsRef.current.elderId ? { elderId: argsRef.current.elderId } : {});
      applyResult(result);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [app, tornDown, callTool, applyResult]);

  // If the host opened the view without a tool result (e.g. from the resource list), fetch once on connect.
  useEffect(() => {
    if (isConnected && !screen) {
      const timer = setTimeout(() => void refresh(), 750);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isConnected, screen, refresh]);

  // Keep the family view (and the today card) live while on screen; the dose card is a one-shot answer.
  useEffect(() => {
    if (!isConnected || tornDown || screen?.kind === 'dose') return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [isConnected, tornDown, screen?.kind, refresh]);

  const logDose: LogDoseCall = useCallback(
    async (medication, override) => {
      const result = await callTool('log_dose', {
        medication,
        ...(argsRef.current.elderId ? { elderId: argsRef.current.elderId } : {}),
        ...(override ? { confirmOverride: true, overrideReason: override.reason } : {}),
      });
      const spoken = textOf(result);
      if (result.isError) throw new Error(spoken || 'log_dose failed');
      if (!isLogDoseData(result.structuredContent)) throw new Error('Unexpected log_dose result.');
      return { data: result.structuredContent, spoken };
    },
    [callTool]
  );

  const actions: DashboardActions = useMemo(
    () => ({
      async resolveAlert(alertId, action, resolution) {
        const result = await callTool('resolve_alert', {
          alertId,
          caregiverId,
          action,
          ...(resolution ? { resolution } : {}),
        });
        if (result.isError) throw new Error(textOf(result));
        await refresh();
      },
      async markTaken(medication, override) {
        const { data, spoken } = await logDose(medication, override);
        if (data.recorded) await refresh();
        return { recorded: data.recorded, requiresConfirmation: data.requiresConfirmation, spoken };
      },
      refresh,
    }),
    [callTool, caregiverId, refresh, logDose]
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

  if (screen?.kind === 'today') {
    return (
      <main className="cc-app" style={insetStyle(hostContext)}>
        <div className="cc-dashboard cc-dashboard--compact">
          {error && <p className="cc-inline-error">{error}</p>}
          <TodayScreen
            data={screen.data}
            spoken={screen.spoken}
            markTaken={actions.markTaken}
            refresh={refresh}
            busy={loading}
          />
        </div>
      </main>
    );
  }

  if (screen?.kind === 'dose') {
    return (
      <main className="cc-app" style={insetStyle(hostContext)}>
        <div className="cc-dashboard cc-dashboard--compact">
          {error && <p className="cc-inline-error">{error}</p>}
          <DoseGuardScreen
            data={screen.data}
            spoken={screen.spoken}
            logDose={logDose}
            onResult={(data, spoken) => setScreen({ kind: 'dose', data, spoken })}
            onRecorded={async () => {
              // After a recorded dose, show the day so the person sees what is next.
              const result = await callTool('get_todays_plan', {});
              const next = classify(result);
              if (next?.kind === 'today') setScreen(next);
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="cc-app" style={insetStyle(hostContext)}>
      <Dashboard
        data={screen?.kind === 'dashboard' ? screen.data : null}
        loading={loading && !screen}
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
