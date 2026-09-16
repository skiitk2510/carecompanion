/**
 * Zod (v4) input/output schemas for the MCP tools. Descriptions are exported into the JSON Schema the host
 * model sees, so they are written for an LLM deciding how to call the tool.
 */
import * as z from 'zod/v4';

export const ElderId = z.string().min(1).optional().describe('Elder id. Omit for the household elder.');

export const ClockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, 24-hour, household local time')
  .describe('HH:mm in the household timezone, e.g. "08:00" or "18:30"');

export const MedicationRef = z.object({
  id: z.string(),
  name: z.string(),
  dose: z.string(),
});

export const DoseView = z.object({
  medicationId: z.string(),
  name: z.string(),
  dose: z.string(),
  scheduledTime: z.string(),
  scheduledAt: z.string().describe('UTC instant of the slot'),
  spokenTime: z.string(),
  status: z.enum(['scheduled', 'taken', 'late', 'missed', 'skipped']),
  recordedAt: z.string().nullable(),
  critical: z.boolean(),
  instructions: z.string().optional(),
});

export const AppointmentView = z.object({
  id: z.string(),
  title: z.string(),
  at: z.string(),
  when: z.string().describe('Spoken relative time, e.g. "tomorrow 2 p.m."'),
  location: z.string().optional(),
});

// --- get_todays_plan ---------------------------------------------------------------------------
export const GetTodaysPlanInput = z.object({ elderId: ElderId });
export const GetTodaysPlanOutput = z.object({
  today: z.string(),
  localTime: z.string(),
  elderName: z.string(),
  doses: z.array(DoseView),
  nextUp: DoseView.nullable(),
  appointments: z.array(AppointmentView),
  checkedInToday: z.boolean(),
  openAlertsCount: z.number().int(),
});

// --- log_dose ----------------------------------------------------------------------------------
export const LogDoseInput = z.object({
  elderId: ElderId,
  medication: z
    .string()
    .min(1)
    .describe('The medication as the elder said it: "lisinopril", "my blood pressure pill", "Coumadin"'),
  takenAt: z.iso.datetime({ offset: true }).optional().describe('When it was taken (ISO 8601). Defaults to now.'),
  confirmOverride: z
    .boolean()
    .optional()
    .describe('Set true ONLY after the elder explicitly confirmed recording a dose the guard refused.'),
  overrideReason: z
    .string()
    .optional()
    .describe("The elder's own words for why the extra dose is needed. Required together with confirmOverride."),
});
export const LogDoseOutput = z.object({
  recorded: z.boolean(),
  verdict: z.enum(['allow', 'refuse', 'allow_override', 'ambiguous', 'not_found']),
  status: z.enum(['taken', 'late']).nullable(),
  medication: MedicationRef.nullable(),
  requiresConfirmation: z
    .boolean()
    .describe(
      'true = do NOT retry silently; ask the elder to confirm and give a reason, then call again with confirmOverride.'
    ),
  reason: z.enum(['inactive', 'max_daily', 'min_interval']).nullable(),
  lastTakenAt: z.string().nullable(),
  nextAllowedAt: z.string().nullable(),
  candidates: z.array(z.string()).optional().describe('Present when the medication name was ambiguous.'),
  alertId: z.string().nullable(),
});

// --- skip_dose ---------------------------------------------------------------------------------
export const SkipDoseInput = z.object({
  elderId: ElderId,
  medication: z.string().min(1),
  reason: z.string().optional(),
});
export const SkipDoseOutput = z.object({
  recorded: z.boolean(),
  verdict: z.enum(['skipped', 'ambiguous', 'not_found', 'nothing_due']),
  medication: MedicationRef.nullable(),
  scheduledTime: z.string().nullable(),
  alertId: z.string().nullable(),
  candidates: z.array(z.string()).optional(),
});

