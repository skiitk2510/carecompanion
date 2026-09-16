import { describe, expect, it } from 'vitest';
import {
  checkInteractions,
  DRUG_ALIASES,
  INTERACTION_DISCLAIMER,
  INTERACTION_TABLE,
  normalizeDrugName,
} from '../../../src/domain/guardrails/interactions.js';
import type { Medication } from '../../../src/domain/model.js';

function existing(name: string, overrides: Partial<Medication> = {}): Medication {
  return {
    id: `med_${name.toLowerCase()}`,
    elderId: 'elder_rosa',
    name,
    genericName: name.toLowerCase(),
    dose: '10mg',
    scheduleTimes: ['08:00'],
    critical: false,
    maxDailyDoses: 1,
    minIntervalMin: 720,
    graceMin: 90,
    active: true,
    addedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const rosaMeds = [
  existing('Lisinopril'),
  existing('Amlodipine'),
  existing('Metformin'),
  existing('Warfarin'),
  existing('Simvastatin'),
];

describe('normalizeDrugName', () => {
  it('strips strengths, salts and dosage forms and maps brands to generics', () => {
    expect(normalizeDrugName('Warfarin Sodium 5mg')).toBe('warfarin');
    expect(normalizeDrugName('Advil 200 mg')).toBe('ibuprofen');
    expect(normalizeDrugName('  Coumadin ')).toBe('warfarin');
    expect(normalizeDrugName('Toprol XL 50 mg')).toBe('metoprolol');
    expect(normalizeDrugName('Metformin ER 500mg tablets')).toBe('metformin');
    expect(normalizeDrugName('Lisinopril (Zestril) 10 mg')).toBe('lisinopril');
    expect(normalizeDrugName('Potassium Chloride 20 mEq')).toBe('potassium');
    expect(normalizeDrugName('Atorvastatin Calcium 20 mg')).toBe('atorvastatin');
    expect(normalizeDrugName('Extra Strength Tylenol')).toBe('acetaminophen');
    expect(normalizeDrugName('baby aspirin 81 mg')).toBe('aspirin');
    expect(normalizeDrugName('Vitamin D3 1000 IU')).toBe('vitamin d3');
    expect(normalizeDrugName('amoxicillin/clavulanate 875/125 mg')).toBe('amoxicillin-clavulanate');
    expect(normalizeDrugName('Augmentin')).toBe('amoxicillin-clavulanate');
    expect(normalizeDrugName('lisinopril-hydrochlorothiazide 20/12.5 mg')).toBe('lisinopril-hydrochlorothiazide');
    expect(normalizeDrugName('')).toBe('');
  });

  it('keeps the alias table itself normalized', () => {
    for (const [alias, generic] of Object.entries(DRUG_ALIASES)) {
      expect(normalizeDrugName(generic)).toBe(generic);
      expect(normalizeDrugName(alias)).toBe(generic);
    }
    for (const rule of INTERACTION_TABLE) {
      expect(normalizeDrugName(rule.a)).toBe(rule.a);
      expect(normalizeDrugName(rule.b)).toBe(rule.b);
    }
  });
});

describe('checkInteractions — drug pairs', () => {
  it('flags ibuprofen against warfarin (major) and lisinopril (moderate), major first', () => {
    const warnings = checkInteractions({ name: 'ibuprofen' }, rosaMeds, []);
    expect(warnings.map((w) => [w.kind, w.withName, w.severity])).toEqual([
      ['interaction', 'Warfarin', 'major'],
      ['interaction', 'Lisinopril', 'moderate'],
    ]);
    for (const warning of warnings) {
      expect(warning.disclaimer).toBe(INTERACTION_DISCLAIMER);
      expect(warning.summary.length).toBeGreaterThan(0);
      expect(warning.advice.length).toBeGreaterThan(0);
    }
    expect(warnings[0]?.summary).toContain('bleeding');
  });

  it('treats a brand name with a strength like its generic', () => {
    const viaAlias = checkInteractions({ name: 'Advil 200 mg' }, rosaMeds, []);
    const viaGeneric = checkInteractions({ name: 'ibuprofen' }, rosaMeds, []);
    expect(viaAlias).toEqual(viaGeneric);
  });

  it('matches symmetrically, through aliases on either side', () => {
    const coumadin = checkInteractions({ name: 'Coumadin' }, [existing('Aspirin')], []);
    expect(coumadin.map((w) => [w.withName, w.severity])).toEqual([['Aspirin', 'major']]);

    const warfarin = checkInteractions({ name: 'warfarin' }, [existing('Ibuprofen')], []);
    expect(warfarin.map((w) => [w.withName, w.severity])).toEqual([['Ibuprofen', 'major']]);

    const brandOnFile = checkInteractions(
      { name: 'Ibuprofen' },
      [existing('Jantoven', { genericName: 'warfarin' })],
      []
    );
    expect(brandOnFile.map((w) => [w.withName, w.severity])).toEqual([['Jantoven', 'major']]);
  });

  it('uses the candidate genericName when given', () => {
    const warnings = checkInteractions({ name: 'Water pill', genericName: 'Lisinopril' }, [existing('Ibuprofen')], []);
    expect(warnings.map((w) => [w.withName, w.severity])).toEqual([['Ibuprofen', 'moderate']]);
  });

  it('matches a component of a combination product', () => {
    const warnings = checkInteractions(
      { name: 'Lisinopril-hydrochlorothiazide 20/12.5 mg' },
      [existing('Naproxen')],
      []
    );
    expect(warnings.map((w) => [w.withName, w.severity])).toEqual([['Naproxen', 'moderate']]);
  });

  it('flags potassium supplements with lisinopril', () => {
    const warnings = checkInteractions({ name: 'Potassium Chloride 20 mEq' }, rosaMeds, []);
    expect(warnings.map((w) => [w.withName, w.severity])).toEqual([['Lisinopril', 'moderate']]);
  });

  it('returns nothing when no rule applies', () => {
    expect(checkInteractions({ name: 'ibuprofen' }, [existing('Metformin')], [])).toEqual([]);
    expect(checkInteractions({ name: 'ibuprofen' }, [], [])).toEqual([]);
    expect(checkInteractions({ name: 'Vitamin D3 1000 IU' }, rosaMeds, [])).toEqual([]);
  });

  it('ignores inactive medications', () => {
    const stopped = [existing('Warfarin', { active: false }), existing('Lisinopril', { active: false })];
    expect(checkInteractions({ name: 'ibuprofen' }, stopped, [])).toEqual([]);
  });

  it('reports one warning per existing medication that matches', () => {
    const twoNsaids = [existing('Advil', { genericName: 'ibuprofen' }), existing('Aleve', { genericName: 'naproxen' })];
    const warnings = checkInteractions({ name: 'Coumadin' }, twoNsaids, []);
    expect(warnings.map((w) => w.withName)).toEqual(['Advil', 'Aleve']);
    expect(warnings.every((w) => w.severity === 'major')).toBe(true);
  });
});

describe('checkInteractions — allergies', () => {
  it('flags a penicillin-class antibiotic for a listed penicillin allergy', () => {
    const warnings = checkInteractions({ name: 'Amoxicillin 500 mg' }, [], ['Penicillin']);
    expect(warnings).toEqual([
      {
        kind: 'allergy',
        withName: 'Penicillin',
        severity: 'major',
        summary: 'Listed Penicillin allergy — amoxicillin is a penicillin-class antibiotic.',
        advice: expect.any(String),
        disclaimer: INTERACTION_DISCLAIMER,
      },
    ]);
    expect(checkInteractions({ name: 'Augmentin' }, [], ['penicillin'])).toHaveLength(1);
    expect(checkInteractions({ name: 'Amoxil' }, [], ['penicillins'])).toHaveLength(1);
  });

  it('flags a direct match with the listed allergy, through aliases', () => {
    const warnings = checkInteractions({ name: 'Advil' }, [], ['Ibuprofen']);
    expect(warnings.map((w) => [w.kind, w.withName, w.severity])).toEqual([['allergy', 'Ibuprofen', 'major']]);
    expect(warnings[0]?.summary).toBe('Listed Ibuprofen allergy — ibuprofen matches it directly.');
  });

  it('covers sulfa and NSAID classes', () => {
    expect(checkInteractions({ name: 'Bactrim DS' }, [], ['sulfa drugs']).map((w) => w.severity)).toEqual(['major']);
    expect(checkInteractions({ name: 'Naproxen' }, [], ['aspirin']).map((w) => w.severity)).toEqual(['major']);
    expect(checkInteractions({ name: 'Aleve' }, [], ['NSAIDs']).map((w) => w.severity)).toEqual(['major']);
  });

  it('ignores allergies that do not apply', () => {
    expect(checkInteractions({ name: 'Amoxicillin' }, [], ['sulfa', 'peanuts', 'latex'])).toEqual([]);
    expect(checkInteractions({ name: 'Metformin' }, [], ['penicillin', ''])).toEqual([]);
  });

  it('lists allergy warnings before interactions of the same severity', () => {
    const warnings = checkInteractions({ name: 'Aspirin' }, [existing('Warfarin')], ['NSAID']);
    expect(warnings.map((w) => [w.kind, w.withName])).toEqual([
      ['allergy', 'NSAID'],
      ['interaction', 'Warfarin'],
    ]);
  });
});
