import { describe, expect, it } from 'vitest';
import { checkDoseGuard, spokenDuration, type DoseGuardInput } from '../../../src/domain/guardrails/doseGuard.js';
import { emptyState, type DoseEvent, type Medication, type State } from '../../../src/domain/model.js';
import { fixedClock, zonedToUtc } from '../../../src/domain/time.js';

const LA = 'America/Los_Angeles';
const DAY = '2026-09-16';

const at = (time: string, day = DAY): Date => zonedToUtc(day, time, LA);
const iso = (time: string, day = DAY): string => at(time, day).toISOString();

function medication(overrides: Partial<Medication> & Pick<Medication, 'id' | 'name'>): Medication {
  return {
    elderId: 'elder_rosa',
    genericName: overrides.name.toLowerCase(),
    dose: '10mg',
    scheduleTimes: ['08:00'],
    critical: true,
    maxDailyDoses: 1,
    minIntervalMin: 720,
    graceMin: 90,
    active: true,
    addedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const lisinopril = medication({ id: 'med_lis', name: 'Lisinopril', dose: '10mg' });
const metformin = medication({
  id: 'med_met',
  name: 'Metformin',
  dose: '500mg',
  scheduleTimes: ['08:00', '18:00'],
  maxDailyDoses: 2,
  minIntervalMin: 240,
  critical: false,
});
const acetaminophen = medication({
  id: 'med_apap',
  name: 'Acetaminophen',
  dose: '500mg',
  scheduleTimes: ['08:00'],
  maxDailyDoses: 4,
  minIntervalMin: 240,
  graceMin: 60,
  critical: false,
});
const asNeeded = medication({
  id: 'med_prn',
  name: 'Antacid',
  dose: '1 tablet',
  scheduleTimes: [],
  maxDailyDoses: 3,
  minIntervalMin: 60,
  critical: false,
});

function taken(
  med: Medication,
  time: string,
  opts: { scheduledTime?: string | null; status?: DoseEvent['status']; day?: string } = {}
): DoseEvent {
  const day = opts.day ?? DAY;
  return {
    id: `dose_${med.id}_${day}_${time}`,
    elderId: med.elderId,
    medicationId: med.id,
    localDate: day,
    scheduledTime: opts.scheduledTime === undefined ? (med.scheduleTimes[0] ?? null) : opts.scheduledTime,
    status: opts.status ?? 'taken',
    recordedAt: opts.status === 'missed' ? null : iso(time, day),
    source: 'elder',
  };
}

function stateWith(...doses: DoseEvent[]): State {
  const state = emptyState();
  state.medications.push(lisinopril, metformin, acetaminophen, asNeeded);
  state.doses.push(...doses);
  return state;
}

function check(overrides: Partial<DoseGuardInput> & Pick<DoseGuardInput, 'medication' | 'at'>) {
  return checkDoseGuard({ state: stateWith(), tz: LA, ...overrides });
}

describe('checkDoseGuard — allowing doses', () => {
  it('records an on-time dose against its slot', () => {
    const clock = fixedClock('2026-09-16T15:05:00.000Z'); // 8:05 a.m. in LA
    const verdict = check({ medication: lisinopril, at: clock.now() });
    expect(verdict.kind).toBe('allow');
    if (verdict.kind !== 'allow') return;
    expect(verdict.status).toBe('taken');
    expect(verdict.slot?.scheduledTime).toBe('08:00');
    expect(verdict.spoken).toBe('Got it — Lisinopril 10mg recorded for your 8 a.m. dose.');
  });

  it('marks a dose late once the grace period is over', () => {
    const verdict = check({ medication: lisinopril, at: at('10:30') }); // grace ended 9:30
    expect(verdict.kind).toBe('allow');
    if (verdict.kind !== 'allow') return;
    expect(verdict.status).toBe('late');
    expect(verdict.slot?.scheduledTime).toBe('08:00');
    expect(verdict.spoken).toBe('Got it — Lisinopril recorded. That was your 8 a.m. dose, a little late.');
  });

  it('attaches an early dose to the upcoming slot', () => {
    const state = stateWith(taken(metformin, '08:05'));
    const verdict = check({ state, medication: metformin, at: at('16:30') });
    expect(verdict.kind).toBe('allow');
    if (verdict.kind !== 'allow') return;
    expect(verdict.status).toBe('taken');
    expect(verdict.slot?.scheduledTime).toBe('18:00');
    expect(verdict.spoken).toContain('6 p.m. dose');
  });

  it('allows an extra dose under the daily maximum when every slot is fulfilled (slot null)', () => {
    const state = stateWith(taken(acetaminophen, '08:02'));
    const verdict = check({ state, medication: acetaminophen, at: at('14:00') });
    expect(verdict).toEqual({
      kind: 'allow',
      status: 'taken',
      slot: null,
      spoken: 'Got it — an extra Acetaminophen recorded.',
    });
  });

  it('records an as-needed medication with no schedule as a plain dose', () => {
    const verdict = check({ medication: asNeeded, at: at('14:00') });
    expect(verdict).toEqual({ kind: 'allow', status: 'taken', slot: null, spoken: 'Got it — Antacid recorded.' });
  });

  it('ignores skipped and missed outcomes when counting doses', () => {
    const state = stateWith(taken(lisinopril, '08:00', { status: 'skipped' }));
    const verdict = check({ state, medication: lisinopril, at: at('14:00') });
    expect(verdict.kind).toBe('allow');
    if (verdict.kind !== 'allow') return;
    expect(verdict.status).toBe('taken');
    expect(verdict.slot).toBeNull(); // the 8 a.m. slot already has an outcome
  });
});

describe('checkDoseGuard — refusing doses', () => {
  it('refuses a second dose once the daily maximum is reached', () => {
    const state = stateWith(taken(lisinopril, '08:05'));
    const verdict = check({ state, medication: lisinopril, at: at('14:00') });
    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.reason).toBe('max_daily');
    expect(verdict.requiresConfirmation).toBe(true);
    expect(verdict.lastTakenAt).toBe('2026-09-16T15:05:00.000Z');
    expect(verdict.nextAllowedAt).toBe('2026-09-17T07:00:00.000Z'); // next local midnight in LA
    expect(verdict.spoken).toBe(
      'You already took Lisinopril at 8:05 a.m. today. ' +
        `I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why.`
    );
    expect(verdict.spoken).toContain('at 8:05 a.m. today');
    expect(verdict.spoken).toContain('say "yes, record it anyway"');
  });

  it('refuses a dose that comes too soon after the last one', () => {
    const state = stateWith(taken(metformin, '08:05'));
    const verdict = check({ state, medication: metformin, at: at('08:30') });
    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.reason).toBe('min_interval');
    expect(verdict.requiresConfirmation).toBe(true);
    expect(verdict.lastTakenAt).toBe(iso('08:05'));
    expect(verdict.nextAllowedAt).toBe(iso('12:05'));
    expect(verdict.spoken).toBe(
      'You took Metformin 25 minutes ago; doses should be at least 4 hours apart. ' +
        `I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why.`
    );
  });

  it('still applies the interval across midnight', () => {
    const state = stateWith(taken(metformin, '23:30', { day: '2026-09-15', scheduledTime: null }));
    const verdict = check({ state, medication: metformin, at: at('01:00') });
    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.reason).toBe('min_interval');
    expect(verdict.lastTakenAt).toBe(iso('23:30', '2026-09-15'));
    expect(verdict.nextAllowedAt).toBe(iso('03:30'));
    expect(verdict.spoken).toContain('about 2 hours ago');
  });

  it('refuses an inactive medication without offering an override', () => {
    const inactive = { ...lisinopril, active: false };
    const verdict = check({
      medication: inactive,
      at: at('08:05'),
      confirmOverride: true,
      overrideReason: 'doctor said to',
    });
    expect(verdict).toEqual({
      kind: 'refuse',
      reason: 'inactive',
      requiresConfirmation: false,
      lastTakenAt: null,
      nextAllowedAt: null,
      spoken: "Lisinopril isn't on your active list, so I haven't recorded anything. Please check with your caregiver.",
    });
  });
});

