/**
 * Today-relative synthetic household for demos and tests: the Hart family. Nothing in here is real data.
 *
 * Everything is derived from `now` in the household timezone, so the seed looks the same at any boot hour:
 * thirty local days of dose history (days -30 … -1) with a deterministic outcome pattern — all taken except six
 * scripted exceptions in the last week — seven check-ins, five alerts, three upcoming appointments and, by
 * scenario, today's already-taken slots.
 *
 * Last-week adherence (days -7 … -1): 42 slots = 36 taken + 3 late + 2 missed + 1 skipped, so
 * (taken + late) / due = 39 / 42 ≈ 92.9%. (The plan of record estimated "~88%"; the scripted exceptions below
 * give 92.9% — `computeAdherence` over its default 7-day window reports 36 / 39 = 0.923 and over 30 days
 * 174 / 177 = 0.983, see test/domain/adherence.test.ts.)
 *
 * Ids are deterministic (`SEED_IDS`, `seedDoseId`, `seedCheckInId`, `alert_seed_N`) so tests and demo scripts can
 * refer to them; only `runSweeps`-created entities use random ids.
 */
import type {
  Alert,
  Appointment,
  Caregiver,
  CheckIn,
  ClockTime,
  DoseEvent,
  DoseStatus,
  Elder,
  Household,
  IsoDateTime,
  LocalDate,
  Medication,
  State,
} from './model.js';
import { emptyState } from './model.js';
import { slotsForDay, type DoseSlot } from './slots.js';
import { addDays, addMinutes, isoOf, parseLocalDate, spokenClockTime, toLocalDate, zonedToUtc } from './time.js';

export type SeedScenario = 'default' | 'mid-morning' | 'evening';

export interface SeedOptions {
  now: Date;
  /** IANA timezone of the household; every local-day computation uses it. */
  tz: string;
  /**
   * Which of today's slots are pre-filled:
   *  - `default`: every slot whose grace window has already ended (so no missed alert fires at boot);
   *  - `mid-morning`: exactly the 08:00 slots, taken at 08:05 (the duplicate-dose demo beat), whatever the hour;
   *  - `evening`: the 08:00 and 18:00 slots, leaving the 21:00 simvastatin open.
   */
  scenario?: SeedScenario;
}

export const SEED_IDS = {
  household: 'household_hart',
  elder: 'elder_margaret',
  priya: 'cg_priya',
  daniel: 'cg_daniel',
  lisinopril: 'med_lisinopril',
  amlodipine: 'med_amlodipine',
  metformin: 'med_metformin',
  warfarin: 'med_warfarin',
  simvastatin: 'med_simvastatin',
} as const;

/** Deterministic id of a seeded dose event, e.g. `dose_warfarin_2026-09-10_1800`. */
export function seedDoseId(medicationId: string, localDate: LocalDate, scheduledTime: ClockTime): string {
  return `dose_${medicationId.replace(/^med_/, '')}_${localDate}_${scheduledTime.replace(':', '')}`;
}

/** Deterministic id of a seeded check-in, e.g. `checkin_2026-09-15`. */
export function seedCheckInId(localDate: LocalDate): string {
  return `checkin_${localDate}`;
}

/** Days of dose history before today — enough to cover the dashboard's 30-day adherence window. */
const DOSE_HISTORY_DAYS = 30;
/** Days of check-in history before today. */
const CHECKIN_HISTORY_DAYS = 7;
const MINUTES_PER_DAY = 24 * 60;

type SeedMedication = Omit<Medication, 'elderId' | 'active' | 'addedAt'>;

const MEDICATIONS: readonly SeedMedication[] = [
  {
    id: SEED_IDS.lisinopril,
    name: 'Lisinopril',
    genericName: 'lisinopril',
    dose: '10 mg',
    form: 'tablet',
    scheduleTimes: ['08:00'],
    purpose: 'blood pressure',
    critical: true,
    maxDailyDoses: 1,
    minIntervalMin: 720,
    graceMin: 90,
  },
  {
    id: SEED_IDS.amlodipine,
    name: 'Amlodipine',
    genericName: 'amlodipine',
    dose: '5 mg',
    form: 'tablet',
    scheduleTimes: ['08:00'],
    purpose: 'blood pressure',
    critical: false,
    maxDailyDoses: 1,
    minIntervalMin: 720,
    graceMin: 90,
  },
  {
    id: SEED_IDS.metformin,
    name: 'Metformin',
    genericName: 'metformin',
    dose: '500 mg',
    form: 'tablet',
    scheduleTimes: ['08:00', '18:00'],
    purpose: 'blood sugar',
    instructions: 'take with food',
    critical: false,
    maxDailyDoses: 2,
    minIntervalMin: 240,
    graceMin: 120,
  },
  {
    id: SEED_IDS.warfarin,
    name: 'Warfarin',
    genericName: 'warfarin',
    dose: '5 mg',
    form: 'tablet',
    scheduleTimes: ['18:00'],
    purpose: 'blood thinner',
    instructions: 'same time every evening',
    critical: true,
    maxDailyDoses: 1,
    minIntervalMin: 720,
    graceMin: 120,
  },
  {
    id: SEED_IDS.simvastatin,
    name: 'Simvastatin',
    genericName: 'simvastatin',
    dose: '20 mg',
    form: 'tablet',
    scheduleTimes: ['21:00'],
    purpose: 'cholesterol',
    critical: false,
    maxDailyDoses: 1,
    minIntervalMin: 720,
    graceMin: 120,
  },
];

