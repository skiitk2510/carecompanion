import { describe, expect, it } from 'vitest';
import {
  classifySymptoms,
  evaluateEscalation,
  isLowMood,
  normalizeSymptomText,
  type EscalationInput,
  type EscalationResult,
} from '../../../src/domain/guardrails/escalation.js';
import type { Caregiver, Elder, Household } from '../../../src/domain/model.js';

const household: Household = {
  id: 'hh_garcia',
  name: 'The Garcias',
  timezone: 'America/Los_Angeles',
  emergencyNumber: '911',
};

const elder: Elder = {
  id: 'elder_rosa',
  householdId: household.id,
  name: 'Rosa',
  age: 78,
  conditions: ['hypertension'],
  allergies: [],
  prefs: {
    preferredName: 'Rosa',
    wakeTime: '07:00',
    breakfastTime: '08:00',
    lunchTime: '12:30',
    dinnerTime: '18:00',
    bedTime: '21:30',
    checkInDeadline: '11:00',
  },
};

const maria: Caregiver = {
  id: 'cg_maria',
  householdId: household.id,
  name: 'Maria',
  relationship: 'daughter',
  channel: 'sms',
  escalationPriority: 1,
};
const ben: Caregiver = {
  ...maria,
  id: 'cg_ben',
  name: 'Ben',
  relationship: 'son',
  channel: 'push',
  escalationPriority: 2,
};

const at = new Date('2026-09-16T15:15:00.000Z'); // 8:15 a.m. in LA

function evaluate(overrides: Partial<EscalationInput> = {}): EscalationResult {
  // Caregivers deliberately out of priority order.
  return evaluateEscalation({
    elder,
    household,
    caregivers: [ben, maria],
    symptomsText: '',
    source: 'checkin',
    at,
    ...overrides,
  });
}

describe('normalizeSymptomText', () => {
  it('lowercases, expands contractions and strips punctuation', () => {
    expect(normalizeSymptomText("I can't breathe!!")).toBe('i cannot breathe');
    expect(normalizeSymptomText('I cant   breathe')).toBe('i cannot breathe');
    expect(normalizeSymptomText('I can not breathe.')).toBe('i cannot breathe');
    expect(normalizeSymptomText("I couldn’t sleep, I'm exhausted")).toBe('i could not sleep i am exhausted');
    expect(normalizeSymptomText("Didn't sleep")).toBe('did not sleep');
  });
});

describe('classifySymptoms', () => {
  it('classifies emergencies', () => {
    expect(classifySymptoms("I can't breathe")).toEqual({ severity: 'emergency', matched: ['cannot breathe'] });
    expect(classifySymptoms('cant breathe')).toEqual({ severity: 'emergency', matched: ['cannot breathe'] });
    expect(classifySymptoms('I fell down this morning')).toEqual({ severity: 'emergency', matched: ['fell down'] });
    expect(classifySymptoms('There is pressure in my chest').severity).toBe('emergency');
    expect(classifySymptoms('I think I passed out for a moment').severity).toBe('emergency');
    expect(classifySymptoms('My face is drooping and my speech is slurring').severity).toBe('emergency');
    expect(classifySymptoms('I took too many of my pills').severity).toBe('emergency');
  });

  it('classifies urgent symptoms', () => {
    expect(classifySymptoms('feeling a bit dizzy')).toEqual({ severity: 'urgent', matched: ['dizzy'] });
    expect(classifySymptoms("I'm confused and I have a fever")).toEqual({
      severity: 'urgent',
      matched: ['confused', 'fever'],
    });
    expect(classifySymptoms('I keep throwing up').severity).toBe('urgent');
    expect(classifySymptoms('there was blood in my urine').severity).toBe('urgent');
  });

  it('classifies things to watch', () => {
    expect(classifySymptoms('just tired')).toEqual({ severity: 'watch', matched: ['tired'] });
    expect(classifySymptoms('a bit of a headache and feeling down').matched).toEqual(['headache', 'down']);
    expect(classifySymptoms('my ankles are swollen').severity).toBe('watch');
    expect(classifySymptoms("didn't sleep well").severity).toBe('watch');
  });

  it('returns none for a good day', () => {
    expect(classifySymptoms('great, slept well')).toEqual({ severity: 'none', matched: [] });
    expect(classifySymptoms('')).toEqual({ severity: 'none', matched: [] });
    expect(classifySymptoms('   ')).toEqual({ severity: 'none', matched: [] });
  });

  it('matches whole words only', () => {
    expect(classifySymptoms('my fellow residents came by').severity).toBe('none');
    expect(classifySymptoms('I need to download a book').severity).toBe('none');
    expect(classifySymptoms('the downstairs light is out').severity).toBe('none');
    expect(classifySymptoms('sadly the game was cancelled').severity).toBe('none');
  });

  it('does not treat falling asleep as a fall', () => {
    expect(classifySymptoms('I fell asleep in front of the TV').severity).toBe('none');
    expect(classifySymptoms('I fell asleep and then fell down').severity).toBe('emergency');
  });

  it('takes the highest band and keeps only the longest matching phrases', () => {
    expect(classifySymptoms('tired and short of breath')).toEqual({
      severity: 'emergency',
      matched: ['short of breath', 'tired'],
    });
    expect(classifySymptoms('my throat is swelling')).toEqual({
      severity: 'emergency',
      matched: ['throat is swelling'],
    });
    expect(classifySymptoms('a high fever')).toEqual({ severity: 'urgent', matched: ['high fever'] });
  });
});

