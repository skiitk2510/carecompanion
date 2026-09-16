/**
 * Typed fetch helpers for the CareCompanion REST API. Everything is same-origin: in dev Vite proxies /api to the
 * Node server on :3000, in production Express serves this app and the API from one process.
 *
 * Request/response contracts that the server publishes in src/shared are imported; the shapes that only exist as
 * zod schemas on the server (src/mcp/schemas.ts, src/domain/actions.ts) are mirrored here as plain types.
 */
import type { AgentRequest, AgentResponse, AgentStatus } from '@shared/agent';
import type { DashboardData } from '@shared/dashboard';

export type DashboardPayload = DashboardData & { spoken: string };

export interface MedicationRef {
  id: string;
  name: string;
  dose: string;
}

/** Mirrors `LogDoseOutput` plus the `spoken` sentence every action returns. */
export interface LogDoseResponse {
  recorded: boolean;
  verdict: 'allow' | 'refuse' | 'allow_override' | 'ambiguous' | 'not_found';
  status: 'taken' | 'late' | null;
  medication: MedicationRef | null;
  requiresConfirmation: boolean;
  reason: 'inactive' | 'max_daily' | 'min_interval' | null;
  lastTakenAt: string | null;
  nextAllowedAt: string | null;
  candidates?: string[];
  alertId: string | null;
  spoken: string;
}

export interface LogDoseInput {
  medication: string;
  confirmOverride?: boolean;
  overrideReason?: string;
}

/** Mirrors `ResolveAlertOutput` plus `spoken`. */
export interface ResolveAlertResponse {
  alert: {
    id: string;
    type: string;
    severity: string;
    title: string;
    acknowledgedBy: string | null;
    resolvedBy: string | null;
    resolution: string | null;
  };
  changed: boolean;
  spoken: string;
}

export interface ResolveAlertInput {
  caregiverId: string;
  action: 'acknowledge' | 'resolve';
  resolution?: string;
}

export type WarningSeverity = 'minor' | 'moderate' | 'major';

/** Mirrors `InteractionWarningView`. */
export interface InteractionWarning {
  kind: 'interaction' | 'allergy';
  withName: string;
  severity: WarningSeverity;
  summary: string;
  advice: string;
  disclaimer: string;
}

/** Mirrors `AddMedicationInput` (the fields the web form uses). */
export interface AddMedicationInput {
  name: string;
  dose: string;
  form?: string;
  scheduleTimes: string[];
  purpose?: string;
  instructions?: string;
  critical?: boolean;
  addedBy?: string;
}

/** Mirrors `AddMedicationOutput` plus `spoken`. */
export interface AddMedicationResponse {
  medication: MedicationRef & { scheduleTimes: string[] };
  warnings: InteractionWarning[];
  alertId: string | null;
  spoken: string;
}

/** Mirrors `DemoStatus` (src/domain/actions.ts). */
export interface DemoStatus {
  scenario: string;
  seededAt: string | null;
  clockOffsetMin: number;
  now: string;
  today: string;
  localTime: string;
  timezone: string;
}

export type DemoScenario = 'default' | 'mid-morning' | 'evening';

export interface DemoResetInput {
  scenario: DemoScenario;
  /** HH:mm in the household timezone; shifts the demo clock so the scripted beats line up. */
  targetLocalTime?: string;
  /** Explicit clock shift in minutes; 0 returns to real time (a reset without either keeps the current shift). */
  clockOffsetMin?: number;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  uptimeSec: number;
}

/** Any non-2xx answer or network failure. `code` is the server's `error` field when it sent one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: string[];
  readonly retryAfterSec: number | undefined;

  constructor(message: string, opts: { status: number; code: string; issues?: string[]; retryAfterSec?: number }) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.issues = opts.issues ?? [];
    this.retryAfterSec = opts.retryAfterSec;
  }

  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 'rate_limited';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** A one-line, user-facing description of any thrown value. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fallbackMessage(status: number, code: string, retryAfterSec: number | undefined): string {
  if (status === 429) return `Too many requests — try again in ${retryAfterSec ?? 60} seconds.`;
  if (status === 401) return 'Unauthorized.';
  if (status === 404) return 'Not found.';
  if (status >= 500) return 'The CareCompanion server hit an error.';
  return `Request failed (${code}, HTTP ${status}).`;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError('Could not reach the CareCompanion server.', { status: 0, code: 'network' });
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const body = isRecord(json) ? json : {};
    const code = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    const issues = Array.isArray(body.issues) ? body.issues.filter((i): i is string => typeof i === 'string') : [];
    const retryAfterSec = typeof body.retryAfterSec === 'number' ? body.retryAfterSec : undefined;
    const message =
      typeof body.message === 'string'
        ? body.message
        : issues.length > 0
          ? issues.join('; ')
          : fallbackMessage(res.status, code, retryAfterSec);
    throw new ApiError(message, { status: res.status, code, issues, retryAfterSec });
  }
  return json as T;
}

// --- agent ---------------------------------------------------------------------------------------

export function getAgentStatus(): Promise<AgentStatus> {
  return request<AgentStatus>('/api/agent/status');
}

/** One conversational turn. Throws `ApiError` with `isRateLimited` on 429. */
export function askAgent(body: AgentRequest): Promise<AgentResponse> {
  return request<AgentResponse>('/api/agent', { method: 'POST', body });
}

// --- dashboard -----------------------------------------------------------------------------------

export function getDashboard(days: 7 | 30): Promise<DashboardPayload> {
  return request<DashboardPayload>(`/api/dashboard?days=${days}`);
}

export function resolveAlert(alertId: string, body: ResolveAlertInput): Promise<ResolveAlertResponse> {
  return request<ResolveAlertResponse>(`/api/dashboard/alerts/${encodeURIComponent(alertId)}`, {
    method: 'POST',
    body,
  });
}

/** Records a dose on the elder's behalf (caregiver-sourced) through the same duplicate-dose guard. */
export function logDose(body: LogDoseInput): Promise<LogDoseResponse> {
  return request<LogDoseResponse>('/api/dashboard/doses', { method: 'POST', body });
}

export function addMedication(body: AddMedicationInput): Promise<AddMedicationResponse> {
  return request<AddMedicationResponse>('/api/dashboard/medications', { method: 'POST', body });
}

// --- demo controls -------------------------------------------------------------------------------

export function getDemoStatus(): Promise<DemoStatus> {
  return request<DemoStatus>('/api/demo/status');
}

/** Re-seeds the household; needs the server's DEMO_RESET_TOKEN (401 → `ApiError.isUnauthorized`). */
export function resetDemo(token: string, body: DemoResetInput): Promise<DemoStatus> {
  return request<DemoStatus>('/api/demo/reset', { method: 'POST', body, headers: { 'x-demo-token': token } });
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/healthz');
}
