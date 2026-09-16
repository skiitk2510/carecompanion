import { newId } from './ids.js';
import { isOpenAlert, type Alert, type AlertSeverity, type AlertType, type Caregiver, type State } from './model.js';

export interface AlertSpec {
  elderId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  refId?: string;
  /** When set, a second alert with the same key is not created — the existing one is returned. */
  dedupeKey?: string;
  /** Caregiver ids to (simulated-)notify. */
  notified?: string[];
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Creates (or, for a duplicate `dedupeKey`, returns the existing) alert. Notification itself is simulated by the caller. */
export function createAlert(state: State, spec: AlertSpec, now: Date): { alert: Alert; created: boolean } {
  if (spec.dedupeKey) {
    const existing = state.alerts.find((a) => a.dedupeKey === spec.dedupeKey);
    if (existing) return { alert: existing, created: false };
  }
  const alert: Alert = {
    id: newId('alert'),
    elderId: spec.elderId,
    type: spec.type,
    severity: spec.severity,
    title: spec.title,
    detail: spec.detail,
    createdAt: now.toISOString(),
    notified: spec.notified ?? [],
  };
  if (spec.refId) alert.refId = spec.refId;
  if (spec.dedupeKey) alert.dedupeKey = spec.dedupeKey;
  state.alerts.push(alert);
  return { alert, created: true };
}

/** Open alerts for an elder: critical first, then newest first. */
export function openAlerts(state: Readonly<State>, elderId: string): Alert[] {
  return state.alerts
    .filter((a) => a.elderId === elderId && isOpenAlert(a))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.createdAt.localeCompare(a.createdAt));
}

/** Idempotent: acknowledging twice keeps the first acknowledgement. */
export function acknowledgeAlert(alert: Alert, caregiverId: string, now: Date): Alert {
  if (!alert.acknowledgedAt) {
    alert.acknowledgedBy = caregiverId;
    alert.acknowledgedAt = now.toISOString();
  }
  return alert;
}

/** Idempotent: resolving also acknowledges. */
export function resolveAlert(alert: Alert, caregiverId: string, now: Date, resolution?: string): Alert {
  acknowledgeAlert(alert, caregiverId, now);
  if (!alert.resolvedAt) {
    alert.resolvedBy = caregiverId;
    alert.resolvedAt = now.toISOString();
    if (resolution) alert.resolution = resolution;
  }
  return alert;
}

/** Caregivers of the elder's household, priority 1 first. */
export function caregiversFor(state: Readonly<State>, elderId: string): Caregiver[] {
  const elder = state.elders.find((e) => e.id === elderId);
  if (!elder) return [];
  return state.caregivers
    .filter((c) => c.householdId === elder.householdId)
    .sort((a, b) => a.escalationPriority - b.escalationPriority);
}
