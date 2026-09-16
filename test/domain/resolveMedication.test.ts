import { describe, expect, it } from 'vitest';
import type { Medication } from '../../src/domain/model.js';
import { levenshtein, normalizeMedicationQuery, resolveMedication } from '../../src/domain/resolveMedication.js';
import { buildSeedState, SEED_IDS } from '../../src/domain/seed.js';
import { fixedClock } from '../../src/domain/time.js';

const now = fixedClock('2026-09-16T17:30:00.000Z').now();
const tz = 'America/Los_Angeles';

const inactive: Medication = {
  id: 'med_atorvastatin',
  elderId: SEED_IDS.elder,
  name: 'Atorvastatin',
  genericName: 'atorvastatin',
  dose: '10 mg',
  scheduleTimes: ['21:00'],
  purpose: 'cholesterol',
  critical: false,
  maxDailyDoses: 1,
  minIntervalMin: 720,
  graceMin: 120,
  active: false,
  addedAt: '2026-01-01T00:00:00.000Z',
};

const medications: Medication[] = [...buildSeedState({ now, tz }).medications, inactive];
const ACTIVE_LIST = 'Lisinopril, Amlodipine, Metformin, Warfarin, Simvastatin';

function expectMatch(query: string, medicationId: string, via: string): void {
  const result = resolveMedication(query, medications);
  expect(result.kind).toBe('match');
  if (result.kind !== 'match') return;
  expect(result.medication.id).toBe(medicationId);
  expect(result.via).toBe(via);
}

describe('resolveMedication', () => {
  it('matches an exact name, case-insensitively', () => {
    expectMatch('Lisinopril', SEED_IDS.lisinopril, 'name');
    expectMatch('lisinopril', SEED_IDS.lisinopril, 'name');
    expectMatch('  WARFARIN ', SEED_IDS.warfarin, 'name');
  });

  it('matches a generic name when the display name differs', () => {
    const branded: Medication = { ...medications[0]!, id: 'med_brand', name: 'Prinivil', genericName: 'lisinopril' };
    const result = resolveMedication('lisinopril', [branded]);
    expect(result).toMatchObject({ kind: 'match', via: 'generic', medication: { id: 'med_brand' } });
  });

  it('ignores punctuation and filler words the elder is likely to say', () => {
    expectMatch('I took my Warfarin.', SEED_IDS.warfarin, 'name');
    expectMatch('the metformin tablet, the evening one', SEED_IDS.metformin, 'name');
    expect(normalizeMedicationQuery('I took my blood-pressure pill this morning!')).toEqual([
      'blood',
      'pressure',
      'this',
    ]);
  });

  it('asks when a purpose fits several medications', () => {
    const result = resolveMedication('my blood pressure pill', medications);
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    expect(result.candidates.map((m) => m.id)).toEqual([SEED_IDS.lisinopril, SEED_IDS.amlodipine]);
    expect(result.spoken).toBe('Do you mean Lisinopril or Amlodipine?');
  });

  it('resolves a purpose keyword that fits exactly one medication', () => {
    expectMatch('the sugar pill', SEED_IDS.metformin, 'purpose');
    expectMatch('my diabetes medication', SEED_IDS.metformin, 'purpose');
    expectMatch('blood thinner', SEED_IDS.warfarin, 'purpose');
    expectMatch('my cholesterol pill', SEED_IDS.simvastatin, 'purpose');
    expectMatch('the statin', SEED_IDS.simvastatin, 'purpose');
  });

  it("treats 'heart' as any blood-pressure or blood-thinner medication", () => {
    const result = resolveMedication('my heart pill', medications);
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    expect(result.candidates.map((m) => m.name)).toEqual(['Lisinopril', 'Amlodipine', 'Warfarin']);
    expect(result.spoken).toBe('Do you mean Lisinopril or Amlodipine or Warfarin?');
  });

  it('understands the common brand names', () => {
    expectMatch('coumadin', SEED_IDS.warfarin, 'alias');
    expectMatch('my Coumadin pill', SEED_IDS.warfarin, 'alias');
    expectMatch('zestril', SEED_IDS.lisinopril, 'alias');
    expectMatch('glucophage', SEED_IDS.metformin, 'alias');
    expectMatch('norvasc', SEED_IDS.amlodipine, 'alias');
    expectMatch('zocor', SEED_IDS.simvastatin, 'alias');
  });

  it('recovers misheard names with fuzzy matching', () => {
    expectMatch('lisinapril', SEED_IDS.lisinopril, 'fuzzy');
    expectMatch('metformen', SEED_IDS.metformin, 'fuzzy');
    expectMatch('warfrin', SEED_IDS.warfarin, 'fuzzy');
    expectMatch('simvastatine', SEED_IDS.simvastatin, 'fuzzy');
    expectMatch('lisinopril 10 mg', SEED_IDS.lisinopril, 'fuzzy');
  });

  it('accepts a prefix of at least four letters, but not shorter fragments', () => {
    expectMatch('amlo', SEED_IDS.amlodipine, 'fuzzy');
    expect(resolveMedication('aml', medications).kind).toBe('none');
    expect(resolveMedication('war', medications).kind).toBe('none');
  });

  it('lists the active medications when nothing matches', () => {
    const result = resolveMedication('vitamin d', medications);
    expect(result).toEqual({
      kind: 'none',
      spoken: `I couldn't find a medication called vitamin d. Your active medications are ${ACTIVE_LIST}.`,
    });
    expect(resolveMedication('', medications)).toMatchObject({ kind: 'none' });
    expect(resolveMedication('my pill', medications)).toMatchObject({
      kind: 'none',
      spoken: `I couldn't find a medication called my pill. Your active medications are ${ACTIVE_LIST}.`,
    });
  });

  it('never matches an inactive medication, by name, alias or purpose', () => {
    expect(resolveMedication('Atorvastatin', medications)).toMatchObject({ kind: 'none' });
    expect(resolveMedication('lipitor', medications)).toMatchObject({ kind: 'none' });
    expect(resolveMedication('atorvastatn', medications)).toMatchObject({ kind: 'none' });
    // Purpose lookups only see active medications, so "cholesterol" is unambiguous.
    expectMatch('cholesterol', SEED_IDS.simvastatin, 'purpose');
  });

  it('explains when there are no active medications at all', () => {
    expect(resolveMedication('lisinopril', [inactive])).toEqual({
      kind: 'none',
      spoken: "I couldn't find a medication called lisinopril. There are no active medications on file.",
    });
  });

  it('computes edit distance', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('warfarin', 'warfarin')).toBe(0);
    expect(levenshtein('warfrin', 'warfarin')).toBe(1);
    expect(levenshtein('lisinapril', 'lisinopril')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });
});
