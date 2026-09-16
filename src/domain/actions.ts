/**
 * The domain actions behind every MCP tool and REST route. Each action runs synchronously against the store,
 * applies the guardrails, records outcomes, simulates caregiver notification, and returns BOTH a structured
 * result (matching src/mcp/schemas.ts) and a `spoken` sentence written for a voice assistant.
 */
import type * as z from 'zod/v4';
import type { Logger } from '../log.js';
import type {
  AddMedicationOutput,
  CallForHelpOutput,
  DailyCheckinOutput,
  GetTodaysPlanOutput,
  LogDoseOutput,
  ResolveAlertOutput,
  SkipDoseOutput,
} from '../mcp/schemas.js';
import type {
  AdherenceCounts,
  DashboardAlert,
  DashboardAppointment,
  DashboardCheckIn,
  DashboardData,
  DashboardDose,
} from '../shared/dashboard.js';
import { computeAdherence } from './adherence.js';
import { acknowledgeAlert, caregiversFor, createAlert, openAlerts, resolveAlert } from './alerts.js';
import { checkDoseGuard } from './guardrails/doseGuard.js';
import { evaluateEscalation } from './guardrails/escalation.js';
import { checkInteractions, normalizeDrugName } from './guardrails/interactions.js';
import { newId } from './ids.js';
import type { Alert, Caregiver, CheckIn, DoseEvent, DoseSource, Elder, Household, Medication, State } from './model.js';
import { simulateNotify } from './notify.js';
import { resolveMedication } from './resolveMedication.js';
import { buildSeedState, type SeedScenario } from './seed.js';
import { nearestOpenSlot, nextUpcomingSlot, slotsForDay, slotsForMedication, type DoseSlot } from './slots.js';
import type { Store } from './store.js';
import { runSweeps } from './sweeps.js';
import {
  addDays,
  spokenClockTime,
  spokenDateTime,
  spokenDay,
  spokenTime,
  toClockTime,
  toLocalDate,
  wallClock,
} from './time.js';

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: 'elder_not_found' | 'caregiver_not_found' | 'alert_not_found' | 'invalid_input'
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

type Spoken<T> = T & { spoken: string };
export type TodaysPlanResult = Spoken<z.infer<typeof GetTodaysPlanOutput>>;
export type LogDoseResult = Spoken<z.infer<typeof LogDoseOutput>>;
export type SkipDoseResult = Spoken<z.infer<typeof SkipDoseOutput>>;
export type DailyCheckinResult = Spoken<z.infer<typeof DailyCheckinOutput>>;
export type CallForHelpResult = Spoken<z.infer<typeof CallForHelpOutput>>;
export type AddMedicationResult = Spoken<z.infer<typeof AddMedicationOutput>>;
export type ResolveAlertResult = Spoken<z.infer<typeof ResolveAlertOutput>>;
export type CaregiverSummaryResult = Spoken<DashboardData>;

interface ElderContext {
  elder: Elder;
  household: Household;
  caregivers: Caregiver[];
  tz: string;
  today: string;
}

export interface ActionsDeps {
  store: Store;
  log: Logger;
}

export class CareActions {
  private readonly store: Store;
  private readonly log: Logger;

  constructor(deps: ActionsDeps) {
    this.store = deps.store;
    this.log = deps.log.child('actions');
  }

  // --- context -----------------------------------------------------------------------------------

  private context(elderId?: string): ElderContext {
    const state = this.store.get();
    const elder = elderId ? state.elders.find((e) => e.id === elderId) : state.elders[0];
    if (!elder) throw new DomainError(`No elder found${elderId ? ` with id ${elderId}` : ''}.`, 'elder_not_found');
    const household = state.households.find((h) => h.id === elder.householdId);
    if (!household) throw new DomainError(`Household ${elder.householdId} not found.`, 'elder_not_found');
    const tz = household.timezone;
    return {
      elder,
      household,
      caregivers: caregiversFor(state, elder.id),
      tz,
      today: toLocalDate(this.store.now(), tz),
    };
  }

  /** Lazily evaluate missed doses / no-check-in before any read, so the store never needs timers. */
  private sweep(ctx: ElderContext): void {
    const now = this.store.now();
    const created = this.store.mutate((state) => runSweeps(state, now, ctx.tz));
    for (const alert of created.alerts) simulateNotify(alert, ctx.caregivers, this.log);
  }

