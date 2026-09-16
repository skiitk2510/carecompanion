import { describe, expect, it } from 'vitest';
import { computeAdherence } from '../../src/domain/adherence.js';
import { emptyState, type State } from '../../src/domain/model.js';
import { buildSeedState, SEED_IDS, seedDoseId } from '../../src/domain/seed.js';
import { addMinutes, fixedClock, isoOf, zonedToUtc } from '../../src/domain/time.js';

const TODAY = '2026-09-16';

/** 10:30 local today in two households. */
const HOUSEHOLDS = [
  { tz: 'America/Los_Angeles', iso: '2026-09-16T17:30:00.000Z' },
  { tz: 'Asia/Kolkata', iso: '2026-09-16T05:00:00.000Z' },
];

describe.each(HOUSEHOLDS)('computeAdherence over the seed ($tz, 10:30 local)', ({ tz, iso }) => {
  const now = fixedClock(iso).now();

  it('7-day window: 39 due = 33 taken + 3 late + 2 missed + 1 skipped → 36 / 39 = 0.923', () => {
    const state = buildSeedState({ now, tz });
    const summary = computeAdherence(state, SEED_IDS.elder, 7, now, tz);

    // Window = 2026-09-10 … 2026-09-16 (day -6 … today). Six past days × 6 slots = 36 due, plus today's three
    // 08:00 slots whose grace ended before 10:30 = 39 due. Exceptions inside the window: warfarin missed (-6),
    // lisinopril late (-5), simvastatin missed (-4), metformin 18:00 late (-3), simvastatin late (-2), metformin
    // 18:00 skipped (-1); day -7 (all taken) falls outside. rate = (33 + 3) / 39 = 0.923.
    expect(summary).toMatchObject({
      days: 7,
      from: '2026-09-10',
      to: TODAY,
      due: 39,
      taken: 33,
      late: 3,
      missed: 2,
      skipped: 1,
      rate: 0.923,
    });

    expect(summary.perDay.map((d) => d.localDate)).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ]);
    expect(summary.perDay.map((d) => [d.due, d.taken, d.late, d.missed, d.skipped, d.rate])).toEqual([
      [6, 5, 0, 1, 0, 0.833], // warfarin missed
      [6, 5, 1, 0, 0, 1], // lisinopril late still counts
      [6, 5, 0, 1, 0, 0.833], // simvastatin missed
      [6, 5, 1, 0, 0, 1], // metformin late
      [6, 5, 1, 0, 0, 1], // simvastatin late
      [6, 5, 0, 0, 1, 0.833], // metformin skipped
      [3, 3, 0, 0, 0, 1], // today: only the 08:00 slots are due so far
    ]);

    expect(summary.perMedication.map((m) => m.name)).toEqual([
      'Amlodipine',
      'Lisinopril',
      'Metformin',
      'Simvastatin',
      'Warfarin',
    ]);
    const med = (id: string) => summary.perMedication.find((m) => m.medicationId === id);
    expect(med(SEED_IDS.amlodipine)).toMatchObject({ due: 7, taken: 7, late: 0, missed: 0, skipped: 0, rate: 1 });
    expect(med(SEED_IDS.lisinopril)).toMatchObject({ due: 7, taken: 6, late: 1, missed: 0, skipped: 0, rate: 1 });
    expect(med(SEED_IDS.metformin)).toMatchObject({ due: 13, taken: 11, late: 1, missed: 0, skipped: 1, rate: 0.923 });
    expect(med(SEED_IDS.simvastatin)).toMatchObject({ due: 6, taken: 4, late: 1, missed: 1, skipped: 0, rate: 0.833 });
    expect(med(SEED_IDS.warfarin)).toMatchObject({ due: 6, taken: 5, late: 0, missed: 1, skipped: 0, rate: 0.833 });
  });

  it('1-day window at 10:30: only the three 08:00 slots are due, all taken', () => {
    const state = buildSeedState({ now, tz });
    const summary = computeAdherence(state, SEED_IDS.elder, 1, now, tz);
    expect(summary).toMatchObject({
      days: 1,
      from: TODAY,
      to: TODAY,
      due: 3,
      taken: 3,
      late: 0,
      missed: 0,
      skipped: 0,
      rate: 1,
    });
    expect(summary.perDay).toHaveLength(1);
    expect(summary.perMedication.map((m) => [m.name, m.due])).toEqual([
      ['Amlodipine', 1],
      ['Lisinopril', 1],
      ['Metformin', 1],
    ]);
  });

  it('8-day window adds the fully adherent day -7: 45 due, 42 / 45 = 0.933', () => {
    const state = buildSeedState({ now, tz });
    const summary = computeAdherence(state, SEED_IDS.elder, 8, now, tz);
    expect(summary).toMatchObject({
      from: '2026-09-09',
      due: 45,
      taken: 39,
      late: 3,
      missed: 2,
      skipped: 1,
      rate: 0.933,
    });
  });

  it('30-day window is fully covered by history: 177 due, 174 / 177 = 0.983', () => {
    const state = buildSeedState({ now, tz });
    const summary = computeAdherence(state, SEED_IDS.elder, 30, now, tz);
    // Days -29 … -8 (22 days × 6 = 132 slots) are all taken, then the scripted week plus today's 3 (45 due).
    expect(summary).toMatchObject({
      days: 30,
      from: '2026-08-18',
      to: TODAY,
      due: 177,
      taken: 171,
      late: 3,
      missed: 2,
      skipped: 1,
      rate: 0.983,
    });
    expect(summary.perDay).toHaveLength(30);
    expect(summary.perDay.slice(0, 22).every((d) => d.due === 6 && d.rate === 1)).toBe(true);
  });

  it('counts an open past slot as missed and an unfulfilled slot before grace as not yet due', () => {
    const state = buildSeedState({ now, tz, scenario: 'mid-morning' });
    // Drop yesterday's simvastatin outcome: the slot is past grace, so it is now a missed dose.
    state.doses = state.doses.filter((d) => d.id !== seedDoseId(SEED_IDS.simvastatin, '2026-09-15', '21:00'));
    const summary = computeAdherence(state, SEED_IDS.elder, 7, now, tz);
    expect(summary).toMatchObject({ due: 39, taken: 32, missed: 3, rate: 0.897 });

    // At 09:00 today the 08:00 metformin slot (120-minute grace) is not due yet, even though it is already taken.
    const nineAm = zonedToUtc(TODAY, '09:00', tz);
    const early = computeAdherence(state, SEED_IDS.elder, 1, nineAm, tz);
    expect(early).toMatchObject({ due: 0, rate: null });
  });

  it('keeps the historical slots of a medication that has since been deactivated', () => {
    const state = buildSeedState({ now, tz });
    const simvastatin = state.medications.find((m) => m.id === SEED_IDS.simvastatin);
    if (!simvastatin) throw new Error('seed is missing simvastatin');
    simvastatin.active = false;
    const summary = computeAdherence(state, SEED_IDS.elder, 7, now, tz);
    expect(summary.due).toBe(39);
    expect(summary.perMedication.find((m) => m.medicationId === SEED_IDS.simvastatin)).toMatchObject({ due: 6 });
  });

  it('ignores extra, unscheduled doses', () => {
    const state = buildSeedState({ now, tz });
    state.doses.push({
      id: 'dose_extra',
      elderId: SEED_IDS.elder,
      medicationId: SEED_IDS.metformin,
      localDate: '2026-09-15',
      scheduledTime: null,
      status: 'taken',
      recordedAt: isoOf(zonedToUtc('2026-09-15', '13:00', tz)),
      source: 'elder',
    });
    const summary = computeAdherence(state, SEED_IDS.elder, 7, now, tz);
    expect(summary).toMatchObject({ due: 39, taken: 33, rate: 0.923 });
  });
});

