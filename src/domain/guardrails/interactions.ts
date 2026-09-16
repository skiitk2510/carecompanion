/**
 * Drug-interaction and allergy cross-check for the "add medication" flow. A small curated reference table: the
 * output is a heads-up to ask a pharmacist, never a dosing instruction. Pure and synchronous.
 */
import type { Medication } from '../model.js';

export type InteractionSeverity = 'minor' | 'moderate' | 'major';

export interface InteractionWarning {
  kind: 'interaction' | 'allergy';
  /** The existing medication's display name (interaction) or the allergy as listed (allergy). */
  withName: string;
  severity: InteractionSeverity;
  summary: string;
  advice: string;
  disclaimer: string;
}

/** One symmetric pair of generic names. */
export interface InteractionRule {
  a: string;
  b: string;
  severity: InteractionSeverity;
  summary: string;
  advice: string;
}

export const INTERACTION_DISCLAIMER =
  'This is general reference information, not medical advice — please confirm with a pharmacist or doctor.';

const ASK_PHARMACIST = 'Ask the pharmacist or doctor before combining these.';
const MENTION_TO_PHARMACIST = 'Mention it to the pharmacist so they can keep an eye on it.';

export const INTERACTION_TABLE: readonly InteractionRule[] = [
  {
    a: 'warfarin',
    b: 'aspirin',
    severity: 'major',
    summary: 'Warfarin with aspirin raises the risk of serious bleeding.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'warfarin',
    b: 'ibuprofen',
    severity: 'major',
    summary: 'Warfarin with ibuprofen raises the risk of serious bleeding, including stomach bleeding.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'warfarin',
    b: 'naproxen',
    severity: 'major',
    summary: 'Warfarin with naproxen raises the risk of serious bleeding, including stomach bleeding.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'warfarin',
    b: 'acetaminophen',
    severity: 'minor',
    summary: 'Regular acetaminophen use can strengthen the effect of warfarin and raise the INR.',
    advice: 'Mention it to the pharmacist, especially if it is taken most days.',
  },
  {
    a: 'lisinopril',
    b: 'ibuprofen',
    severity: 'moderate',
    summary: 'Ibuprofen can strain the kidneys and make lisinopril less effective at controlling blood pressure.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'lisinopril',
    b: 'potassium',
    severity: 'moderate',
    summary: 'Lisinopril with potassium supplements can push potassium levels too high.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'lisinopril',
    b: 'naproxen',
    severity: 'moderate',
    summary: 'Naproxen can strain the kidneys and make lisinopril less effective at controlling blood pressure.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'simvastatin',
    b: 'amlodipine',
    severity: 'moderate',
    summary: 'Amlodipine raises the amount of simvastatin in the body, so the simvastatin dose is usually capped.',
    advice: 'Ask the pharmacist to check that the simvastatin dose is right for this combination.',
  },
  {
    a: 'simvastatin',
    b: 'clarithromycin',
    severity: 'major',
    summary: 'Clarithromycin greatly raises simvastatin levels and can cause muscle damage.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'atorvastatin',
    b: 'clarithromycin',
    severity: 'major',
    summary: 'Clarithromycin raises atorvastatin levels and can cause muscle damage.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'metoprolol',
    b: 'verapamil',
    severity: 'major',
    summary: 'Metoprolol with verapamil can slow the heart too much and drop blood pressure.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'digoxin',
    b: 'amiodarone',
    severity: 'major',
    summary: 'Amiodarone raises digoxin levels and can cause digoxin toxicity.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'sertraline',
    b: 'tramadol',
    severity: 'major',
    summary: 'Sertraline with tramadol raises the risk of serotonin syndrome.',
    advice: ASK_PHARMACIST,
  },
  {
    a: 'levothyroxine',
    b: 'calcium',
    severity: 'minor',
    summary: 'Calcium can stop levothyroxine from being absorbed properly.',
    advice: 'Ask the pharmacist about spacing them out — usually about four hours apart.',
  },
  {
    a: 'metformin',
    b: 'alcohol',
    severity: 'moderate',
    summary: 'Alcohol with metformin raises the risk of low blood sugar and a rare but serious acid build-up.',
    advice: MENTION_TO_PHARMACIST,
  },
];