  private activeMedications(state: Readonly<State>, elderId: string): Medication[] {
    return state.medications.filter((m) => m.elderId === elderId && m.active);
  }

  private priorityIds(ctx: ElderContext, all: boolean): string[] {
    const ids = ctx.caregivers.map((c) => c.id);
    return all ? ids : ids.slice(0, 1);
  }

  // --- elder-facing --------------------------------------------------------------------------------

  todaysPlan(elderId?: string): TodaysPlanResult {
    const ctx = this.context(elderId);
    this.sweep(ctx);
    const state = this.store.get();
    const now = this.store.now();
    const slots = slotsForDay(state, ctx.elder.id, ctx.today, ctx.tz);
    const doses = slots.map((s) => doseView(s));
    const next = nextUpcomingSlot(slots, now);
    const appointments = upcomingAppointments(state, ctx, 14);
    const checkedInToday = state.checkIns.some((c) => c.elderId === ctx.elder.id && c.localDate === ctx.today);
    const openCount = openAlerts(state, ctx.elder.id).length;

    const taken = doses.filter((d) => d.status === 'taken' || d.status === 'late');
    const missed = doses.filter((d) => d.status === 'missed');
    const parts: string[] = [`${greeting(now, ctx.tz)}, ${ctx.elder.prefs.preferredName}.`];
    if (doses.length === 0) parts.push('You have no medications scheduled today.');
    else {
      parts.push(
        `You have ${doses.length} ${doses.length === 1 ? 'dose' : 'doses'} today` +
          (taken.length > 0 ? `, and you've taken ${taken.length} so far.` : '.')
      );
      if (next) parts.push(`Next up is ${next.medication.name} at ${spokenClockTime(next.scheduledTime)}.`);
      if (missed.length > 0) parts.push(`You missed ${joinSpoken(missed.map((d) => `${d.name} at ${d.spokenTime}`))}.`);
    }
    const soon = appointments.filter((a) => a.when.startsWith('today') || a.when.startsWith('tomorrow'));
    for (const a of soon.slice(0, 2)) parts.push(`${a.title} is ${a.when}.`);
    if (!checkedInToday) parts.push('How are you feeling today?');

    return {
      today: ctx.today,
      localTime: toClockTime(now, ctx.tz),
      elderName: ctx.elder.prefs.preferredName,
      doses,
      nextUp: next ? doseView(next) : null,
      appointments,
      checkedInToday,
      openAlertsCount: openCount,
      spoken: parts.join(' '),
    };
  }

