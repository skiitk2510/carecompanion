/**
 * Lazy alert sweeps. CareCompanion has no timers: read handlers call `runSweeps` first, which records `missed`
 * outcomes for slots whose grace window has passed and raises the matching alerts, then raises a `no_checkin`
 * alert once the elder's check-in deadline has gone by without a check-in. `createAlert`'s `dedupeKey` makes every
 * sweep idempotent, so calling it on every read is safe; only entities created by this call are returned.
 *
 * This is the one domain function that mutates `state` by design.
 */
import { caregiversFor, createAlert } from './alerts.js';
import { newId } from './ids.js';
import type { Alert, DoseEvent, Elder, LocalDate, State } from './model.js';
import { slotsForDay, type DoseSlot } from './slots.js';
import { addDays, spokenClockTime, spokenDay, spokenTime, toLocalDate, zonedToUtc } from './time.js';

export interface SweepResult {
  /** `missed` dose events recorded by this call. */
  missedDoses: DoseEvent[];
  /** Alerts created by this call (deduplicated ones are not repeated). */
  alerts: Alert[];
}

export function runSweeps(state: State, now: Date, tz: string): SweepResult {
  const result: SweepResult = { missedDoses: [], alerts: [] };
  const today = toLocalDate(now, tz);
  const yesterday = addDays(today, -1);

  for (const elder of state.elders) {
    const caregiverIds = caregiversFor(state, elder.id).map((c) => c.id);
    for (const localDate of [yesterday, today]) {
      for (const slot of slotsForDay(state, elder.id, localDate, tz)) {
        // Never touch a slot that already has an outcome of any status, or one that is still within grace.
        if (slot.event !== null || slot.graceEndsAt.getTime() > now.getTime()) continue;
        sweepMissedSlot(state, elder, slot, caregiverIds, today, now, tz, result);
      }
    }
    sweepCheckIn(state, elder, caregiverIds, today, now, tz, result);
  }
  return result;
}

function sweepMissedSlot(
  state: State,
  elder: Elder,
  slot: DoseSlot,
  caregiverIds: string[],
  today: LocalDate,
  now: Date,
  tz: string,
  result: SweepResult
): void {
  const medication = slot.medication;
  const dose: DoseEvent = {
    id: newId('dose'),
    elderId: elder.id,
    medicationId: medication.id,
    localDate: slot.localDate,
    scheduledTime: slot.scheduledTime,
    status: 'missed',
    recordedAt: null,
    source: 'system',
  };
  state.doses.push(dose);
  result.missedDoses.push(dose);

  const when = `${spokenClockTime(slot.scheduledTime)} ${spokenDay(slot.localDate, today, tz)}`;
  const { alert, created } = createAlert(
    state,
    {
      elderId: elder.id,
      type: 'missed_dose',
      severity: medication.critical ? 'critical' : 'warning',
      title: `Missed ${medication.name} (${spokenClockTime(slot.scheduledTime)})`,
      detail: `${elder.prefs.preferredName} has not logged ${medication.name} ${medication.dose} due ${when}; the ${medication.graceMin}-minute grace window ended at ${spokenTime(slot.graceEndsAt, tz)}.`,
      refId: dose.id,
      dedupeKey: `missed:${medication.id}:${slot.localDate}:${slot.scheduledTime}`,
      // A missed critical medication escalates to every caregiver (priority order); otherwise just the first.
      notified: medication.critical ? caregiverIds : caregiverIds.slice(0, 1),
    },
    now
  );
  if (created) result.alerts.push(alert);
}

function sweepCheckIn(
  state: State,
  elder: Elder,
  caregiverIds: string[],
  today: LocalDate,
  now: Date,
  tz: string,
  result: SweepResult
): void {
  const deadline = elder.prefs.checkInDeadline;
  if (now.getTime() < zonedToUtc(today, deadline, tz).getTime()) return;
  if (state.checkIns.some((c) => c.elderId === elder.id && c.localDate === today)) return;

  const name = elder.prefs.preferredName;
  const { alert, created } = createAlert(
    state,
    {
      elderId: elder.id,
      type: 'no_checkin',
      severity: 'warning',
      title: `No check-in from ${name} yet`,
      detail: `${name} has not checked in today; the check-in deadline is ${spokenClockTime(deadline)}.`,
      dedupeKey: `nocheckin:${elder.id}:${today}`,
      notified: caregiverIds.slice(0, 1),
    },
    now
  );
  if (created) result.alerts.push(alert);
}