/** Brand and spelling variants → the generic name used by the table. Keys and values are already normalized. */
export const DRUG_ALIASES: Readonly<Record<string, string>> = {
  coumadin: 'warfarin',
  jantoven: 'warfarin',
  advil: 'ibuprofen',
  motrin: 'ibuprofen',
  nuprin: 'ibuprofen',
  ibuprofen: 'ibuprofen',
  aleve: 'naproxen',
  naprosyn: 'naproxen',
  zestril: 'lisinopril',
  prinivil: 'lisinopril',
  glucophage: 'metformin',
  fortamet: 'metformin',
  glumetza: 'metformin',
  norvasc: 'amlodipine',
  zocor: 'simvastatin',
  lipitor: 'atorvastatin',
  lopressor: 'metoprolol',
  toprol: 'metoprolol',
  'toprol-xl': 'metoprolol',
  synthroid: 'levothyroxine',
  levoxyl: 'levothyroxine',
  levothroid: 'levothyroxine',
  unithroid: 'levothyroxine',
  zoloft: 'sertraline',
  ultram: 'tramadol',
  lanoxin: 'digoxin',
  cordarone: 'amiodarone',
  pacerone: 'amiodarone',
  biaxin: 'clarithromycin',
  calan: 'verapamil',
  isoptin: 'verapamil',
  tylenol: 'acetaminophen',
  paracetamol: 'acetaminophen',
  panadol: 'acetaminophen',
  amoxil: 'amoxicillin',
  augmentin: 'amoxicillin-clavulanate',
  'amoxicillin clavulanate': 'amoxicillin-clavulanate',
  'co-amoxiclav': 'amoxicillin-clavulanate',
  bayer: 'aspirin',
  ecotrin: 'aspirin',
  bactrim: 'sulfamethoxazole-trimethoprim',
  septra: 'sulfamethoxazole-trimethoprim',
  azulfidine: 'sulfasalazine',
  'klor-con': 'potassium',
  'k-dur': 'potassium',
};

/** "10 mg", "500/125 mg", "1000 IU", "20 mEq", "2.5%". */
const STRENGTH_RE =
  /\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)*\s*(?:mcg|µg|ug|mg|g|ml|iu|units?|meq|mmol|%)(?![a-z])/g;
/** A number on its own ("metformin 500") — but not one glued to letters ("b12", "coq10"). */
const BARE_NUMBER_RE = /(?<![a-z\d])\d+(?:[.,]\d+)?(?![a-z\d])/g;

/** Words that never identify the drug: dosage forms, release types, marketing words, connectives. */
const FORM_NOISE: ReadonlySet<string> = new Set([
  'er',
  'xr',
  'sr',
  'xl',
  'cr',
  'la',
  'ir',
  'dr',
  'ec',
  'odt',
  'tablet',
  'tablets',
  'tab',
  'tabs',
  'capsule',
  'capsules',
  'cap',
  'caps',
  'caplet',
  'caplets',
  'pill',
  'pills',
  'oral',
  'solution',
  'suspension',
  'syrup',
  'liquid',
  'drops',
  'cream',
  'ointment',
  'gel',
  'patch',
  'patches',
  'injection',
  'inhaler',
  'spray',
  'chewable',
  'coated',
  'enteric',
  'extended',
  'delayed',
  'immediate',
  'sustained',
  'release',
  'strength',
  'extra',
  'regular',
  'maximum',
  'max',
  'low',
  'dose',
  'baby',
  'daily',
  'generic',
  'brand',
  'with',
  'and',
  'plus',
  'of',
  'the',
  'for',
]);

/** Salt / counter-ion words, dropped when they trail the drug name ("warfarin sodium", "potassium chloride"). */
const SALT_SUFFIXES: ReadonlySet<string> = new Set([
  'sodium',
  'potassium',
  'calcium',
  'magnesium',
  'hydrochloride',
  'hcl',
  'hydrobromide',
  'hbr',
  'sulfate',
  'sulphate',
  'maleate',
  'tartrate',
  'succinate',
  'besylate',
  'mesylate',
  'acetate',
  'citrate',
  'phosphate',
  'carbonate',
  'chloride',
  'gluconate',
  'fumarate',
  'bromide',
  'nitrate',
  'monohydrate',
  'dihydrate',
  'trihydrate',
]);

/**
 * "Warfarin Sodium 5mg" → "warfarin", "Advil 200 mg" → "ibuprofen", "Toprol XL 50 mg" → "metoprolol",
 * "Potassium Chloride 20 mEq" → "potassium". Combination products keep their parts: "lisinopril-hydrochlorothiazide".
 */