  logDose(input: {
    elderId?: string;
    medication: string;
    takenAt?: string;
    confirmOverride?: boolean;
    overrideReason?: string;
    source?: DoseSource;
  }): LogDoseResult {
    const ctx = this.context(input.elderId);
    const state = this.store.get();
    const match = resolveMedication(input.medication, this.activeMedications(state, ctx.elder.id));
    const base = {
      recorded: false,
      status: null,
      medication: null,
      requiresConfirmation: false,
      reason: null,
      lastTakenAt: null,
      nextAllowedAt: null,
      alertId: null,
    } as const;
    if (match.kind === 'ambiguous') {
      return { ...base, verdict: 'ambiguous', candidates: match.candidates.map((m) => m.name), spoken: match.spoken };
    }
    if (match.kind === 'none') return { ...base, verdict: 'not_found', spoken: match.spoken };

    const medication = match.medication;
    const at = input.takenAt ? new Date(input.takenAt) : this.store.now();
    if (Number.isNaN(at.getTime())) throw new DomainError('takenAt is not a valid ISO timestamp.', 'invalid_input');
    const verdict = checkDoseGuard({
      state,
      medication,
      at,
      tz: ctx.tz,
      confirmOverride: input.confirmOverride,
      overrideReason: input.overrideReason,
    });
    const ref = { id: medication.id, name: medication.name, dose: medication.dose };

    if (verdict.kind === 'refuse') {
      return {
        ...base,
        verdict: 'refuse',
        medication: ref,
        requiresConfirmation: verdict.requiresConfirmation,
        reason: verdict.reason,
        lastTakenAt: verdict.lastTakenAt,
        nextAllowedAt: verdict.nextAllowedAt,
        spoken: verdict.spoken,
      };
    }

    const event: DoseEvent = {
      id: newId('dose'),
      elderId: ctx.elder.id,
      medicationId: medication.id,
      localDate: toLocalDate(at, ctx.tz),
      // An override is an unscheduled extra: attaching it to the nearest open slot would silence that slot's
      // reminder and missed-dose sweep (e.g. an 8:30 a.m. override claiming the 6 p.m. slot).
      scheduledTime: verdict.kind === 'allow_override' ? null : (verdict.slot?.scheduledTime ?? null),
      status: verdict.status,
      recordedAt: at.toISOString(),
      source: input.source ?? 'elder',
    };
    let alertId: string | null = null;
    if (verdict.kind === 'allow_override') {
      event.overrideReason = input.overrideReason?.trim();
      const alert = this.store.mutate((s) => {
        s.doses.push(event);
        const { alert } = createAlert(
          s,
          {
            elderId: ctx.elder.id,
            type: 'dose_override',
            severity: 'warning',
            title: `Extra ${medication.name} recorded after override`,
            detail: `${ctx.elder.prefs.preferredName} confirmed an extra ${medication.name} ${medication.dose} at ${spokenTime(at, ctx.tz)} (last dose ${verdict.lastTakenAt ? spokenTime(verdict.lastTakenAt, ctx.tz) : 'unknown'}). Reason given: "${event.overrideReason}".`,
            refId: event.id,
            notified: this.priorityIds(ctx, false),
          },
          this.store.now()
        );
        return alert;
      });
      simulateNotify(alert, ctx.caregivers, this.log);
      alertId = alert.id;
    } else {
      this.store.mutate((s) => s.doses.push(event));
    }
    this.log.info('dose recorded', { medication: medication.name, status: event.status, source: event.source });
    return {
      ...base,
      recorded: true,
      verdict: verdict.kind,
      status: verdict.status,
      medication: ref,
      lastTakenAt: verdict.kind === 'allow_override' ? verdict.lastTakenAt : null,
      alertId,
      spoken: verdict.spoken,
    };
  }

  skipDose(input: { elderId?: string; medication: string; reason?: string; source?: DoseSource }): SkipDoseResult {
    const ctx = this.context(input.elderId);
    const state = this.store.get();
    const match = resolveMedication(input.medication, this.activeMedications(state, ctx.elder.id));
    const base = { recorded: false, medication: null, scheduledTime: null, alertId: null } as const;
    if (match.kind === 'ambiguous') {
      return { ...base, verdict: 'ambiguous', candidates: match.candidates.map((m) => m.name), spoken: match.spoken };
    }
    if (match.kind === 'none') return { ...base, verdict: 'not_found', spoken: match.spoken };

    const medication = match.medication;
    const now = this.store.now();
    const slot = nearestOpenSlot(slotsForMedication(state, medication, ctx.today, ctx.tz), now);
    const ref = { id: medication.id, name: medication.name, dose: medication.dose };
    if (!slot) {
      return {
        ...base,
        verdict: 'nothing_due',
        medication: ref,
        spoken: `There's no ${medication.name} dose left to skip today.`,
      };
    }
    const event: DoseEvent = {
      id: newId('dose'),
      elderId: ctx.elder.id,
      medicationId: medication.id,
      localDate: ctx.today,
      scheduledTime: slot.scheduledTime,
      status: 'skipped',
      recordedAt: now.toISOString(),
      source: input.source ?? 'elder',
    };
    if (input.reason) event.reason = input.reason;
    const notify = this.priorityIds(ctx, false);
    const alert = this.store.mutate((s) => {
      s.doses.push(event);
      return createAlert(
        s,
        {
          elderId: ctx.elder.id,
          type: 'skipped_dose',
          severity: medication.critical ? 'warning' : 'info',
          title: `Skipped ${medication.name} (${spokenClockTime(slot.scheduledTime)})`,
          detail: `${ctx.elder.prefs.preferredName} skipped the ${spokenClockTime(slot.scheduledTime)} ${medication.name}${input.reason ? ` — "${input.reason}"` : ''}.`,
          refId: event.id,
          notified: medication.critical ? notify : [],
        },
        now
      ).alert;
    });
    const names = simulateNotify(alert, ctx.caregivers, this.log);
    const spoken =
      `Okay, I've marked your ${spokenClockTime(slot.scheduledTime)} ${medication.name} as skipped` +
      (names.length > 0 ? ` and let ${joinSpoken(names)} know.` : '.');
    return {
      ...base,
      recorded: true,
      verdict: 'skipped',
      medication: ref,
      scheduledTime: slot.scheduledTime,
      alertId: alert.id,
      spoken,
    };
  }

