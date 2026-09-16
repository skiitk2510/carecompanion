/**
 * The caregiver dashboard payload. Produced by the server (`caregiver_summary` structuredContent and
 * GET /api/dashboard) and consumed, type-only, by both the MCP App view (ui/) and the web app (web/).
 * Keep this file free of runtime imports — it is shared across three TypeScript projects.
 */
import type { AlertSeverity, AlertType, ClockTime, IsoDateTime, LocalDate, SymptomSeverity } from '../domain/model.js';

export type DashboardDoseStatus = 'scheduled' | 'taken' | 'late' | 'missed' | 'skipped';

export interface DashboardDose {
  medicationId: string;
  name: string;
  dose: string;
  scheduledTime: ClockTime;
  scheduledAt: IsoDateTime;
  /** e.g. "8 a.m." */
  spokenTime: string;
  status: DashboardDoseStatus;
  recordedAt: IsoDateTime | null;
  critical: boolean;
  instructions?: string;
}

export interface DashboardAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  createdAt: IsoDateTime;
  /** e.g. "today 9:15 a.m." */
  createdWhen: string;
  acknowledgedBy: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  /** Caregiver names that were (simulated-)notified. */
  notified: string[];
}

export interface DashboardCheckIn {
  localDate: LocalDate;
  at: IsoDateTime;
  mood: string;
  symptoms: string[];
  severity: SymptomSeverity;
  flagged: boolean;
}

export interface DashboardAppointment {
  id: string;
  title: string;
  at: IsoDateTime;
  /** e.g. "tomorrow 2 p.m." or "Saturday 10:30 a.m." */
  when: string;
  location?: string;
}

export interface AdherenceCounts {
  due: number;
  taken: number;
  late: number;
  missed: number;
  skipped: number;
  /** (taken + late) / due, null when nothing was due. */
  rate: number | null;
}

export interface DashboardMedication {
  id: string;
  name: string;
  dose: string;
  scheduleTimes: ClockTime[];
  purpose?: string;
  critical: boolean;
  active: boolean;
  adherence: AdherenceCounts;
}

export interface DashboardData {
  generatedAt: IsoDateTime;
  today: LocalDate;
  localTime: ClockTime;
  elder: {
    id: string;
    name: string;
    preferredName: string;
    age: number;
    conditions: string[];
    allergies: string[];
  };
  household: { timezone: string; emergencyNumber: string };
  caregivers: Array<{ id: string; name: string; relationship: string; priority: number }>;
  adherence: AdherenceCounts & {
    days: number;
    perDay: Array<AdherenceCounts & { localDate: LocalDate }>;
  };
  medications: DashboardMedication[];
  todaysDoses: DashboardDose[];
  nextUp: DashboardDose | null;
  checkedInToday: boolean;
  latestCheckIn: DashboardCheckIn | null;
  /** Last 7 check-ins, oldest first. */
  checkInTrend: DashboardCheckIn[];
  openAlerts: DashboardAlert[];
  /** Most recent resolved alerts (audit trail), newest first. */
  recentlyResolved: DashboardAlert[];
  upcomingAppointments: DashboardAppointment[];
}