export function normalizeDrugName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(STRENGTH_RE, ' ')
    .replace(BARE_NUMBER_RE, ' ')
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/(?<=[a-z])\/(?=[a-z])/g, '-')
    .replace(/(?<![a-z])[-/]|[-/](?![a-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return '';

  const tokens = cleaned.split(' ');
  const meaningful = tokens.filter((t) => !FORM_NOISE.has(t));
  const words = meaningful.filter((t, i) => i === 0 || !SALT_SUFFIXES.has(t));
  const base = (words.length > 0 ? words : [tokens[0] ?? '']).join(' ');
  return DRUG_ALIASES[base] ?? DRUG_ALIASES[words[0] ?? ''] ?? base;
}

const ALLERGY_ALIASES: Readonly<Record<string, string>> = {
  penicillins: 'penicillin',
  pcn: 'penicillin',
  'sulfa drugs': 'sulfa',
  sulpha: 'sulfa',
  sulfonamide: 'sulfa',
  sulfonamides: 'sulfa',
  nsaids: 'nsaid',
};

interface AllergyClass {
  members: readonly string[];
  describe: (drug: string) => string;
}

const NSAIDS: readonly string[] = [
  'aspirin',
  'ibuprofen',
  'naproxen',
  'diclofenac',
  'meloxicam',
  'celecoxib',
  'ketorolac',
  'indomethacin',
];

/** A listed allergy that also covers a whole class of drugs. */
const ALLERGY_CLASSES: Readonly<Record<string, AllergyClass>> = {
  penicillin: {
    members: [
      'penicillin',
      'amoxicillin',
      'ampicillin',
      'amoxicillin-clavulanate',
      'piperacillin',
      'dicloxacillin',
      'nafcillin',
    ],
    describe: (drug) => `${drug} is a penicillin-class antibiotic.`,
  },
  sulfa: {
    members: ['sulfamethoxazole', 'sulfasalazine', 'sulfadiazine', 'sulfamethoxazole-trimethoprim'],
    describe: (drug) => `${drug} is a sulfa drug.`,
  },
  aspirin: { members: NSAIDS, describe: (drug) => `${drug} is an NSAID in the same family as aspirin.` },
  nsaid: { members: NSAIDS, describe: (drug) => `${drug} is an NSAID.` },
  ibuprofen: { members: NSAIDS, describe: (drug) => `${drug} is an NSAID in the same family as ibuprofen.` },
  naproxen: { members: NSAIDS, describe: (drug) => `${drug} is an NSAID in the same family as naproxen.` },
};

const ALLERGY_ADVICE = 'Please check with the doctor or pharmacist before adding this.';

const SEVERITY_RANK: Record<InteractionSeverity, number> = { major: 0, moderate: 1, minor: 2 };

/** Normalized, de-duplicated names a medication goes by (generic first, then the display name). */
function identities(name: string, genericName?: string): string[] {
  const out: string[] = [];
  for (const raw of [genericName, name]) {
    const normalized = raw ? normalizeDrugName(raw) : '';
    if (normalized !== '' && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/** Exact match, or a component of a combination product ("lisinopril-hydrochlorothiazide" matches "lisinopril"). */
function matches(names: readonly string[], key: string): boolean {
  return names.some((n) => n === key || n.split(/[\s-]+/).includes(key));
}

function normalizeAllergy(allergy: string): string {
  const normalized = normalizeDrugName(allergy);
  return ALLERGY_ALIASES[normalized] ?? normalized;
}

/**
 * Warnings for adding `candidate` alongside the elder's ACTIVE `existing` medications and listed `allergies`.
 * Major first; empty when nothing in the table applies.
 */
export function checkInteractions(
  candidate: { name: string; genericName?: string },
  existing: readonly Medication[],
  allergies: readonly string[]
): InteractionWarning[] {
  const candidateNames = identities(candidate.name, candidate.genericName);
  const candidateLabel = candidateNames[0] ?? candidate.name.trim();
  const warnings: InteractionWarning[] = [];

  for (const allergy of allergies) {
    const key = normalizeAllergy(allergy);
    if (key === '') continue;
    const label = allergy.trim();
    let summary: string | null = null;
    if (matches(candidateNames, key)) {
      summary = `Listed ${label} allergy — ${candidateLabel} matches it directly.`;
    } else {
      const cls = ALLERGY_CLASSES[key];
      if (cls && cls.members.some((member) => matches(candidateNames, member))) {
        summary = `Listed ${label} allergy — ${cls.describe(candidateLabel)}`;
      }
    }
    if (summary !== null) {
      warnings.push({
        kind: 'allergy',
        withName: label,
        severity: 'major',
        summary,
        advice: ALLERGY_ADVICE,
        disclaimer: INTERACTION_DISCLAIMER,
      });
    }
  }

  for (const medication of existing) {
    if (!medication.active) continue;
    const existingNames = identities(medication.name, medication.genericName);
    for (const rule of INTERACTION_TABLE) {
      const hit =
        (matches(candidateNames, rule.a) && matches(existingNames, rule.b)) ||
        (matches(candidateNames, rule.b) && matches(existingNames, rule.a));
      if (!hit) continue;
      warnings.push({
        kind: 'interaction',
        withName: medication.name,
        severity: rule.severity,
        summary: rule.summary,
        advice: rule.advice,
        disclaimer: INTERACTION_DISCLAIMER,
      });
    }
  }

  // Array.prototype.sort is stable, so ties keep allergy-then-medication-list order.
  return warnings.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
}