  dailyCheckIn(input: { elderId?: string; mood: string; symptoms?: string[]; notes?: string }): DailyCheckinResult {
    const ctx = this.context(input.elderId);
    const now = this.store.now();
    const symptoms = (input.symptoms ?? []).map((s) => s.trim()).filter(Boolean);
    const symptomsText = [...symptoms, input.notes ?? ''].filter(Boolean).join('. ');
    const escalation = evaluateEscalation({
      elder: ctx.elder,
      household: ctx.household,
      caregivers: ctx.caregivers,
      mood: input.mood,
      symptomsText,
      source: 'checkin',
      at: now,
    });
    const checkIn: CheckIn = {
      id: newId('checkin'),
      elderId: ctx.elder.id,
      at: now.toISOString(),
      localDate: ctx.today,
      mood: input.mood.trim(),
      symptoms,
      severity: escalation.severity,
      flagged: escalation.flagged,
    };
    if (input.notes) checkIn.notes = input.notes;
    const alert = this.store.mutate((s) => {
      s.checkIns.push(checkIn);
      return escalation.alertSpec ? createAlert(s, { ...escalation.alertSpec, refId: checkIn.id }, now).alert : null;
    });
    const notified = alert ? simulateNotify(alert, ctx.caregivers, this.log) : [];
    this.log.info('check-in recorded', { mood: checkIn.mood, severity: checkIn.severity });
    const result: DailyCheckinResult = {
      checkInId: checkIn.id,
      severity: escalation.severity,
      flagged: escalation.flagged,
      alertIds: alert ? [alert.id] : [],
      notified,
      spoken: escalation.spoken,
    };
    if (escalation.emergencyGuidance) result.emergencyGuidance = escalation.emergencyGuidance;
    return result;
  }

  callForHelp(input: { elderId?: string; message?: string }): CallForHelpResult {
    const ctx = this.context(input.elderId);
    const now = this.store.now();
    const escalation = evaluateEscalation({
      elder: ctx.elder,
      household: ctx.household,
      caregivers: ctx.caregivers,
      symptomsText: input.message ?? '',
      source: 'help',
      at: now,
    });
    const spec = escalation.alertSpec ?? {
      elderId: ctx.elder.id,
      type: 'help' as const,
      severity: 'critical' as const,
      title: 'Help requested',
      detail: input.message ?? 'The elder asked for help.',
      notified: this.priorityIds(ctx, true),
    };
    const alert = this.store.mutate((s) => createAlert(s, spec, now).alert);
    const notified = simulateNotify(alert, ctx.caregivers, this.log);
    const emergencyGuidance =
      escalation.emergencyGuidance ??
      `This could be an emergency. Please call ${ctx.household.emergencyNumber} right now. I'm alerting ${joinSpoken(notified)}.`;
    return { alertId: alert.id, notified, emergencyGuidance, spoken: emergencyGuidance };
  }

  // --- caregiver-facing ----------------------------------------------------------------------------

