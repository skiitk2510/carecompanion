import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  fixedClock,
  offsetClock,
  spokenClockTime,
  spokenDay,
  toClockTime,
  toLocalDate,
  tzOffsetMinutes,
  zonedToUtc,
} from '../../src/domain/time.js';

const LA = 'America/Los_Angeles';
const IST = 'Asia/Kolkata';

describe('time helpers (household timezone math)', () => {
  it('reads the wall clock in the household timezone regardless of process TZ', () => {
    const instant = '2026-09-16T15:04:05.000Z';
    expect(toLocalDate(instant, LA)).toBe('2026-09-16');
    expect(toClockTime(instant, LA)).toBe('08:04');
    expect(toLocalDate(instant, IST)).toBe('2026-09-16');
    expect(toClockTime(instant, IST)).toBe('20:34');
    // Crosses midnight in IST but not in LA.
    expect(toLocalDate('2026-09-16T19:30:00.000Z', IST)).toBe('2026-09-17');
    expect(toLocalDate('2026-09-16T19:30:00.000Z', LA)).toBe('2026-09-16');
  });

  it('computes offsets on both sides of DST', () => {
    expect(tzOffsetMinutes(new Date('2026-07-01T12:00:00Z'), LA)).toBe(-420); // PDT
    expect(tzOffsetMinutes(new Date('2026-01-01T12:00:00Z'), LA)).toBe(-480); // PST
    expect(tzOffsetMinutes(new Date('2026-01-01T12:00:00Z'), IST)).toBe(330);
  });

  it('resolves wall-clock schedule slots to UTC instants, DST-safe', () => {
    expect(zonedToUtc('2026-09-16', '08:00', LA).toISOString()).toBe('2026-09-16T15:00:00.000Z');
    expect(zonedToUtc('2026-12-16', '08:00', LA).toISOString()).toBe('2026-12-16T16:00:00.000Z');
    expect(zonedToUtc('2026-09-16', '08:00', IST).toISOString()).toBe('2026-09-16T02:30:00.000Z');
    // The US "fall back" day (Nov 1, 2026): 08:00 local is unambiguous and PST.
    expect(zonedToUtc('2026-11-01', '08:00', LA).toISOString()).toBe('2026-11-01T16:00:00.000Z');
    // The "spring forward" day (Mar 8, 2026): 08:00 local is PDT.
    expect(zonedToUtc('2026-03-08', '08:00', LA).toISOString()).toBe('2026-03-08T15:00:00.000Z');
  });

  it('does calendar arithmetic on LocalDate strings', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-09-16', '2026-09-19')).toBe(3);
    expect(daysBetween('2026-09-19', '2026-09-16')).toBe(-3);
  });

  it('speaks times and days the way a voice assistant should', () => {
    expect(spokenClockTime('08:00')).toBe('8 a.m.');
    expect(spokenClockTime('18:30')).toBe('6:30 p.m.');
    expect(spokenClockTime('12:00')).toBe('noon');
    expect(spokenClockTime('00:00')).toBe('midnight');
    expect(spokenClockTime('12:15')).toBe('12:15 p.m.');
    expect(spokenDay('2026-09-16', '2026-09-16', LA)).toBe('today');
    expect(spokenDay('2026-09-17', '2026-09-16', LA)).toBe('tomorrow');
    expect(spokenDay('2026-09-15', '2026-09-16', LA)).toBe('yesterday');
    expect(spokenDay('2026-09-19', '2026-09-16', LA)).toBe('Saturday');
    expect(spokenDay('2026-09-25', '2026-09-16', LA)).toBe('September 25');
  });

  it('offers fixed and offset clocks for demos and tests', () => {
    const base = fixedClock('2026-09-16T15:00:00.000Z');
    expect(base.now().toISOString()).toBe('2026-09-16T15:00:00.000Z');
    expect(offsetClock(base, 90).now().toISOString()).toBe('2026-09-16T16:30:00.000Z');
  });
});