describe('checkDoseGuard — overrides', () => {
  const state = stateWith(taken(lisinopril, '08:05'));

  it('records an extra dose when the override is confirmed with a reason', () => {
    const verdict = check({
      state,
      medication: lisinopril,
      at: at('14:00'),
      confirmOverride: true,
      overrideReason: 'doctor said to',
    });
    expect(verdict).toEqual({
      kind: 'allow_override',
      status: 'taken',
      slot: null,
      lastTakenAt: iso('08:05'),
      spoken: "Okay — I've recorded the extra Lisinopril and flagged it for your caregiver with your reason.",
    });
  });

  it('keeps refusing when the override has no reason, and asks for one', () => {
    for (const overrideReason of [undefined, '', '  ', 'ok']) {
      const verdict = check({ state, medication: lisinopril, at: at('14:00'), confirmOverride: true, overrideReason });
      expect(verdict.kind).toBe('refuse');
      if (verdict.kind !== 'refuse') return;
      expect(verdict.reason).toBe('max_daily');
      expect(verdict.requiresConfirmation).toBe(true);
      expect(verdict.lastTakenAt).toBe(iso('08:05'));
      expect(verdict.nextAllowedAt).toBe('2026-09-17T07:00:00.000Z');
      expect(verdict.spoken).toContain('You already took Lisinopril at 8:05 a.m. today.');
      expect(verdict.spoken).toContain('Please tell me why you need the extra dose.');
    }
  });

  it('ignores a reason given without confirmation', () => {
    const verdict = check({ state, medication: lisinopril, at: at('14:00'), overrideReason: 'doctor said to' });
    expect(verdict.kind).toBe('refuse');
  });

  it('attaches an interval override to the nearest open slot', () => {
    const verdict = check({
      state: stateWith(taken(metformin, '08:05')),
      medication: metformin,
      at: at('08:30'),
      confirmOverride: true,
      overrideReason: 'pharmacist changed the dose',
    });
    expect(verdict.kind).toBe('allow_override');
    if (verdict.kind !== 'allow_override') return;
    expect(verdict.slot?.scheduledTime).toBe('18:00');
    expect(verdict.lastTakenAt).toBe(iso('08:05'));
  });
});

describe('spokenDuration', () => {
  it('speaks minutes and hours plainly', () => {
    expect(spokenDuration(0.4)).toBe('less than a minute');
    expect(spokenDuration(1)).toBe('1 minute');
    expect(spokenDuration(25)).toBe('25 minutes');
    expect(spokenDuration(60)).toBe('1 hour');
    expect(spokenDuration(360)).toBe('6 hours');
    expect(spokenDuration(90)).toBe('1 hour and 30 minutes');
    expect(spokenDuration(90, 'approx')).toBe('about 2 hours');
    expect(spokenDuration(70, 'approx')).toBe('about 1 hour');
  });
});