  addMedication(input: {
    elderId?: string;
    name: string;
    dose: string;
    form?: string;
    scheduleTimes: string[];
    purpose?: string;
    instructions?: string;
    critical?: boolean;
    maxDailyDoses?: number;
    minIntervalMin?: number;
    graceMin?: number;
    addedBy?: string;
  }): AddMedicationResult {
    const ctx = this.context(input.elderId);
    const state = this.store.get();
    const now = this.store.now();
    const name = titleCase(input.name.trim());
    const warnings = checkInteractions(
      { name, genericName: normalizeDrugName(name) },
      this.activeMedications(state, ctx.elder.id),
      ctx.elder.allergies
    );
    const scheduleTimes = [...new Set(input.scheduleTimes)].sort();
    const medication: Medication = {
      id: newId('med'),
      elderId: ctx.elder.id,
      name,
      genericName: normalizeDrugName(name),
      dose: input.dose.trim(),
      scheduleTimes,
      critical: input.critical ?? false,
      maxDailyDoses: input.maxDailyDoses ?? scheduleTimes.length,
      minIntervalMin: input.minIntervalMin ?? 240,
      graceMin: input.graceMin ?? 90,
      active: true,
      addedAt: now.toISOString(),
    };
    if (input.form) medication.form = input.form;
    if (input.purpose) medication.purpose = input.purpose;
    if (input.instructions) medication.instructions = input.instructions;
    if (input.addedBy) medication.addedBy = input.addedBy;

    const worst = warnings[0];
    const alert = this.store.mutate((s) => {
      s.medications.push(medication);
      if (!worst) return null;
      return createAlert(
        s,
        {
          elderId: ctx.elder.id,
          type: 'interaction',
          severity: worst.severity === 'major' ? 'warning' : 'info',
          title:
            warnings.length === 1
              ? `${name} + ${worst.withName} (${worst.severity})`
              : `${name}: ${warnings.length} interaction warnings (${worst.severity} with ${worst.withName})`,
          detail: `${warnings.map((w) => `${w.withName} — ${w.severity}: ${w.summary} ${w.advice}`).join(' ')} ${worst.disclaimer}`,
          refId: medication.id,
          notified: worst.severity === 'major' ? this.priorityIds(ctx, false) : [],
        },
        now
      ).alert;
    });
    if (alert) simulateNotify(alert, ctx.caregivers, this.log);

    const parts = [`Added ${name} ${medication.dose} at ${joinSpoken(scheduleTimes.map(spokenClockTime))}.`];
    if (worst) {
      parts.push(
        `Heads-up, informational only: it's listed as a ${worst.severity} ${worst.kind === 'allergy' ? 'allergy concern' : 'interaction'} with ${worst.withName} — ${worst.summary} ${worst.advice}`
      );
      if (warnings.length > 1)
        parts.push(
          `There ${warnings.length - 1 === 1 ? 'is 1 more warning' : `are ${warnings.length - 1} more warnings`} on the dashboard.`
        );
      parts.push(worst.disclaimer);
    }
    return {
      medication: { id: medication.id, name, dose: medication.dose, scheduleTimes },
      warnings,
      alertId: alert?.id ?? null,
      spoken: parts.join(' '),
    };
  }