interface HistoryException {
  status: DoseStatus;
  /** Minutes after the slot the outcome was recorded; null for `missed`. */
  minutesAfterSlot: number | null;
  reason?: string;
}

/** Keyed by `${dayOffset}|${medicationId}|${time}`. Every other history slot is `taken` a few minutes after the slot. */
const HISTORY_EXCEPTIONS: ReadonlyMap<string, HistoryException> = new Map<string, HistoryException>([
  ['-6|med_warfarin|18:00', { status: 'missed', minutesAfterSlot: null }],
  ['-5|med_lisinopril|08:00', { status: 'late', minutesAfterSlot: 95 }],
  ['-4|med_simvastatin|21:00', { status: 'missed', minutesAfterSlot: null }],
  ['-3|med_metformin|18:00', { status: 'late', minutesAfterSlot: 70 }],
  ['-2|med_simvastatin|21:00', { status: 'late', minutesAfterSlot: 60 }],
  ['-1|med_metformin|18:00', { status: 'skipped', minutesAfterSlot: 10, reason: 'upset stomach' }],
]);

/** Check-in moods for days -7 … -1. */
const CHECKIN_MOODS: readonly string[] = ['good', 'good', 'okay', 'good', 'great', 'okay', 'okay'];
const CHECKIN_TIME: ClockTime = '09:15';

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

/** `2026-09-10` → "September 10" — absolute wording, so seeded alert text does not go stale. */
function monthDay(localDate: LocalDate): string {
  const { year, month, day } = parseLocalDate(localDate);
  return MONTH_DAY.format(new Date(Date.UTC(year, month - 1, day)));
}

/** A recorded outcome for one virtual slot. `minutesAfterSlot` null ⇒ nothing was recorded (missed). */
function doseFor(slot: DoseSlot, status: DoseStatus, minutesAfterSlot: number | null, reason?: string): DoseEvent {
  const dose: DoseEvent = {
    id: seedDoseId(slot.medication.id, slot.localDate, slot.scheduledTime),
    elderId: slot.medication.elderId,
    medicationId: slot.medication.id,
    localDate: slot.localDate,
    scheduledTime: slot.scheduledTime,
    status,
    recordedAt: minutesAfterSlot === null ? null : isoOf(addMinutes(slot.scheduledAt, minutesAfterSlot)),
    source: status === 'missed' ? 'system' : status === 'skipped' ? 'elder' : 'seed',
  };
  if (reason) dose.reason = reason;
  return dose;
}

