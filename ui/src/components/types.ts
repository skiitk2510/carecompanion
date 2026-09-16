/**
 * Props contract of the shared caregiver Dashboard. The MCP App view (ui/) feeds it through the host's tool bridge;
 * the web app (web/) feeds it through the REST routes. The component itself never talks to a network.
 */
import type { DashboardData } from '@shared/dashboard';

export interface MarkTakenOutcome {
  recorded: boolean;
  requiresConfirmation: boolean;
  spoken: string;
}

export interface DashboardActions {
  resolveAlert(alertId: string, action: 'acknowledge' | 'resolve', resolution?: string): Promise<void>;
  /** Records a dose on the elder's behalf; may come back asking for confirmation (duplicate guard). */
  markTaken(medicationName: string, override?: { confirm: true; reason: string }): Promise<MarkTakenOutcome>;
  refresh(): Promise<void>;
}

export interface DashboardProps {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  /** The caregiver acting on alerts (Priya or Daniel in the demo). */
  caregiverId: string;
  onCaregiverChange(caregiverId: string): void;
  actions: DashboardActions;
  /** True inside small MCP App surfaces: a single column with tighter spacing. */
  compact?: boolean;
  /** ISO time of the last successful refresh, for the footer. */
  lastUpdated?: string | null;
}
