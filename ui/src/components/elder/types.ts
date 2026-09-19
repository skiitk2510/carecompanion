/** Structured results of the elder-facing tools, as the MCP App view receives them (see src/mcp/schemas.ts). */
import type { DashboardAppointment, DashboardDose } from '@shared/dashboard';

export interface TodaysPlanData {
  today: string;
  localTime: string;
  elderName: string;
  doses: DashboardDose[];
  nextUp: DashboardDose | null;
  appointments: DashboardAppointment[];
  checkedInToday: boolean;
  openAlertsCount: number;
}

export interface LogDoseData {
  recorded: boolean;
  verdict: 'allow' | 'refuse' | 'allow_override' | 'ambiguous' | 'not_found';
  status: 'taken' | 'late' | null;
  medication: { id: string; name: string; dose: string } | null;
  requiresConfirmation: boolean;
  reason: 'inactive' | 'max_daily' | 'min_interval' | null;
  lastTakenAt: string | null;
  nextAllowedAt: string | null;
  candidates?: string[];
  alertId: string | null;
}

export function isTodaysPlanData(value: unknown): value is TodaysPlanData {
  const v = value as TodaysPlanData | null;
  return !!v && typeof v === 'object' && Array.isArray(v.doses) && typeof v.elderName === 'string';
}

export function isLogDoseData(value: unknown): value is LogDoseData {
  const v = value as LogDoseData | null;
  return !!v && typeof v === 'object' && typeof v.verdict === 'string' && 'requiresConfirmation' in v;
}
