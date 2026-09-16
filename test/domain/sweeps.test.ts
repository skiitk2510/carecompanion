import { describe, expect, it } from 'vitest';
import { createAlert } from '../../src/domain/alerts.js';
import type { Medication } from '../../src/domain/model.js';
import { buildSeedState, SEED_IDS, seedDoseId } from '../../src/domain/seed.js';
import { runSweeps } from '../../src/domain/sweeps.js';
import { isoOf, zonedToUtc } from '../../src/domain/time.js';

const TODAY = '2026-09-16';
const YESTERDAY = '2026-09-15';

describe.each(['America/Los_Angeles', 'Asia/Kolkata'])('runSweeps (%s)', (tz) => {
  const at = (localDate: string, time: string) => zonedToUtc(localDate, time, tz);
  const seed = (scenario: 'default' | 'mid-morning' | 'evening' = 'mid-morning') =>
    buildSeedState({ now: at(TODAY, '10:30'), tz, scenario });

  it("finds nothing to sweep in the 'mid-morning' seed at 10:30", () => {
    const state = seed();
    const before = { doses: state.doses.length, alerts: state.alerts.length };
    const result = runSweeps(state, at(TODAY, '10:30'), tz);
    expect(result).toEqual({ missedDoses: [], alerts: [] });
    expect(state.doses).toHaveLength(before.doses);
    expect(state.alerts).toHaveLength(before.alerts);
  });

  it('raises exactly one no_checkin alert after the 11:00 deadline, and never a second one', () => {
    const state = seed();
    const first = runSweeps(state, at(TODAY, '11:30'), tz);
    expect(first.missedDoses).toEqual([]);
    expect(first.alerts).toHaveLength(1);
    expect(first.alerts[0]).toMatchObject({
      elderId: SEED_IDS.elder,
      type: 'no_checkin',
      severity: 'warning',
      title: 'No check-in from Margaret yet',
      dedupeKey: `nocheckin:${SEED_IDS.elder}:${TODAY}`,
      notified: [SEED_IDS.priya],
      createdAt: isoOf(at(TODAY, '11:30')),
    });
    expect(state.alerts).toHaveLength(6);

    const second = runSweeps(state, at(TODAY, '11:45'), tz);
    expect(second).toEqual({ missedDoses: [], alerts: [] });
    expect(state.alerts).toHaveLength(6);
  });

  it('does not raise no_checkin once a check-in exists for today', () => {
    const state = seed();
    state.checkIns.push({
      id: 'checkin_today',
      elderId: SEED_IDS.elder,
      at: isoOf(at(TODAY, '10:45')),
      localDate: TODAY,
      mood: 'good',
      symptoms: [],
      severity: 'none',
      flagged: false,
    });
    expect(runSweeps(state, at(TODAY, '11:30'), tz)).toEqual({ missedDoses: [], alerts: [] });
  });

  it('marks an open critical 18:00 warfarin slot as missed at 20:30 and alerts both caregivers', () => {
    const state = seed('evening');
    state.doses = state.doses.filter((d) => d.id !== seedDoseId(SEED_IDS.warfarin, TODAY, '18:00'));
    const result = runSweeps(state, at(TODAY, '20:30'), tz);

    expect(result.missedDoses).toHaveLength(1);
    const missed = result.missedDoses[0];
    expect(missed).toMatchObject({
      elderId: SEED_IDS.elder,
      medicationId: SEED_IDS.warfarin,
      localDate: TODAY,
      scheduledTime: '18:00',
      status: 'missed',
      recordedAt: null,
      source: 'system',
    });
    expect(missed?.id).toMatch(/^dose_/);
    expect(state.doses).toContain(missed);

    // The missed-dose alert plus (no check-in today, deadline long past) the no_checkin alert.
    expect(result.alerts.map((a) => a.type)).toEqual(['missed_dose', 'no_checkin']);
    expect(result.alerts[0]).toMatchObject({
      severity: 'critical',
      title: 'Missed Warfarin (6 p.m.)',
      refId: missed?.id,
      dedupeKey: `missed:${SEED_IDS.warfarin}:${TODAY}:18:00`,
      notified: [SEED_IDS.priya, SEED_IDS.daniel],
      createdAt: isoOf(at(TODAY, '20:30')),
    });
    expect(result.alerts[0]?.detail).toContain('6 p.m. today');
    expect(result.alerts[0]?.detail).toContain('8 p.m.');

    // Idempotent: the slot now has an event, the alerts already exist.
    expect(runSweeps(state, at(TODAY, '20:45'), tz)).toEqual({ missedDoses: [], alerts: [] });
  });

  it('marks an open non-critical slot as missed with a warning to the priority-1 caregiver only', () => {
    const state = seed('evening');
    state.doses = state.doses.filter((d) => d.id !== seedDoseId(SEED_IDS.metformin, TODAY, '18:00'));
    const result = runSweeps(state, at(TODAY, '20:30'), tz);
    expect(result.missedDoses.map((d) => [d.medicationId, d.scheduledTime])).toEqual([[SEED_IDS.metformin, '18:00']]);
    expect(result.alerts.map((a) => a.type)).toEqual(['missed_dose', 'no_checkin']);
    expect(result.alerts[0]).toMatchObject({
      severity: 'warning',
      title: 'Missed Metformin (6 p.m.)',
      notified: [SEED_IDS.priya],
    });
  });

  it('leaves slots still inside their grace window alone', () => {
    const state = seed('evening');
    state.doses = state.doses.filter((d) => d.id !== seedDoseId(SEED_IDS.warfarin, TODAY, '18:00'));
    // 19:30 is inside warfarin's 120-minute grace; simvastatin (21:00) has not even come up.
    const result = runSweeps(state, at(TODAY, '19:30'), tz);
    expect(result.missedDoses).toEqual([]);
    expect(result.alerts.map((a) => a.type)).toEqual(['no_checkin']);
  });

  it("also sweeps yesterday's open slots", () => {
    const state = seed();
    state.doses = state.doses.filter((d) => d.id !== seedDoseId(SEED_IDS.simvastatin, YESTERDAY, '21:00'));
    const result = runSweeps(state, at(TODAY, '10:30'), tz);
    expect(result.missedDoses).toHaveLength(1);
    expect(result.missedDoses[0]).toMatchObject({
      medicationId: SEED_IDS.simvastatin,
      localDate: YESTERDAY,
      scheduledTime: '21:00',
      status: 'missed',
    });
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({
      type: 'missed_dose',
      severity: 'warning',
      dedupeKey: `missed:${SEED_IDS.simvastatin}:${YESTERDAY}:21:00`,
      notified: [SEED_IDS.priya],
    });
    expect(result.alerts[0]?.detail).toContain('9 p.m. yesterday');
  });

  it('never touches a slot that already has an outcome, whatever its status', () => {
    const state = seed();
    const skippedId = seedDoseId(SEED_IDS.metformin, YESTERDAY, '18:00');
    const before = state.doses.find((d) => d.id === skippedId);
    expect(before?.status).toBe('skipped');

    const result = runSweeps(state, at(TODAY, '10:30'), tz);
    expect(result.missedDoses).toEqual([]);
    expect(state.doses.filter((d) => d.medicationId === SEED_IDS.metformin && d.localDate === YESTERDAY)).toHaveLength(
      2
    );
    expect(state.doses.find((d) => d.id === skippedId)).toBe(before);
    expect(state.alerts.some((a) => a.dedupeKey === `missed:${SEED_IDS.metformin}:${YESTERDAY}:18:00`)).toBe(false);
  });

  it('does not sweep slots from before a medication was added', () => {
    const state = seed();
    const vitaminD: Medication = {
      id: 'med_vitamin_d',
      elderId: SEED_IDS.elder,
      name: 'Vitamin D',
      genericName: 'cholecalciferol',
      dose: '1000 IU',
      scheduleTimes: ['08:00'],
      critical: false,
      maxDailyDoses: 1,
      minIntervalMin: 720,
      graceMin: 30,
      active: true,
      addedAt: isoOf(at(TODAY, '10:00')),
    };
    state.medications.push(vitaminD);
    expect(runSweeps(state, at(TODAY, '10:30'), tz).missedDoses).toEqual([]);

    // Control: the same medication added at midnight does get today's 08:00 slot swept (and only today's).
    vitaminD.addedAt = isoOf(at(TODAY, '00:00'));
    const result = runSweeps(state, at(TODAY, '10:30'), tz);
    expect(result.missedDoses.map((d) => [d.medicationId, d.localDate, d.scheduledTime])).toEqual([
      ['med_vitamin_d', TODAY, '08:00'],
    ]);
  });

  it('skips inactive medications', () => {
    const state = seed('evening');
    state.doses = state.doses.filter((d) => d.id !== seedDoseId(SEED_IDS.warfarin, TODAY, '18:00'));
    const warfarin = state.medications.find((m) => m.id === SEED_IDS.warfarin);
    if (!warfarin) throw new Error('seed is missing warfarin');
    warfarin.active = false;
    expect(runSweeps(state, at(TODAY, '20:30'), tz).missedDoses).toEqual([]);
  });

  it('returns only newly created alerts: a pre-existing dedupe key suppresses the alert but not the event', () => {
    const state = seed('evening');
    state.doses = state.doses.filter((d) => d.id !== seedDoseId(SEED_IDS.warfarin, TODAY, '18:00'));
    const existing = createAlert(
      state,
      {
        elderId: SEED_IDS.elder,
        type: 'missed_dose',
        severity: 'critical',
        title: 'Missed Warfarin (6 p.m.)',
        detail: 'raised earlier',
        dedupeKey: `missed:${SEED_IDS.warfarin}:${TODAY}:18:00`,
      },
      at(TODAY, '20:01')
    ).alert;
    const result = runSweeps(state, at(TODAY, '20:30'), tz);
    expect(result.missedDoses).toHaveLength(1);
    expect(result.alerts.map((a) => a.type)).toEqual(['no_checkin']);
    expect(state.alerts.filter((a) => a.dedupeKey === existing.dedupeKey)).toEqual([existing]);
  });
});
