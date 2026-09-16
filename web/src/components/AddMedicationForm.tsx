/**
 * "Add medication" disclosure above the caregiver dashboard. Posts to /api/dashboard/medications and renders the
 * interaction / allergy warnings the server returns, severity-coloured, with the disclaimer.
 */
import { useId, useMemo, useState, type FormEvent } from 'react';
import { addMedication, describeError, type AddMedicationResponse, type WarningSeverity } from '../lib/api';
import { ChevronIcon } from './icons';

interface AddMedicationFormProps {
  /** The caregiver making the change (recorded as `addedBy`). */
  caregiverId: string;
  onAdded(result: AddMedicationResponse): void;
}

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

interface TimeToken {
  raw: string;
  /** Normalised HH:mm, or null when the token is not a valid time. */
  value: string | null;
}

/** "8:00, 20:00" → [{ raw: '8:00', value: '08:00' }, …]; tokens that are not HH:mm keep `value: null`. */
function parseTimes(text: string): TimeToken[] {
  return text
    .split(/[,\s;]+/)
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const padded = /^\d:\d\d$/.test(raw) ? `0${raw}` : raw;
      return { raw, value: CLOCK_TIME.test(padded) ? padded : null };
    });
}

const SEVERITY_STYLE: Record<WarningSeverity, { card: string; badge: string }> = {
  major: { card: 'border-rose-300 bg-rose-50 text-rose-950', badge: 'bg-rose-600 text-white' },
  moderate: { card: 'border-amber-300 bg-amber-50 text-amber-950', badge: 'bg-amber-500 text-white' },
  minor: { card: 'border-sky-300 bg-sky-50 text-sky-950', badge: 'bg-sky-600 text-white' },
};

const DEMO_EXAMPLE = { name: 'Ibuprofen', dose: '200 mg', times: '08:00, 20:00', purpose: 'knee pain' };

function WarningsResult({ result }: { result: AddMedicationResponse }) {
  const { medication, warnings, alertId } = result;
  const disclaimer = warnings[0]?.disclaimer;
  return (
    <section aria-live="polite" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h4 className="text-base font-semibold text-slate-900">
          Added {medication.name} {medication.dose} at {medication.scheduleTimes.join(', ')}
        </h4>
        <p className="mt-1 text-sm text-slate-600">
          <span className="font-medium text-slate-700">Alexa would say:</span> {result.spoken}
        </p>
      </div>
      {warnings.length === 0 ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          No interaction or allergy warnings against the current medication list.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Interaction and allergy warnings">
          {warnings.map((warning, index) => {
            const style = SEVERITY_STYLE[warning.severity];
            return (
              <li key={`${warning.withName}-${index}`} className={`rounded-lg border-2 px-3 py-2.5 ${style.card}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-px text-[11px] font-bold uppercase tracking-wide ${style.badge}`}>
                    {warning.severity}
                  </span>
                  <span className="font-semibold">
                    {warning.kind === 'allergy' ? 'Allergy concern' : 'Interaction'} with {warning.withName}
                  </span>
                </div>
                <p className="mt-1 text-sm">{warning.summary}</p>
                <p className="mt-0.5 text-sm font-medium">{warning.advice}</p>
              </li>
            );
          })}
        </ul>
      )}
      {alertId && (
        <p className="text-sm text-slate-600">
          A caregiver alert (<code className="font-mono text-xs">{alertId}</code>) was raised so the family can follow
          up.
        </p>
      )}
      {disclaimer && <p className="text-xs italic text-slate-500">{disclaimer}</p>}
    </section>
  );
}

export function AddMedicationForm({ caregiverId, onAdded }: AddMedicationFormProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [timesText, setTimesText] = useState('');
  const [purpose, setPurpose] = useState('');
  const [critical, setCritical] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddMedicationResponse | null>(null);

  const tokens = useMemo(() => parseTimes(timesText), [timesText]);
  const validTimes = useMemo(() => [...new Set(tokens.flatMap((t) => (t.value ? [t.value] : [])))], [tokens]);
  const hasInvalidTime = tokens.some((t) => t.value === null);
  const canSubmit =
    !submitting && name.trim().length > 0 && dose.trim().length > 0 && validTimes.length > 0 && !hasInvalidTime;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await addMedication({
        name: name.trim(),
        dose: dose.trim(),
        scheduleTimes: validTimes,
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
        critical,
        addedBy: caregiverId,
      });
      setResult(response);
      setName('');
      setDose('');
      setTimesText('');
      setPurpose('');
      setCritical(false);
      onAdded(response);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const fillExample = () => {
    setName(DEMO_EXAMPLE.name);
    setDose(DEMO_EXAMPLE.dose);
    setTimesText(DEMO_EXAMPLE.times);
    setPurpose(DEMO_EXAMPLE.purpose);
    setCritical(false);
    setError(null);
  };

  const field =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        <span>
          <span className="block text-base font-semibold text-slate-900">Add medication</span>
          <span className="block text-xs text-slate-500">
            Runs the interaction and allergy cross-check before it lands on the plan
          </span>
        </span>
        <ChevronIcon className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id={panelId} className="space-y-4 border-t border-slate-200 px-4 py-4">
          <form onSubmit={submit} className="space-y-3" aria-busy={submitting}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ibuprofen"
                  required
                  autoComplete="off"
                  className={field}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Dose</span>
                <input
                  value={dose}
                  onChange={(event) => setDose(event.target.value)}
                  placeholder="200 mg"
                  required
                  autoComplete="off"
                  className={field}
                />
              </label>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Schedule times (HH:mm, comma-separated)</span>
              <input
                value={timesText}
                onChange={(event) => setTimesText(event.target.value)}
                placeholder="08:00, 20:00"
                required
                autoComplete="off"
                aria-describedby={`${panelId}-times`}
                className={field}
              />
            </label>
            <div id={`${panelId}-times`} className="flex min-h-[1.75rem] flex-wrap items-center gap-1.5">
              {tokens.length === 0 ? (
                <span className="text-xs text-slate-500">Household local time, 24-hour clock.</span>
              ) : (
                tokens.map((token, index) =>
                  token.value ? (
                    <span
                      key={`${token.raw}-${index}`}
                      className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium tabular-nums text-indigo-800"
                    >
                      {token.value}
                    </span>
                  ) : (
                    <span
                      key={`${token.raw}-${index}`}
                      className="rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-800"
                      title="Not a valid HH:mm time"
                    >
                      {token.raw} — not HH:mm
                    </span>
                  )
                )
              )}
            </div>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Purpose (optional)</span>
              <input
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                placeholder="knee pain"
                autoComplete="off"
                className={field}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={critical}
                onChange={(event) => setCritical(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
              />
              Critical — a missed dose raises a critical alert
            </label>

            {error && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Checking…' : 'Add medication'}
              </button>
              <button
                type="button"
                onClick={fillExample}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              >
                Fill demo example (Ibuprofen — interacts with Warfarin)
              </button>
            </div>
          </form>

          {result && <WarningsResult result={result} />}
        </div>
      )}
    </div>
  );
}