// --- daily_checkin -----------------------------------------------------------------------------
export const DailyCheckinInput = z.object({
  elderId: ElderId,
  mood: z.string().min(1).describe('How the elder says they feel: "good", "okay", "not great", "awful"'),
  symptoms: z.array(z.string()).optional().describe('Anything they mention, verbatim: ["a bit dizzy", "slept badly"]'),
  notes: z.string().optional(),
});
export const DailyCheckinOutput = z.object({
  checkInId: z.string(),
  severity: z.enum(['none', 'watch', 'urgent', 'emergency']),
  flagged: z.boolean(),
  alertIds: z.array(z.string()),
  notified: z.array(z.string()).describe('Caregiver names notified (simulated).'),
  emergencyGuidance: z
    .string()
    .optional()
    .describe('When present, say this to the elder FIRST and verbatim before anything else.'),
});

// --- call_for_help -----------------------------------------------------------------------------
export const CallForHelpInput = z.object({
  elderId: ElderId,
  message: z.string().optional().describe("The elder's words, if any."),
});
export const CallForHelpOutput = z.object({
  alertId: z.string(),
  notified: z.array(z.string()),
  emergencyGuidance: z.string(),
});

// --- add_medication ----------------------------------------------------------------------------
export const AddMedicationInput = z.object({
  elderId: ElderId,
  name: z.string().min(1).describe('Brand or generic name, e.g. "Ibuprofen"'),
  dose: z.string().min(1).describe('e.g. "200 mg"'),
  form: z.string().optional().describe('tablet, capsule, liquid, …'),
  scheduleTimes: z.array(ClockTimeSchema).min(1),
  purpose: z.string().optional().describe('Plain-language purpose: "pain", "blood pressure"'),
  instructions: z.string().optional().describe('e.g. "with food"'),
  critical: z.boolean().optional().describe('Missing it should raise a critical alert. Default false.'),
  maxDailyDoses: z.number().int().min(1).optional().describe('Default: number of schedule times.'),
  minIntervalMin: z.number().int().min(0).optional().describe('Minimum minutes between doses. Default 240.'),
  graceMin: z.number().int().min(0).optional().describe('Minutes after a slot before it counts as missed. Default 90.'),
  addedBy: z.string().optional().describe('Caregiver id making the change.'),
});
export const InteractionWarningView = z.object({
  kind: z.enum(['interaction', 'allergy']),
  withName: z.string(),
  severity: z.enum(['minor', 'moderate', 'major']),
  summary: z.string(),
  advice: z.string(),
  disclaimer: z.string(),
});
export const AddMedicationOutput = z.object({
  medication: MedicationRef.extend({ scheduleTimes: z.array(z.string()) }),
  warnings: z.array(InteractionWarningView),
  alertId: z.string().nullable(),
});

// --- caregiver_summary (the MCP App tool) ----------------------------------------------------------
export const CaregiverSummaryInput = z.object({
  elderId: ElderId,
  days: z
    .union([z.literal(7), z.literal(30)])
    .optional()
    .describe('Adherence window. Default 7.'),
});
/** The full payload is `DashboardData` (src/shared/dashboard.ts); only the headline fields are pinned here. */
export const CaregiverSummaryOutput = z.looseObject({
  generatedAt: z.string(),
  today: z.string(),
  checkedInToday: z.boolean(),
  openAlerts: z.array(z.looseObject({ id: z.string(), severity: z.string(), title: z.string() })),
});

// --- resolve_alert -----------------------------------------------------------------------------
export const ResolveAlertInput = z.object({
  alertId: z.string().min(1),
  caregiverId: z.string().min(1),
  action: z.enum(['acknowledge', 'resolve']),
  resolution: z.string().optional().describe('What was done, for the audit trail.'),
});
export const ResolveAlertOutput = z.object({
  alert: z.object({
    id: z.string(),
    type: z.string(),
    severity: z.string(),
    title: z.string(),
    acknowledgedBy: z.string().nullable(),
    resolvedBy: z.string().nullable(),
    resolution: z.string().nullable(),
  }),
  changed: z.boolean(),
});
