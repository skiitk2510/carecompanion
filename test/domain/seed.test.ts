import { describe, expect, it } from 'vitest';
import { isOpenAlert, type DoseEvent, type DoseStatus } from '../../src/domain/model.js';
import { buildSeedState, SEED_IDS, seedCheckInId, seedDoseId, type SeedScenario } from '../../src/domain/seed.js';
import { addDays, fixedClock, minutesBetween, toClockTime, toLocalDate, zonedToUtc } from '../../src/domain/time.js';

const TODAY = '2026-09-16';
const day = (offset: number) => addDays(TODAY, offset);

/** The same local moment (10:30 today) in two households half a world apart. */
const HOUSEHOLDS = [
  { tz: 'America/Los_Angeles', iso: '2026-09-16T17:30:00.000Z' },
  { tz: 'Asia/Kolkata', iso: '2026-09-16T05:00:00.000Z' },
];

function countByStatus(doses: readonly DoseEvent[]): Record<DoseStatus, number> {
  const counts: Record<DoseStatus, number> = { taken: 0, late: 0, missed: 0, skipped: 0 };
  for (const dose of doses) counts[dose.status] += 1;
  return counts;
}

describe.each(HOUSEHOLDS)('buildSeedState in $tz at 10:30 local', ({ tz, iso }) => {
  const now = fixedClock(iso).now();
  const build = (scenario?: SeedScenario) => buildSeedState({ now, tz, scenario });
  const localIso = (localDate: string, time: string) => zonedToUtc(localDate, time, tz).toISOString();

  it('is anchored on 10:30 today in the household timezone', () => {
    expect(toLocalDate(now, tz)).toBe(TODAY);
    expect(toClockTime(now, tz)).toBe('10:30');
  });

  it('creates the Hart household with the expected entities', () => {
    const state = build();
    expect(state.households).toHaveLength(1);
    expect(state.households[0]).toMatchObject({
      id: SEED_IDS.household,
      name: 'The Hart family',
      timezone: tz,
      emergencyNumber: '911',
    });
    expect(state.elders).toHaveLength(1);
    expect(state.elders[0]).toMatchObject({
      id: SEED_IDS.elder,
      householdId: SEED_IDS.household,
      name: 'Margaret Hart',
      age: 78,
      conditions: ['hypertension', 'type 2 diabetes', 'atrial fibrillation'],
      allergies: ['penicillin'],
      prefs: { preferredName: 'Margaret', checkInDeadline: '11:00', wakeTime: '07:00', bedTime: '21:30' },
    });
    expect(state.caregivers.map((c) => [c.id, c.relationship, c.channel, c.escalationPriority])).toEqual([
      [SEED_IDS.priya, 'daughter', 'sms', 1],
      [SEED_IDS.daniel, 'son', 'email', 2],
    ]);
    expect(state.medications).toHaveLength(5);
    expect(state.appointments).toHaveLength(3);
    expect(state.checkIns).toHaveLength(7);
    expect(state.alerts).toHaveLength(5);
    expect(state.seededAt).toBe(iso);
    expect(state.scenario).toBe('default');
  });

  it('seeds five active medications added 60 days ago', () => {
    const state = build();
    const addedAt = new Date(now.getTime() - 60 * 24 * 60 * 60_000).toISOString();
    expect(state.medications.map((m) => [m.id, m.scheduleTimes, m.critical, m.graceMin])).toEqual([
      [SEED_IDS.lisinopril, ['08:00'], true, 90],
      [SEED_IDS.amlodipine, ['08:00'], false, 90],
      [SEED_IDS.metformin, ['08:00', '18:00'], false, 120],
      [SEED_IDS.warfarin, ['18:00'], true, 120],
      [SEED_IDS.simvastatin, ['21:00'], false, 120],
    ]);
    for (const medication of state.medications) {
      expect(medication).toMatchObject({ elderId: SEED_IDS.elder, active: true, addedAt });
    }
    expect(state.medications.find((m) => m.id === SEED_IDS.metformin)).toMatchObject({
      name: 'Metformin',
      genericName: 'metformin',
      dose: '500 mg',
      purpose: 'blood sugar',
      instructions: 'take with food',
      maxDailyDoses: 2,
      minIntervalMin: 240,
    });
  });

  it('places the appointments on upcoming local days', () => {
    const state = build();
    expect(state.appointments.map((a) => [a.title, a.at])).toEqual([
      ['Cardiology follow-up with Dr. Chen', localIso(day(3), '10:30')],
      ['Physical therapy', localIso(day(1), '14:00')],
      ['INR blood draw', localIso(day(9), '09:00')],
    ]);
    expect(state.appointments[0]?.location).toBe('Valley Heart Clinic');
  });

  it('records thirty days of deterministic dose history, with the scripted exceptions in the last week', () => {
    const state = build();
    const history = state.doses.filter((d) => d.localDate < TODAY);
    const lastWeek = history.filter((d) => d.localDate >= day(-7));
    const older = history.filter((d) => d.localDate < day(-7));
    const find = (id: string) => state.doses.find((d) => d.id === id);

    // 30 days × 6 slots. Last week: 36 taken + 3 late + 2 missed + 1 skipped → (36 + 3) / 42 ≈ 92.9% adherence;
    // the 23 earlier days are all taken, so the 30-day dashboard window reads sensibly.
    expect(history).toHaveLength(180);
    expect(new Set(history.map((d) => d.localDate)).size).toBe(30);
    expect(history[0]?.localDate).toBe(day(-30));
    expect(lastWeek).toHaveLength(42);
    expect(countByStatus(lastWeek)).toEqual({ taken: 36, late: 3, missed: 2, skipped: 1 });
    expect(new Set(lastWeek.map((d) => d.localDate))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7].map((n) => day(-n))));
    expect(older).toHaveLength(138);
    expect(older.every((d) => d.status === 'taken')).toBe(true);
    expect(history.every((d) => d.elderId === SEED_IDS.elder)).toBe(true);

    expect(find(seedDoseId(SEED_IDS.warfarin, day(-6), '18:00'))).toMatchObject({
      id: `dose_warfarin_${day(-6)}_1800`,
      status: 'missed',
      recordedAt: null,
      source: 'system',
      scheduledTime: '18:00',
    });
    expect(find(seedDoseId(SEED_IDS.simvastatin, day(-4), '21:00'))).toMatchObject({
      status: 'missed',
      recordedAt: null,
    });
    expect(find(seedDoseId(SEED_IDS.lisinopril, day(-5), '08:00'))).toMatchObject({
      status: 'late',
      recordedAt: localIso(day(-5), '09:35'),
    });
    expect(find(seedDoseId(SEED_IDS.metformin, day(-3), '18:00'))).toMatchObject({
      status: 'late',
      recordedAt: localIso(day(-3), '19:10'),
    });
    expect(find(seedDoseId(SEED_IDS.simvastatin, day(-2), '21:00'))).toMatchObject({
      status: 'late',
      recordedAt: localIso(day(-2), '22:00'),
    });
    expect(find(seedDoseId(SEED_IDS.metformin, day(-1), '18:00'))).toMatchObject({
      status: 'skipped',
      source: 'elder',
      reason: 'upset stomach',
    });

    // Every ordinary dose is recorded 2–12 minutes after its slot, and the whole thing is reproducible.
    for (const dose of history.filter((d) => d.status === 'taken')) {
      expect(dose.source).toBe('seed');
      const slotAt = zonedToUtc(dose.localDate, dose.scheduledTime ?? '', tz);
      const delay = minutesBetween(slotAt, dose.recordedAt ?? '');
      expect(delay).toBeGreaterThanOrEqual(2);
      expect(delay).toBeLessThanOrEqual(12);
    }
    expect(build()).toEqual(build());
  });

  it('seeds a check-in for each past day, with yesterday flagged as dizzy', () => {
    const state = build();
    expect(state.checkIns.map((c) => c.localDate)).toEqual([7, 6, 5, 4, 3, 2, 1].map((n) => day(-n)));
    expect(state.checkIns.map((c) => c.mood)).toEqual(['good', 'good', 'okay', 'good', 'great', 'okay', 'okay']);
    expect(state.checkIns.map((c) => c.at)).toEqual(state.checkIns.map((c) => localIso(c.localDate, '09:15')));
    for (const checkIn of state.checkIns.slice(0, 6)) {
      expect(checkIn).toMatchObject({ symptoms: [], severity: 'none', flagged: false });
    }
    expect(state.checkIns[6]).toMatchObject({
      id: seedCheckInId(day(-1)),
      mood: 'okay',
      symptoms: ['a bit dizzy'],
      severity: 'urgent',
      flagged: true,
    });
    expect(state.checkIns.some((c) => c.localDate === TODAY)).toBe(false);
  });

  it('seeds an audit trail of resolved alerts plus one open, acknowledged dizziness alert', () => {
    const state = build();
    const alert = (id: string) => state.alerts.find((a) => a.id === id);

    const warfarin = alert('alert_seed_1');
    expect(warfarin).toMatchObject({
      type: 'missed_dose',
      severity: 'critical',
      title: 'Missed Warfarin (6 p.m.)',
      refId: seedDoseId(SEED_IDS.warfarin, day(-6), '18:00'),
      dedupeKey: `missed:${SEED_IDS.warfarin}:${day(-6)}:18:00`,
      notified: [SEED_IDS.priya, SEED_IDS.daniel],
      acknowledgedBy: SEED_IDS.priya,
      resolvedBy: SEED_IDS.priya,
      resolution: 'Called Mom — she took it at 8:30 pm.',
    });
    expect(minutesBetween(warfarin?.createdAt ?? '', warfarin?.resolvedAt ?? '')).toBe(40);

    expect(alert('alert_seed_2')).toMatchObject({
      type: 'missed_dose',
      severity: 'warning',
      refId: seedDoseId(SEED_IDS.simvastatin, day(-4), '21:00'),
      notified: [SEED_IDS.priya],
      resolvedBy: SEED_IDS.daniel,
      resolvedAt: localIso(day(-3), '08:30'),
      resolution: 'Noted, will set a bedtime reminder.',
    });

    expect(alert('alert_seed_3')).toMatchObject({
      type: 'interaction',
      severity: 'info',
      title: 'Simvastatin + Amlodipine (moderate)',
      refId: SEED_IDS.simvastatin,
      createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString(),
      resolvedBy: SEED_IDS.priya,
      resolution: 'Discussed with Dr. Chen — the 20 mg dose is fine.',
    });

    const dizziness = alert('alert_seed_4');
    expect(dizziness).toMatchObject({
      type: 'symptom',
      severity: 'critical',
      refId: seedCheckInId(day(-1)),
      createdAt: localIso(day(-1), '09:15'),
      notified: [SEED_IDS.priya],
      acknowledgedBy: SEED_IDS.priya,
      acknowledgedAt: localIso(day(-1), '09:35'),
    });
    expect(dizziness?.resolvedAt).toBeUndefined();
    expect(dizziness?.resolvedBy).toBeUndefined();

    expect(alert('alert_seed_5')).toMatchObject({
      type: 'skipped_dose',
      severity: 'info',
      refId: seedDoseId(SEED_IDS.metformin, day(-1), '18:00'),
      notified: [SEED_IDS.priya],
      resolvedBy: SEED_IDS.priya,
    });

    // Exactly one alert is left open for the demo.
    expect(state.alerts.filter(isOpenAlert).map((a) => a.id)).toEqual(['alert_seed_4']);
    expect(state.alerts.every((a) => a.elderId === SEED_IDS.elder)).toBe(true);
  });

  it.each<{ scenario: SeedScenario; slots: Array<[string, string]> }>([
    {
      scenario: 'default',
      // At 10:30 the 08:00 grace windows (90 / 90 / 120 min) are over; 18:00 and 21:00 are still ahead.
      slots: [
        [SEED_IDS.lisinopril, '08:00'],
        [SEED_IDS.amlodipine, '08:00'],
        [SEED_IDS.metformin, '08:00'],
      ],
    },
    {
      scenario: 'mid-morning',
      slots: [
        [SEED_IDS.lisinopril, '08:00'],
        [SEED_IDS.amlodipine, '08:00'],
        [SEED_IDS.metformin, '08:00'],
      ],
    },
    {
      scenario: 'evening',
      slots: [
        [SEED_IDS.lisinopril, '08:00'],
        [SEED_IDS.amlodipine, '08:00'],
        [SEED_IDS.metformin, '08:00'],
        [SEED_IDS.metformin, '18:00'],
        [SEED_IDS.warfarin, '18:00'],
      ],
    },
  ])("pre-fills today's slots for the '$scenario' scenario", ({ scenario, slots }) => {
    const state = build(scenario);
    const today = state.doses.filter((d) => d.localDate === TODAY);
    expect(state.scenario).toBe(scenario);
    expect(today.map((d) => [d.medicationId, d.scheduledTime])).toEqual(slots);
    for (const dose of today) {
      expect(dose).toMatchObject({
        id: seedDoseId(dose.medicationId, TODAY, dose.scheduledTime ?? ''),
        status: 'taken',
        source: 'seed',
        recordedAt: localIso(TODAY, dose.scheduledTime === '08:00' ? '08:05' : '18:10'),
      });
    }
    expect(state.checkIns.some((c) => c.localDate === TODAY)).toBe(false);
  });

  it("'mid-morning' pre-fills the 08:00 slots whatever the hour, while 'default' only fills slots past grace", () => {
    const early = zonedToUtc(TODAY, '07:00', tz);
    const midMorning = buildSeedState({ now: early, tz, scenario: 'mid-morning' });
    expect(midMorning.doses.filter((d) => d.localDate === TODAY).map((d) => d.scheduledTime)).toEqual([
      '08:00',
      '08:00',
      '08:00',
    ]);
    const byDefault = buildSeedState({ now: early, tz, scenario: 'default' });
    expect(byDefault.doses.filter((d) => d.localDate === TODAY)).toEqual([]);

    // At 09:45 only the 90-minute grace windows are over; metformin's 120-minute window is still open.
    const later = buildSeedState({ now: zonedToUtc(TODAY, '09:45', tz), tz });
    expect(later.doses.filter((d) => d.localDate === TODAY).map((d) => d.medicationId)).toEqual([
      SEED_IDS.lisinopril,
      SEED_IDS.amlodipine,
    ]);
  });
});
