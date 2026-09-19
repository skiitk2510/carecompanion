/**
 * The dose-guard screen, rendered when a host shows a `log_dose` result. Four outcomes, one screen:
 * recorded (green), refused with confirmation (the guardrail: reason required), ambiguous (pick one), not found.
 */
import { useState } from 'react';
import { ActionButton, InlineError, Notice } from '../Primitives';
import { useAsyncAction } from '../useAsyncAction';
import type { LogDoseData } from './types';

const MIN_REASON_LENGTH = 3;

export interface LogDoseCall {
  (medication: string, override?: { confirm: true; reason: string }): Promise<{ data: LogDoseData; spoken: string }>;
}

interface Props {
  data: LogDoseData;
  /** The tool's spoken sentence (the guard's own words). */
  spoken: string | null;
  /** Calls log_dose through the host and returns the full structured result. */
  logDose: LogDoseCall;
  /** The screen re-renders with whatever the follow-up call returned. */
  onResult: (data: LogDoseData, spoken: string) => void;
  /** Called after a successful record so the host view can move on (e.g. show today's plan). */
  onRecorded: () => Promise<void>;
}

export function DoseGuardScreen({ data, spoken, logDose, onResult, onRecorded }: Props) {
  const { busy, error, run } = useAsyncAction();
  const [reason, setReason] = useState('');
  const reasonOk = reason.trim().length >= MIN_REASON_LENGTH;
  const name = data.medication?.name ?? 'that medication';

  const call = async (medication: string, override?: { confirm: true; reason: string }) => {
    const result = await run(() => logDose(medication, override));
    if (!result) return;
    onResult(result.data, result.spoken);
    if (result.data.recorded) await onRecorded();
  };

  if (data.recorded) {
    return (
      <div className="cc-elder cc-elder--ok">
        <p className="cc-elder__big">
          {data.medication ? `${data.medication.name} ${data.medication.dose}` : 'Dose'} recorded
          {data.status === 'late' ? ' (late)' : ''}.
        </p>
        {spoken && <p className="cc-elder__spoken">{spoken}</p>}
        {data.verdict === 'allow_override' && (
          <Notice tone="warning">Recorded as an extra dose. Your caregiver has been told, with your reason.</Notice>
        )}
      </div>
    );
  }

  if (data.verdict === 'ambiguous') {
    return (
      <div className="cc-elder">
        <p className="cc-elder__big">Which one did you take?</p>
        <div className="cc-elder__choices" role="group" aria-label="Choose the medication">
          {(data.candidates ?? []).map((c) => (
            <ActionButton key={c} aria-label={`I took ${c}`} variant="primary" busy={busy} onClick={() => void call(c)}>
              {c}
            </ActionButton>
          ))}
        </div>
        {error && <InlineError message={error} />}
      </div>
    );
  }

  if (data.verdict === 'not_found') {
    return (
      <div className="cc-elder">
        <p className="cc-elder__big">I couldn&rsquo;t find that medication.</p>
        {spoken && <p className="cc-elder__spoken">{spoken}</p>}
      </div>
    );
  }

  // Refused by the guard.
  return (
    <div className="cc-elder cc-elder--guard" role="alert">
      <p className="cc-elder__kicker">Safety check</p>
      <p className="cc-elder__big">
        {data.reason === 'inactive' ? `${name} isn't on your active list.` : `You already took ${name} today.`}
      </p>
      {spoken && <p className="cc-elder__spoken">{spoken}</p>}
      {data.requiresConfirmation && (
        <form
          className="cc-confirm"
          aria-label={`Confirm recording ${name} anyway`}
          onSubmit={(event) => {
            event.preventDefault();
            if (reasonOk && data.medication) void call(data.medication.name, { confirm: true, reason: reason.trim() });
          }}
        >
          <label className="cc-field">
            <span className="cc-field__label">Only if you&rsquo;re sure: why record it anyway?</span>
            <input
              className="cc-input"
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: the doctor told me to"
              maxLength={200}
            />
          </label>
          <div className="cc-confirm__actions">
            <ActionButton
              type="submit"
              variant="danger"
              aria-label={`Record ${name} anyway`}
              busy={busy}
              disabled={!reasonOk || !data.medication}
            >
              Record anyway
            </ActionButton>
          </div>
          <p className="cc-elder__note">Your caregiver will be told about the extra dose.</p>
        </form>
      )}
      {error && <InlineError message={error} />}
    </div>
  );
}
