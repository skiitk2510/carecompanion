/**
 * Domain model. Conventions (see CLAUDE.md):
 *  - every instant is a UTC ISO-8601 string (`IsoDateTime`);
 *  - "today" and schedule times are expressed in the household timezone (`LocalDate`, `ClockTime`);
 *  - scheduled dose slots are VIRTUAL (derived from `Medication.scheduleTimes`); only outcomes are stored as `DoseEvent`s.
 */

/** UTC instant, e.g. `2026-09-16T15:04:05.000Z`. */
export type IsoDateTime = string;
/** Calendar day in the household timezone, `YYYY-MM-DD`. */
export type LocalDate = string;
/** Wall-clock time in the household timezone, `HH:mm` (24h). */
export type ClockTime = string;

export interface Household {
  id: string;
  name: string;
  /** IANA timezone, e.g. `America/Los_Angeles`. */
  timezone: string;
  /** What the assistant tells the elder to call in an emergency, e.g. `911`. */
  emergencyNumber: string;
}

export interface ElderPrefs {
  preferredName: string;
  wakeTime: ClockTime;
  breakfastTime: ClockTime;
  lunchTime: ClockTime;
  dinnerTime: ClockTime;
  bedTime: ClockTime;
  /** If no check-in has been recorded by this time, caregivers get a `no_checkin` alert. */
  checkInDeadline: ClockTime;
}

export interface Elder {
  id: string;
  householdId: string;
  name: string;
  age: number;
  conditions: string[];
  allergies: string[];
  prefs: ElderPrefs;
}

export type CaregiverChannel = 'sms' | 'email' | 'push';

export interface Caregiver {
  id: string;
  householdId: string;
  name: string;
  relationship: string;
  channel: CaregiverChannel;
  /** 1 = first to be notified. */
  escalationPriority: number;
}

export interface Medication {
  id: string;
  elderId: string;
  /** Display name as the family says it, e.g. `Lisinopril`. */
  name: string;
  /** Normalized generic used by the interaction table, e.g. `lisinopril`. */
  genericName: string;
  dose: string;
  form?: string;
  scheduleTimes: ClockTime[];
  purpose?: string;
  instructions?: string;
  /** Missing a critical medication raises a critical alert. */
  critical: boolean;
  maxDailyDoses: number;
  minIntervalMin: number;
  /** Minutes after a scheduled slot during which a dose still counts as on time. */
  graceMin: number;
  active: boolean;
  addedAt: IsoDateTime;
  addedBy?: string;
}

export type DoseStatus = 'taken' | 'late' | 'missed' | 'skipped';
export type DoseSource = 'elder' | 'caregiver' | 'system' | 'seed';

/** A recorded outcome for one slot (or an unscheduled extra dose when `scheduledTime` is null). */
export interface DoseEvent {
  id: string;
  elderId: string;
  medicationId: string;
  localDate: LocalDate;
  scheduledTime: ClockTime | null;
  status: DoseStatus;
  /** When the dose was actually taken/recorded (null for `missed`). */
  recordedAt: IsoDateTime | null;
  source: DoseSource;
  reason?: string;
  /** Present only when a guard refusal was overridden with explicit confirmation. */
  overrideReason?: string;
}

export interface Appointment {
  id: string;
  elderId: string;
  title: string;
  at: IsoDateTime;
  location?: string;
  notes?: string;
}

export type SymptomSeverity = 'none' | 'watch' | 'urgent' | 'emergency';

export interface CheckIn {
  id: string;
  elderId: string;
  at: IsoDateTime;
  localDate: LocalDate;
  mood: string;
  symptoms: string[];
  notes?: string;
  severity: SymptomSeverity;
  flagged: boolean;
}

export type AlertType =
  'missed_dose' | 'skipped_dose' | 'dose_override' | 'no_checkin' | 'symptom' | 'help' | 'interaction' | 'ring';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  id: string;
  elderId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  createdAt: IsoDateTime;
  /** Id of the related dose/check-in/medication, when any. */
  refId?: string;
  /** Sweeps use this to stay idempotent (one alert per slot/day). */
  dedupeKey?: string;
  /** Caregiver ids that were (simulated-)notified. */
  notified: string[];
  acknowledgedBy?: string;
  acknowledgedAt?: IsoDateTime;
  resolvedBy?: string;
  resolvedAt?: IsoDateTime;
  resolution?: string;
}

export interface State {
  version: 1;
  households: Household[];
  elders: Elder[];
  caregivers: Caregiver[];
  medications: Medication[];
  doses: DoseEvent[];
  appointments: Appointment[];
  checkIns: CheckIn[];
  alerts: Alert[];
  seededAt?: IsoDateTime;
  scenario?: string;
}

export function emptyState(): State {
  return {
    version: 1,
    households: [],
    elders: [],
    caregivers: [],
    medications: [],
    doses: [],
    appointments: [],
    checkIns: [],
    alerts: [],
  };
}

export function isOpenAlert(alert: Alert): boolean {
  return alert.resolvedAt === undefined;
}