describe('isLowMood', () => {
  it('recognizes low moods and negations', () => {
    for (const mood of ['bad', 'Awful', 'terrible', 'low', 'sad', 'not good', 'poorly', 'pretty low', 'not so great']) {
      expect(isLowMood(mood), mood).toBe(true);
    }
    for (const mood of [undefined, '', 'good', 'great', 'fine', 'not bad', 'not too bad', 'okay']) {
      expect(isLowMood(mood), String(mood)).toBe(false);
    }
    expect(isLowMood('dizzy')).toBe(true);
  });
});

describe('evaluateEscalation — help', () => {
  it('treats a help request as an emergency and alerts every caregiver', () => {
    const result = evaluate({ source: 'help', symptomsText: 'I need help, I dropped my cane and cannot reach it' });
    expect(result.severity).toBe('emergency');
    expect(result.flagged).toBe(true);
    expect(result.notified).toEqual(['cg_maria', 'cg_ben']);
    expect(result.emergencyGuidance).toBe(
      "This could be an emergency. Please call 911 right now. I'm alerting Maria and Ben."
    );
    expect(result.spoken).toBe(result.emergencyGuidance);
    expect(result.alertSpec).toMatchObject({
      elderId: 'elder_rosa',
      type: 'help',
      severity: 'critical',
      title: 'Help requested',
      notified: ['cg_maria', 'cg_ben'],
    });
    expect(result.alertSpec?.dedupeKey).toBeUndefined();
    expect(result.alertSpec?.detail).toContain('"I need help, I dropped my cane and cannot reach it"');
    expect(result.alertSpec?.detail).toContain('8:15 a.m.');
  });

  it('is an emergency even with no text at all', () => {
    const result = evaluate({ source: 'help', symptomsText: '' });
    expect(result.severity).toBe('emergency');
    expect(result.emergencyGuidance).toContain('911');
    expect(result.alertSpec?.detail).toBe('At 8:15 a.m., Rosa asked for help.');
  });
});

