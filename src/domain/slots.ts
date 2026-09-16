/**
 * Virtual dose slots. A slot is (medication × scheduled time × local day); it exists in the schedule, not in the
 * store. Outcomes (`DoseEvent`) attach to a slot by (medicationId, localDate, scheduledTime).
 */
import type { ClockTime, DoseEvent, DoseStatus, LocalDate, Medication, State } from './model.js';
import { addMinutes, zonedToUtc } from './time.js';

export type SlotStatus = 'scheduled' | DoseStatus;

export interface DoseSlot {
  medication: Medication;
  localDate: LocalDate;
  scheduledTime: ClockTime;
  /** UTC instant of the slot in the household timezone. */
  scheduledAt: Date;
  /** After this instant an unfulfilled slot counts as missed. */
  graceEndsAt: Date;
  event: DoseEvent | null;
  status: SlotStatus;
}

export function slotEvent(
  state: Readonly<State>,
  medicationId: string,
  localDate: LocalDate,
  scheduledTime: ClockTime
): DoseEvent | undefined {
  return state.doses.find(
    (d) => d.medicationId === medicationId && d.localDate === localDate && d.scheduledTime === scheduledTime
  );
}

/**
 * All slots for one elder on one local day, sorted by time. A medication added after a slot's time does not get
 * that slot (so adding a drug at 10:30 never produces a "missed 8 a.m. dose").
 */
export function slotsForDay(
  state: Readonly<State>,
  elderId: string,
  localDate: LocalDate,
  tz: string,
  opts: { includeInactive?: boolean } = {}
): DoseSlot[] {
  const slots: DoseSlot[] = [];
  for (const medication of state.medications) {
    if (medication.elderId !== elderId) continue;
    if (!medication.active && !opts.includeInactive) continue;
    const addedAt = new Date(medication.addedAt).getTime();
    for (const scheduledTime of medication.scheduleTimes) {
      const scheduledAt = zonedToUtc(localDate, scheduledTime, tz);
      if (scheduledAt.getTime() < addedAt) continue;
      const event = slotEvent(state, medication.id, localDate, scheduledTime) ?? null;
      slots.push({
        medication,
        localDate,
        scheduledTime,
        scheduledAt,
        graceEndsAt: addMinutes(scheduledAt, medication.graceMin),
        event,
        status: event?.status ?? 'scheduled',
      });
    }
  }
  return slots.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

export function slotsForMedication(
  state: Readonly<State>,
  medication: Medication,
  localDate: LocalDate,
  tz: string
): DoseSlot[] {
  return slotsForDay(state, medication.elderId, localDate, tz, { includeInactive: true }).filter(
    (s) => s.medication.id === medication.id
  );
}

/** Recorded outcomes on a day, scheduled or extra, newest first. */
export function dosesOnDay(state: Readonly<State>, elderId: string, localDate: LocalDate): DoseEvent[] {
  return state.doses
    .filter((d) => d.elderId === elderId && d.localDate === localDate)
    .sort((a, b) => (b.recordedAt ?? '').localeCompare(a.recordedAt ?? ''));
}

/** The unfulfilled slot closest in time to `at` — the slot an "I took it" most likely refers to. */
export function nearestOpenSlot(slots: DoseSlot[], at: Date): DoseSlot | null {
  let best: DoseSlot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    if (slot.event) continue;
    const distance = Math.abs(slot.scheduledAt.getTime() - at.getTime());
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}

/** The first unfulfilled slot that is still on time (grace not yet over), or null. */
export function nextUpcomingSlot(slots: DoseSlot[], at: Date): DoseSlot | null {
  return slots.find((slot) => !slot.event && slot.graceEndsAt.getTime() >= at.getTime()) ?? null;
}