  caregiverSummary(elderId?: string, days: 7 | 30 = 7): CaregiverSummaryResult {
    const ctx = this.context(elderId);
    this.sweep(ctx);
    const state = this.store.get();
    const now = this.store.now();
    const adherence = computeAdherence(state, ctx.elder.id, days, now, ctx.tz);
    const slots = slotsForDay(state, ctx.elder.id, ctx.today, ctx.tz);
    const todaysDoses = slots.map((s) => doseView(s));
    const next = nextUpcomingSlot(slots, now);
    const checkIns = state.checkIns.filter((c) => c.elderId === ctx.elder.id).sort((a, b) => a.at.localeCompare(b.at));
    const latest = checkIns.at(-1) ?? null;
    const open = openAlerts(state, ctx.elder.id).map((a) => alertView(a, ctx));
    const resolved = state.alerts
      .filter((a) => a.elderId === ctx.elder.id && a.resolvedAt)
      .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))
      .slice(0, 5)
      .map((a) => alertView(a, ctx));
    const medications = state.medications
      .filter((m) => m.elderId === ctx.elder.id)
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      .map((m) => {
        const bucket = adherence.perMedication.find((p) => p.medicationId === m.id);
        const counts: AdherenceCounts = bucket
          ? {
              due: bucket.due,
              taken: bucket.taken,
              late: bucket.late,
              missed: bucket.missed,
              skipped: bucket.skipped,
              rate: bucket.rate,
            }
          : { due: 0, taken: 0, late: 0, missed: 0, skipped: 0, rate: null };
        const view = {
          id: m.id,
          name: m.name,
          dose: m.dose,
          scheduleTimes: m.scheduleTimes,
          critical: m.critical,
          active: m.active,
          adherence: counts,
        } as DashboardData['medications'][number];
        if (m.purpose) view.purpose = m.purpose;
        return view;
      });

    const data: DashboardData = {
      generatedAt: now.toISOString(),
      today: ctx.today,
      localTime: toClockTime(now, ctx.tz),
      elder: {
        id: ctx.elder.id,
        name: ctx.elder.name,
        preferredName: ctx.elder.prefs.preferredName,
        age: ctx.elder.age,
        conditions: ctx.elder.conditions,
        allergies: ctx.elder.allergies,
      },
      household: { timezone: ctx.tz, emergencyNumber: ctx.household.emergencyNumber },
      caregivers: ctx.caregivers.map((c) => ({
        id: c.id,
        name: c.name,
        relationship: c.relationship,
        priority: c.escalationPriority,
      })),
      adherence: {
        days,
        due: adherence.due,
        taken: adherence.taken,
        late: adherence.late,
        missed: adherence.missed,
        skipped: adherence.skipped,
        rate: adherence.rate,
        perDay: adherence.perDay.map((d) => ({
          localDate: d.localDate,
          due: d.due,
          taken: d.taken,
          late: d.late,
          missed: d.missed,
          skipped: d.skipped,
          rate: d.rate,
        })),
      },
      medications,
      todaysDoses,
      nextUp: next ? doseView(next) : null,
      checkedInToday: checkIns.some((c) => c.localDate === ctx.today),
      latestCheckIn: latest ? checkInView(latest) : null,
      checkInTrend: checkIns.slice(-7).map(checkInView),
      openAlerts: open,
      recentlyResolved: resolved,
      upcomingAppointments: upcomingAppointments(state, ctx, 30),
    };

    // Spoken summary: adherence → open alerts → next appointment.
    const name = ctx.elder.prefs.preferredName;
    const parts: string[] = [];
    if (adherence.rate === null) parts.push(`${name} has had no doses due in the last ${days} days.`);
    else {
      const missedNames = [...new Set(adherence.perMedication.filter((p) => p.missed > 0).map((p) => p.name))];
      let sentence = `${name}'s ${days}-day adherence is ${Math.round(adherence.rate * 100)} percent`;
      if (adherence.missed === 0) sentence += ' with no missed doses.';
      else if (missedNames.length === 1)
        sentence += ` — ${adherence.missed} missed ${adherence.missed === 1 ? 'dose' : 'doses'}, ${adherence.missed === 1 ? '' : 'all '}${missedNames[0]}.`;
      else sentence += ` — ${adherence.missed} missed doses across ${joinSpoken(missedNames)}.`;
      parts.push(sentence);
    }
    if (open.length > 0) {
      const top = open[0]!;
      parts.push(
        open.length === 1
          ? `One alert is open: ${lowerFirst(top.title)}, ${top.createdWhen}.`
          : `${open.length} alerts are open; the most urgent is ${lowerFirst(top.title)}, ${top.createdWhen}.`
      );
    } else parts.push('No alerts are open.');
    if (latest && latest.localDate === ctx.today) parts.push(`Today ${name} said she feels ${latest.mood}.`);
    else if (!data.checkedInToday) parts.push(`${name} hasn't checked in yet today.`);
    const nextAppt = data.upcomingAppointments[0];
    if (nextAppt) parts.push(`Next up: ${nextAppt.title} ${nextAppt.when}.`);

    return { ...data, spoken: parts.join(' ') };
  }

  resolveAlert(input: {
    alertId: string;
    caregiverId: string;
    action: 'acknowledge' | 'resolve';
    resolution?: string;
  }): ResolveAlertResult {
    const state = this.store.get();
    const target = state.alerts.find((a) => a.id === input.alertId);
    if (!target) throw new DomainError(`Alert ${input.alertId} not found.`, 'alert_not_found');
    const caregiver = state.caregivers.find((c) => c.id === input.caregiverId);
    if (!caregiver) throw new DomainError(`Caregiver ${input.caregiverId} not found.`, 'caregiver_not_found');
    const now = this.store.now();
    const before = JSON.stringify(target);
    const alert = this.store.mutate((s) => {
      const a = s.alerts.find((x) => x.id === input.alertId)!;
      return input.action === 'resolve'
        ? resolveAlert(a, caregiver.id, now, input.resolution)
        : acknowledgeAlert(a, caregiver.id, now);
    });
    const changed = JSON.stringify(alert) !== before;
    const by = (id: string | undefined) => (id ? (state.caregivers.find((c) => c.id === id)?.name ?? id) : null);
    const spoken = changed
      ? input.action === 'resolve'
        ? `Resolved: ${lowerFirst(alert.title)}${input.resolution ? ` — ${input.resolution}` : ''}.`
        : `Acknowledged: ${lowerFirst(alert.title)}.`
      : `That alert was already ${alert.resolvedAt ? 'resolved' : 'acknowledged'}${alert.resolvedBy ? ` by ${by(alert.resolvedBy)}` : alert.acknowledgedBy ? ` by ${by(alert.acknowledgedBy)}` : ''}.`;
    return {
      alert: {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        acknowledgedBy: by(alert.acknowledgedBy),
        resolvedBy: by(alert.resolvedBy),
        resolution: alert.resolution ?? null,
      },
      changed,
      spoken,
    };
  }

  listElders(): Array<{ id: string; name: string }> {
    return this.store.get().elders.map((e) => ({ id: e.id, name: e.name }));
  }

  /** The `carecompanion://elder/{elderId}/adherence` resource: 7- and 30-day windows side by side. */
  adherenceReport(elderId?: string): {
    elder: { id: string; name: string };
    generatedAt: string;
    today: string;
    windows: Record<'7' | '30', ReturnType<typeof computeAdherence>>;
  } {
    const ctx = this.context(elderId);
    this.sweep(ctx);
    const state = this.store.get();
    const now = this.store.now();
    return {
      elder: { id: ctx.elder.id, name: ctx.elder.name },
      generatedAt: now.toISOString(),
      today: ctx.today,
      windows: {
        '7': computeAdherence(state, ctx.elder.id, 7, now, ctx.tz),
        '30': computeAdherence(state, ctx.elder.id, 30, now, ctx.tz),
      },
    };
  }

  // --- demo controls -------------------------------------------------------------------------------

  reset(scenario: SeedScenario = 'default', tz?: string): { scenario: SeedScenario; seededAt: string } {
    const current = this.store.get();
    const timezone = tz ?? current.households[0]?.timezone ?? 'America/Los_Angeles';
    const now = this.store.now();
    this.store.replace(buildSeedState({ now, tz: timezone, scenario }));
    this.log.info('state reset', { scenario, tz: timezone });
    return { scenario, seededAt: now.toISOString() };
  }
}