describe('computeAdherence on a hand-built state', () => {
  const tz = 'America/Los_Angeles';

  function tinyState(now: Date): State {
    const state = emptyState();
    state.households.push({ id: 'h1', name: 'Test household', timezone: tz, emergencyNumber: '911' });
    state.elders.push({
      id: 'e1',
      householdId: 'h1',
      name: 'Test Elder',
      age: 80,
      conditions: [],
      allergies: [],
      prefs: {
        preferredName: 'Tess',
        wakeTime: '07:00',
        breakfastTime: '08:00',
        lunchTime: '12:00',
        dinnerTime: '18:00',
        bedTime: '21:00',
        checkInDeadline: '11:00',
      },
    });
    state.medications.push({
      id: 'm1',
      elderId: 'e1',
      name: 'Aspirin',
      genericName: 'aspirin',
      dose: '81 mg',
      scheduleTimes: ['08:00', '20:00'],
      critical: false,
      maxDailyDoses: 2,
      minIntervalMin: 600,
      graceMin: 60,
      active: true,
      addedAt: isoOf(addMinutes(now, -10 * 24 * 60)),
    });
    return state;
  }

  it('reports nothing due (rate null) before the first slot of the window has passed grace', () => {
    const now = zonedToUtc(TODAY, '07:30', tz);
    const summary = computeAdherence(tinyState(now), 'e1', 1, now, tz);
    expect(summary).toEqual({
      days: 1,
      from: TODAY,
      to: TODAY,
      due: 0,
      taken: 0,
      late: 0,
      missed: 0,
      skipped: 0,
      rate: null,
      perDay: [{ localDate: TODAY, due: 0, taken: 0, late: 0, missed: 0, skipped: 0, rate: null }],
      perMedication: [],
    });
  });

  it('treats slots without an event as missed once their grace has ended', () => {
    const now = zonedToUtc(TODAY, '09:30', tz);
    const summary = computeAdherence(tinyState(now), 'e1', 2, now, tz);
    // Yesterday's two slots and today's 08:00 (grace ended 09:00) are due; none has an event.
    expect(summary).toMatchObject({ due: 3, missed: 3, taken: 0, rate: 0 });
    expect(summary.perDay.map((d) => [d.localDate, d.due, d.rate])).toEqual([
      ['2026-09-15', 2, 0],
      [TODAY, 1, 0],
    ]);
  });

  it('never counts slots from before the medication was added', () => {
    const now = zonedToUtc(TODAY, '21:00', tz);
    const state = tinyState(now);
    const aspirin = state.medications[0];
    if (!aspirin) throw new Error('missing medication');
    aspirin.addedAt = isoOf(zonedToUtc(TODAY, '12:00', tz));
    const summary = computeAdherence(state, 'e1', 30, now, tz);
    expect(summary).toMatchObject({ days: 30, due: 1, missed: 1 });
    expect(summary.perMedication).toEqual([
      { medicationId: 'm1', name: 'Aspirin', due: 1, taken: 0, late: 0, missed: 1, skipped: 0, rate: 0 },
    ]);
  });

  it('clamps the window to at least one day', () => {
    const now = zonedToUtc(TODAY, '12:00', tz);
    expect(computeAdherence(tinyState(now), 'e1', 0, now, tz)).toMatchObject({ days: 1, from: TODAY, to: TODAY });
  });
});