export function buildSeedState(opts: SeedOptions): State {
  const { now, tz } = opts;
  const scenario: SeedScenario = opts.scenario ?? 'default';
  const today = toLocalDate(now, tz);
  const dayMinus = (n: number): LocalDate => addDays(today, -n);
  const at = (localDate: LocalDate, time: ClockTime, minutesAfter = 0): IsoDateTime =>
    isoOf(addMinutes(zonedToUtc(localDate, time, tz), minutesAfter));

  const state = emptyState();

  const household: Household = {
    id: SEED_IDS.household,
    name: 'The Hart family',
    timezone: tz,
    emergencyNumber: '911',
  };
  const elder: Elder = {
    id: SEED_IDS.elder,
    householdId: household.id,
    name: 'Margaret Hart',
    age: 78,
    conditions: ['hypertension', 'type 2 diabetes', 'atrial fibrillation'],
    allergies: ['penicillin'],
    prefs: {
      preferredName: 'Margaret',
      wakeTime: '07:00',
      breakfastTime: '08:00',
      lunchTime: '12:30',
      dinnerTime: '18:00',
      bedTime: '21:30',
      checkInDeadline: '11:00',
    },
  };
  const caregivers: Caregiver[] = [
    {
      id: SEED_IDS.priya,
      householdId: household.id,
      name: 'Priya Hart-Singh',
      relationship: 'daughter',
      channel: 'sms',
      escalationPriority: 1,
    },
    {
      id: SEED_IDS.daniel,
      householdId: household.id,
      name: 'Daniel Hart',
      relationship: 'son',
      channel: 'email',
      escalationPriority: 2,
    },
  ];
  state.households.push(household);
  state.elders.push(elder);
  state.caregivers.push(...caregivers);

  const addedAt = isoOf(addMinutes(now, -60 * MINUTES_PER_DAY));
  for (const medication of MEDICATIONS) {
    state.medications.push({
      ...medication,
      scheduleTimes: [...medication.scheduleTimes],
      elderId: elder.id,
      active: true,
      addedAt,
    });
  }

  const appointments: Appointment[] = [
    {
      id: 'appt_seed_cardiology',
      elderId: elder.id,
      title: 'Cardiology follow-up with Dr. Chen',
      at: at(addDays(today, 3), '10:30'),
      location: 'Valley Heart Clinic',
    },
    {
      id: 'appt_seed_physical_therapy',
      elderId: elder.id,
      title: 'Physical therapy',
      at: at(addDays(today, 1), '14:00'),
      location: 'Sunrise Rehab Center',
    },
    {
      id: 'appt_seed_inr_draw',
      elderId: elder.id,
      title: 'INR blood draw',
      at: at(addDays(today, 9), '09:00'),
      location: 'Valley Heart Clinic lab',
    },
  ];
  state.appointments.push(...appointments);

  // Dose history (day -30 … day -1): every slot gets an outcome — taken, except the scripted exceptions in the
  // last week. Thirty days rather than seven so the 30-day adherence window is fully covered (otherwise the 23
  // earlier days, all inside the medications' `addedAt`, would count as 138 missed doses). Check-ins: last 7 days.
  for (let dayOffset = -DOSE_HISTORY_DAYS; dayOffset <= -1; dayOffset++) {
    const dayIndex = dayOffset + DOSE_HISTORY_DAYS; // 0 … 29, oldest day first
    const localDate = addDays(today, dayOffset);

    slotsForDay(state, elder.id, localDate, tz).forEach((slot, slotIndex) => {
      const exception = HISTORY_EXCEPTIONS.get(`${dayOffset}|${slot.medication.id}|${slot.scheduledTime}`);
      if (exception) {
        state.doses.push(doseFor(slot, exception.status, exception.minutesAfterSlot, exception.reason));
      } else {
        // Deterministic 2–12 minutes after the slot — no randomness, so snapshots and tests are reproducible.
        state.doses.push(doseFor(slot, 'taken', 2 + ((dayIndex * 3 + slotIndex * 5) % 11)));
      }
    });

    if (dayOffset < -CHECKIN_HISTORY_DAYS) continue;
    const moodIndex = dayOffset + CHECKIN_HISTORY_DAYS; // 0 … 6
    const isYesterday = dayOffset === -1;
    const checkIn: CheckIn = {
      id: seedCheckInId(localDate),
      elderId: elder.id,
      at: at(localDate, CHECKIN_TIME),
      localDate,
      mood: isYesterday ? 'okay' : (CHECKIN_MOODS[moodIndex] ?? 'okay'),
      symptoms: isYesterday ? ['a bit dizzy'] : [],
      severity: isYesterday ? 'urgent' : 'none',
      flagged: isYesterday,
    };
    if (isYesterday) checkIn.notes = 'Felt a bit dizzy getting up this morning; sat down and it passed.';
    state.checkIns.push(checkIn);
  }

  // Alerts: an audit trail of resolved ones, plus yesterday's dizziness alert left open for the demo.
  const warfarinMissedDay = dayMinus(6);
  const simvastatinMissedDay = dayMinus(4);
  const yesterday = dayMinus(1);
  const interactionCreatedAt = isoOf(addMinutes(now, -30 * MINUTES_PER_DAY));
  const alerts: Alert[] = [
    {
      id: 'alert_seed_1',
      elderId: elder.id,
      type: 'missed_dose',
      severity: 'critical',
      title: `Missed Warfarin (${spokenClockTime('18:00')})`,
      detail: `Warfarin 5 mg was due at ${spokenClockTime('18:00')} on ${monthDay(warfarinMissedDay)} and was not logged within its 120-minute grace window.`,
      createdAt: at(warfarinMissedDay, '18:00', 120),
      refId: seedDoseId(SEED_IDS.warfarin, warfarinMissedDay, '18:00'),
      dedupeKey: `missed:${SEED_IDS.warfarin}:${warfarinMissedDay}:18:00`,
      notified: [SEED_IDS.priya, SEED_IDS.daniel],
      acknowledgedBy: SEED_IDS.priya,
      acknowledgedAt: at(warfarinMissedDay, '18:00', 160),
      resolvedBy: SEED_IDS.priya,
      resolvedAt: at(warfarinMissedDay, '18:00', 160),
      resolution: 'Called Mom — she took it at 8:30 pm.',
    },
    {
      id: 'alert_seed_2',
      elderId: elder.id,
      type: 'missed_dose',
      severity: 'warning',
      title: `Missed Simvastatin (${spokenClockTime('21:00')})`,
      detail: `Simvastatin 20 mg was due at ${spokenClockTime('21:00')} on ${monthDay(simvastatinMissedDay)} and was not logged within its 120-minute grace window.`,
      createdAt: at(simvastatinMissedDay, '21:00', 120),
      refId: seedDoseId(SEED_IDS.simvastatin, simvastatinMissedDay, '21:00'),
      dedupeKey: `missed:${SEED_IDS.simvastatin}:${simvastatinMissedDay}:21:00`,
      notified: [SEED_IDS.priya],
      acknowledgedBy: SEED_IDS.daniel,
      acknowledgedAt: at(dayMinus(3), '08:30'),
      resolvedBy: SEED_IDS.daniel,
      resolvedAt: at(dayMinus(3), '08:30'),
      resolution: 'Noted, will set a bedtime reminder.',
    },
    {
      id: 'alert_seed_3',
      elderId: elder.id,
      type: 'interaction',
      severity: 'info',
      title: 'Simvastatin + Amlodipine (moderate)',
      detail:
        'Amlodipine can raise simvastatin blood levels; simvastatin doses above 20 mg are usually avoided alongside amlodipine. Informational only — not medical advice.',
      createdAt: interactionCreatedAt,
      refId: SEED_IDS.simvastatin,
      dedupeKey: 'interaction:amlodipine:simvastatin',
      notified: [SEED_IDS.priya],
      acknowledgedBy: SEED_IDS.priya,
      acknowledgedAt: isoOf(addMinutes(interactionCreatedAt, MINUTES_PER_DAY)),
      resolvedBy: SEED_IDS.priya,
      resolvedAt: isoOf(addMinutes(interactionCreatedAt, MINUTES_PER_DAY)),
      resolution: 'Discussed with Dr. Chen — the 20 mg dose is fine.',
    },
    {
      id: 'alert_seed_4',
      elderId: elder.id,
      type: 'symptom',
      severity: 'critical',
      title: 'Margaret reported dizziness at check-in',
      detail: `At the ${spokenClockTime(CHECKIN_TIME)} check-in on ${monthDay(yesterday)} Margaret said she felt "a bit dizzy". Dizziness is on the urgent list for someone on blood-pressure medication and a blood thinner.`,
      createdAt: at(yesterday, CHECKIN_TIME),
      refId: seedCheckInId(yesterday),
      dedupeKey: `symptom:${seedCheckInId(yesterday)}`,
      notified: [SEED_IDS.priya],
      acknowledgedBy: SEED_IDS.priya,
      acknowledgedAt: at(yesterday, CHECKIN_TIME, 20),
    },
    {
      id: 'alert_seed_5',
      elderId: elder.id,
      type: 'skipped_dose',
      severity: 'info',
      title: `Skipped Metformin (${spokenClockTime('18:00')})`,
      detail: `Margaret skipped her ${spokenClockTime('18:00')} Metformin on ${monthDay(yesterday)} — reason: upset stomach.`,
      createdAt: at(yesterday, '18:00', 10),
      refId: seedDoseId(SEED_IDS.metformin, yesterday, '18:00'),
      dedupeKey: `skipped:${seedDoseId(SEED_IDS.metformin, yesterday, '18:00')}`,
      notified: [SEED_IDS.priya],
      acknowledgedBy: SEED_IDS.priya,
      acknowledgedAt: at(yesterday, '18:00', 45),
      resolvedBy: SEED_IDS.priya,
      resolvedAt: at(yesterday, '18:00', 45),
      resolution: 'Talked to Mom — her stomach settled after dinner; back to the usual dose tomorrow.',
    },
  ];
  state.alerts.push(...alerts);

  // Today, by scenario. No check-in today in any scenario.
  for (const slot of slotsForDay(state, elder.id, today, tz)) {
    const minutesAfterSlot = todayTakenAfter(scenario, slot, now);
    if (minutesAfterSlot !== null) state.doses.push(doseFor(slot, 'taken', minutesAfterSlot));
  }

  state.seededAt = isoOf(now);
  state.scenario = scenario;
  return state;
}

/** Minutes after the slot at which today's dose was taken in this scenario, or null to leave the slot open. */
function todayTakenAfter(scenario: SeedScenario, slot: DoseSlot, now: Date): number | null {
  switch (scenario) {
    case 'default':
      // `<=` rather than `<`: a slot whose grace ends exactly now would otherwise be swept as missed at boot.
      return slot.graceEndsAt.getTime() <= now.getTime() ? 5 : null;
    case 'mid-morning':
      return slot.scheduledTime === '08:00' ? 5 : null;
    case 'evening':
      if (slot.scheduledTime === '08:00') return 5;
      if (slot.scheduledTime === '18:00') return 10;
      return null;
  }
}
