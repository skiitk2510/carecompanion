/**
 * Dose guard — the safety check that runs before a dose is recorded. Pure: it returns a verdict and never touches
 * `state`; the caller records the `DoseEvent` (and, for an override, the `dose_override` alert).
 *
 * Checks run in order: inactive medication → daily maximum → minimum interval → allow (attached to the nearest
 * open slot). A refusal that `requiresConfirmation` can be overridden with `confirmOverride` plus a short reason.
 */
import type { DoseEvent, IsoDateTime, LocalDate, Medication, State } from '../model.js';
import { nearestOpenSlot, slotsForMedication, type DoseSlot } from '../slots.js';
import {
  addDays,
  addMinutes,
  isoOf,
  minutesBetween,
  spokenClockTime,
  spokenTime,
  startOfLocalDay,
  toLocalDate,
} from '../time.js';

export interface DoseGuardInput {
  state: Readonly<State>;
  medication: Medication;
  /** When the dose is being recorded — usually the clock's now. */
  at: Date;
  /** Household IANA timezone. */
  tz: string;
  /** The elder (or a caregiver) explicitly said "yes, record it anyway". */
  confirmOverride?: boolean;
  /** Why the extra dose is needed; an override goes through only with a reason of at least 3 characters. */
  overrideReason?: string;
}

export type DoseGuardRefusal = 'inactive' | 'max_daily' | 'min_interval';

export type DoseGuardVerdict =
  | { kind: 'allow'; status: 'taken' | 'late'; slot: DoseSlot | null; spoken: string }
  | {
      kind: 'refuse';
      reason: DoseGuardRefusal;
      /** True when a confirmed override with a reason would be accepted. */
      requiresConfirmation: boolean;
      lastTakenAt: IsoDateTime | null;
      nextAllowedAt: IsoDateTime | null;
      spoken: string;
    }
  | { kind: 'allow_override'; status: 'taken'; slot: DoseSlot | null; lastTakenAt: IsoDateTime | null; spoken: string };

/** Shortest override reason that counts as "told me why". */
export const MIN_OVERRIDE_REASON_LENGTH = 3;

const OVERRIDE_PROMPT = `I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why.`;
const REASON_PROMPT = 'I can record it anyway, but I need a reason first. Please tell me why you need the extra dose.';

interface Refusal {
  reason: 'max_daily' | 'min_interval';
  lastTakenAt: IsoDateTime | null;
  nextAllowedAt: IsoDateTime;
  /** The first sentence — what happened — spoken before the override prompt. */
  context: string;
}

export function checkDoseGuard(input: DoseGuardInput): DoseGuardVerdict {
  const { state, medication, at, tz } = input;
  const name = medication.name;

  if (!medication.active) {
    return {
      kind: 'refuse',
      reason: 'inactive',
      requiresConfirmation: false,
      lastTakenAt: null,
      nextAllowedAt: null,
      spoken: `${name} isn't on your active list, so I haven't recorded anything. Please check with your caregiver.`,
    };
  }

  const today = toLocalDate(at, tz);
  const taken = state.doses.filter((d) => d.medicationId === medication.id && wasTaken(d));
  const takenToday = taken.filter((d) => d.localDate === today);
  // The interval check looks at the most recent dose on any day, so a late-night dose still counts after midnight.
  const lastTakenAt = latestRecordedAt(taken);

  if (takenToday.length >= medication.maxDailyDoses) {
    const lastToday = latestRecordedAt(takenToday) ?? lastTakenAt;
    return refuseOrOverride(input, today, {
      reason: 'max_daily',
      lastTakenAt,
      nextAllowedAt: isoOf(startOfLocalDay(addDays(today, 1), tz)),
      context: lastToday
        ? `You already took ${name} at ${spokenTime(lastToday, tz)} today.`
        : `You've already had all of today's ${name}.`,
    });
  }

  if (lastTakenAt !== null) {
    const elapsed = minutesBetween(lastTakenAt, at);
    if (elapsed < medication.minIntervalMin) {
      return refuseOrOverride(input, today, {
        reason: 'min_interval',
        lastTakenAt,
        nextAllowedAt: isoOf(addMinutes(lastTakenAt, medication.minIntervalMin)),
        context:
          `You took ${name} ${spokenDuration(elapsed, 'approx')} ago; ` +
          `doses should be at least ${spokenDuration(medication.minIntervalMin)} apart.`,
      });
    }
  }

  const slots = slotsForMedication(state, medication, today, tz);
  const slot = nearestOpenSlot(slots, at);
  if (!slot) {
    // No schedule today (as-needed medication, or added after its last slot) vs. every slot already fulfilled.
    const spoken = slots.length === 0 ? `Got it — ${name} recorded.` : `Got it — an extra ${name} recorded.`;
    return { kind: 'allow', status: 'taken', slot: null, spoken };
  }

  const slotTime = spokenClockTime(slot.scheduledTime);
  if (at.getTime() <= slot.graceEndsAt.getTime()) {
    const label = [name, medication.dose].filter((s) => s.trim().length > 0).join(' ');
    return { kind: 'allow', status: 'taken', slot, spoken: `Got it — ${label} recorded for your ${slotTime} dose.` };
  }
  return {
    kind: 'allow',
    status: 'late',
    slot,
    spoken: `Got it — ${name} recorded. That was your ${slotTime} dose, a little late.`,
  };
}

function refuseOrOverride(input: DoseGuardInput, today: LocalDate, refusal: Refusal): DoseGuardVerdict {
  const { state, medication, at, tz } = input;
  const reason = (input.overrideReason ?? '').trim();

  if (input.confirmOverride === true && reason.length >= MIN_OVERRIDE_REASON_LENGTH) {
    const slots = slotsForMedication(state, medication, today, tz);
    return {
      kind: 'allow_override',
      status: 'taken',
      slot: nearestOpenSlot(slots, at),
      lastTakenAt: refusal.lastTakenAt,
      spoken: `Okay — I've recorded the extra ${medication.name} and flagged it for your caregiver with your reason.`,
    };
  }

  const prompt = input.confirmOverride === true ? REASON_PROMPT : OVERRIDE_PROMPT;
  return {
    kind: 'refuse',
    reason: refusal.reason,
    requiresConfirmation: true,
    lastTakenAt: refusal.lastTakenAt,
    nextAllowedAt: refusal.nextAllowedAt,
    spoken: `${refusal.context} ${prompt}`,
  };
}

function wasTaken(dose: DoseEvent): boolean {
  return dose.status === 'taken' || dose.status === 'late';
}

function latestRecordedAt(doses: readonly DoseEvent[]): IsoDateTime | null {
  let latest: IsoDateTime | null = null;
  for (const dose of doses) {
    if (dose.recordedAt === null) continue;
    if (latest === null || new Date(dose.recordedAt).getTime() > new Date(latest).getTime()) latest = dose.recordedAt;
  }
  return latest;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * Minutes as speech: "25 minutes", "6 hours", and for a non-whole number of hours either "about 2 hours"
 * (`approx`, for elapsed time) or "1 hour and 30 minutes" (`exact`, for a rule).
 */
export function spokenDuration(minutes: number, style: 'approx' | 'exact' = 'exact'): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 1) return 'less than a minute';
  if (total < 60) return plural(total, 'minute');
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (rest === 0) return plural(hours, 'hour');
  if (style === 'approx') return `about ${plural(Math.round(total / 60), 'hour')}`;
  return `${plural(hours, 'hour')} and ${plural(rest, 'minute')}`;
}
