/**
 * Adherence over a window of local days ending today. A virtual slot is DUE once its grace window has ended
 * (`graceEndsAt <= now`), so past days count every slot and today counts only the slots already past grace; future
 * slots are never counted. `rate = (taken + late) / due` — skipped and missed are both non-adherent — rounded to
 * three decimals, null when nothing was due.
 */
import type { LocalDate, State } from './model.js';
import { slotsForDay, type DoseSlot } from './slots.js';
import { addDays, toLocalDate } from './time.js';

export interface AdherenceBucket {
  due: number;
  taken: number;
  late: number;
  missed: number;
  skipped: number;
  /** (taken + late) / due, 3 decimals; null when `due` is 0. */
  rate: number | null;
}

export interface AdherenceSummary extends AdherenceBucket {
  days: number;
  from: LocalDate;
  to: LocalDate;
  /** Chronological, one entry per day of the window (a day with nothing due has `rate: null`). */
  perDay: Array<AdherenceBucket & { localDate: LocalDate }>;
  /** Every medication with at least one due slot in the window (inactive ones included), sorted by name. */
  perMedication: Array<AdherenceBucket & { medicationId: string; name: string }>;
}

type Outcome = 'taken' | 'late' | 'missed' | 'skipped';

type Tally = Record<Outcome | 'due', number>;

function newTally(): Tally {
  return { due: 0, taken: 0, late: 0, missed: 0, skipped: 0 };
}

/** A slot with no event, or with a `missed` event, counts as missed. */
function outcomeOf(slot: DoseSlot): Outcome {
  const status = slot.event?.status;
  return status === 'taken' || status === 'late' || status === 'skipped' ? status : 'missed';
}

function count(tally: Tally, outcome: Outcome): void {
  tally.due += 1;
  tally[outcome] += 1;
}

function bucketOf(tally: Tally): AdherenceBucket {
  const rate = tally.due === 0 ? null : Math.round(((tally.taken + tally.late) / tally.due) * 1000) / 1000;
  return { due: tally.due, taken: tally.taken, late: tally.late, missed: tally.missed, skipped: tally.skipped, rate };
}

export function computeAdherence(
  state: Readonly<State>,
  elderId: string,
  days: number,
  now: Date,
  tz: string
): AdherenceSummary {
  const span = Math.max(1, Math.floor(days));
  const to = toLocalDate(now, tz);
  const from = addDays(to, -(span - 1));
  const nowMs = now.getTime();

  const total = newTally();
  const perDay: AdherenceSummary['perDay'] = [];
  const perMedication = new Map<string, { name: string; tally: Tally }>();

  for (let i = 0; i < span; i++) {
    const localDate = addDays(from, i);
    const day = newTally();
    for (const slot of slotsForDay(state, elderId, localDate, tz, { includeInactive: true })) {
      if (slot.graceEndsAt.getTime() > nowMs) continue; // not due yet (today's later slots, or the future)
      const outcome = outcomeOf(slot);
      count(total, outcome);
      count(day, outcome);
      let med = perMedication.get(slot.medication.id);
      if (!med) {
        med = { name: slot.medication.name, tally: newTally() };
        perMedication.set(slot.medication.id, med);
      }
      count(med.tally, outcome);
    }
    perDay.push({ localDate, ...bucketOf(day) });
  }

  return {
    ...bucketOf(total),
    days: span,
    from,
    to,
    perDay,
    perMedication: [...perMedication.entries()]
      .map(([medicationId, { name, tally }]) => ({ medicationId, name, ...bucketOf(tally) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