// --- views ---------------------------------------------------------------------------------------

function doseView(slot: DoseSlot): DashboardDose {
  const view: DashboardDose = {
    medicationId: slot.medication.id,
    name: slot.medication.name,
    dose: slot.medication.dose,
    scheduledTime: slot.scheduledTime,
    scheduledAt: slot.scheduledAt.toISOString(),
    spokenTime: spokenClockTime(slot.scheduledTime),
    status: slot.status,
    recordedAt: slot.event?.recordedAt ?? null,
    critical: slot.medication.critical,
  };
  if (slot.medication.instructions) view.instructions = slot.medication.instructions;
  return view;
}

function alertView(alert: Alert, ctx: ElderContext): DashboardAlert {
  const name = (id: string | undefined) => (id ? (ctx.caregivers.find((c) => c.id === id)?.name ?? id) : null);
  return {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    title: alert.title,
    detail: alert.detail,
    createdAt: alert.createdAt,
    createdWhen: spokenDateTime(alert.createdAt, ctx.tz, ctx.today),
    acknowledgedBy: name(alert.acknowledgedBy),
    resolvedBy: name(alert.resolvedBy),
    resolution: alert.resolution ?? null,
    notified: alert.notified.map((id) => name(id) ?? id),
  };
}

function checkInView(c: CheckIn): DashboardCheckIn {
  return {
    localDate: c.localDate,
    at: c.at,
    mood: c.mood,
    symptoms: c.symptoms,
    severity: c.severity,
    flagged: c.flagged,
  };
}

function upcomingAppointments(state: Readonly<State>, ctx: ElderContext, horizonDays: number): DashboardAppointment[] {
  const now = ctx.today;
  const horizon = addDays(now, horizonDays);
  return state.appointments
    .filter((a) => a.elderId === ctx.elder.id)
    .filter((a) => {
      const day = toLocalDate(a.at, ctx.tz);
      return day >= now && day <= horizon;
    })
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((a) => {
      const view: DashboardAppointment = {
        id: a.id,
        title: a.title,
        at: a.at,
        when: `${spokenDay(toLocalDate(a.at, ctx.tz), ctx.today, ctx.tz)} ${spokenTime(a.at, ctx.tz)}`,
      };
      if (a.location) view.location = a.location;
      return view;
    });
}

// --- speech helpers ------------------------------------------------------------------------------

function greeting(now: Date, tz: string): string {
  const hour = wallClock(now, tz).hour;
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function joinSpoken(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}