describe('evaluateEscalation — check-ins', () => {
  it('emergency: guidance first and verbatim, all caregivers notified', () => {
    const result = evaluate({ symptomsText: "I can't breathe", mood: 'bad' });
    expect(result.severity).toBe('emergency');
    expect(result.flagged).toBe(true);
    expect(result.emergencyGuidance?.startsWith('This could be an emergency. Please call 911 right now.')).toBe(true);
    expect(result.emergencyGuidance).toContain("I'm alerting Maria and Ben.");
    expect(result.spoken).toBe(result.emergencyGuidance);
    expect(result.notified).toEqual(['cg_maria', 'cg_ben']);
    expect(result.alertSpec).toMatchObject({
      type: 'symptom',
      severity: 'critical',
      title: 'Emergency symptoms reported',
      notified: ['cg_maria', 'cg_ben'],
    });
    expect(result.alertSpec?.dedupeKey).toBeUndefined();
    expect(result.alertSpec?.detail).toBe(
      'At 8:15 a.m., Rosa said "I can\'t breathe" and was feeling "bad". Matched: cannot breathe.'
    );
  });

  it('urgent: notifies only the priority-1 caregiver, no emergency guidance', () => {
    const result = evaluate({ symptomsText: 'feeling a bit dizzy' });
    expect(result.severity).toBe('urgent');
    expect(result.flagged).toBe(true);
    expect(result.emergencyGuidance).toBeUndefined();
    expect(result.notified).toEqual(['cg_maria']);
    expect(result.alertSpec).toMatchObject({ type: 'symptom', severity: 'critical', notified: ['cg_maria'] });
    expect(result.alertSpec?.detail).toContain('"feeling a bit dizzy"');
    expect(result.spoken).toBe("That sounds worth a call. I've let Maria know right away. If it gets worse, call 911.");
  });

  it('watch: dashboard only, nobody notified', () => {
    const result = evaluate({ symptomsText: 'just tired' });
    expect(result.severity).toBe('watch');
    expect(result.flagged).toBe(true);
    expect(result.emergencyGuidance).toBeUndefined();
    expect(result.notified).toEqual([]);
    expect(result.alertSpec).toMatchObject({ type: 'symptom', severity: 'info', notified: [] });
    expect(result.spoken).toBe("Thanks for telling me. I've noted it for Maria to see. Take it easy today.");
  });

  it('none: nothing to alert', () => {
    const result = evaluate({ symptomsText: 'great, slept well', mood: 'good' });
    expect(result).toEqual({
      severity: 'none',
      flagged: false,
      notified: [],
      spoken: "Glad to hear it. I've logged your check-in.",
    });
  });

  it('a low mood with no symptoms is worth watching', () => {
    const result = evaluate({ mood: 'bad', symptomsText: '' });
    expect(result.severity).toBe('watch');
    expect(result.flagged).toBe(true);
    expect(result.notified).toEqual([]);
    expect(result.alertSpec?.severity).toBe('info');
    expect(result.alertSpec?.detail).toBe('At 8:15 a.m., Rosa was feeling "bad".');
  });

  it('mood alone never goes above watch, and never lowers a symptom band', () => {
    expect(evaluate({ mood: 'chest pain', symptomsText: '' }).severity).toBe('watch');
    expect(evaluate({ mood: 'great', symptomsText: 'chest pain' }).severity).toBe('emergency');
    expect(evaluate({ mood: 'bad', symptomsText: 'a bit dizzy' }).severity).toBe('urgent');
  });

  it('copes with a household that has no caregivers yet', () => {
    const emergency = evaluate({ caregivers: [], symptomsText: 'chest pain' });
    expect(emergency.emergencyGuidance).toBe('This could be an emergency. Please call 911 right now.');
    expect(emergency.notified).toEqual([]);
    expect(emergency.alertSpec?.notified).toEqual([]);

    const urgent = evaluate({ caregivers: [], symptomsText: 'dizzy' });
    expect(urgent.notified).toEqual([]);
    expect(urgent.spoken).toContain('call 911');

    const watch = evaluate({ caregivers: [], symptomsText: 'tired' });
    expect(watch.spoken).toBe("Thanks for telling me. I've noted it. Take it easy today.");
  });

  it('does not mutate the caregiver list it is given', () => {
    const caregivers = [ben, maria];
    evaluate({ caregivers, symptomsText: 'chest pain' });
    expect(caregivers).toEqual([ben, maria]);
  });

  it('uses the household emergency number', () => {
    const uk = { ...household, emergencyNumber: '999' };
    const result = evaluate({ household: uk, symptomsText: 'I fell' });
    expect(result.emergencyGuidance?.startsWith('This could be an emergency. Please call 999 right now.')).toBe(true);
  });
});
