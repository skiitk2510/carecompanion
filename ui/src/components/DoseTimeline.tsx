import { useRef, useState } from 'react';
import type { DashboardDose } from '@shared/dashboard';
import type { DashboardActions, MarkTakenOutcome } from './types';
import { ActionButton, cx, DOSE_LABEL, doseTone, InlineError, Pill, Section, Tag } from './Primitives';
import { useAsyncAction } from './useAsyncAction';

/** Mirrors MIN_OVERRIDE_REASON_LENGTH in the server's dose guard: shorter reasons are re-prompted anyway. */
const MIN_REASON_LENGTH = 3;

interface Props {
  doses: DashboardDose[];
  nextUp: DashboardDose | null;
  markTaken: DashboardActions['markTaken'];
}

function sameSlot(a: DashboardDose, b: DashboardDose | null): boolean {
  return b !== null && a.medicationId === b.medicationId && a.scheduledTime === b.scheduledTime;
}

/** Today's virtual dose slots in time order, with "Mark taken" on the ones still open (or missed). */
export function DoseTimeline({ doses, nextUp, markTaken }: Props) {
  const ordered = [...doses].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.name.localeCompare(b.name));
  const done = ordered.filter((d) => d.status === 'taken' || d.status === 'late').length;

  return (
    <Section title="Today's doses" meta={ordered.length > 0 ? `${done} of ${ordered.length} done` : undefined}>
      {ordered.length === 0 ? (
        <p className="cc-muted">No doses scheduled today.</p>
      ) : (
        <ol className="cc-doses">
          {ordered.map((dose) => (
            <DoseRow
              key={`${dose.medicationId}@${dose.scheduledTime}`}
              dose={dose}
              isNext={sameSlot(dose, nextUp)}
              markTaken={markTaken}
            />
          ))}
        </ol>
      )}
    </Section>
  );
}

interface Flash {
  text: string;
  tone: 'success' | 'warning';
  key: number;
}

function DoseRow({ dose, isNext, markTaken }: { dose: DashboardDose; isNext: boolean; markTaken: Props['markTaken'] }) {
  const { busy, error, run, clearError } = useAsyncAction();
  const [pending, setPending] = useState<MarkTakenOutcome | null>(null);
  const [reason, setReason] = useState('');
  const [flash, setFlash] = useState<Flash | null>(null);
  const flashCount = useRef(0);

  const canMark = dose.status === 'scheduled' || dose.status === 'missed';
  const reasonOk = reason.trim().length >= MIN_REASON_LENGTH;

  const settle = (outcome: MarkTakenOutcome | undefined) => {
    if (!outcome) return; // the hook captured the error
    if (outcome.requiresConfirmation) {
      setPending(outcome);
      return;
    }
    setPending(null);
    setReason('');
    flashCount.current += 1;
    setFlash({ text: outcome.spoken, tone: outcome.recorded ? 'success' : 'warning', key: flashCount.current });
  };

  const onMark = async () => {
    setFlash(null);
    settle(await run(() => markTaken(dose.name)));
  };

  const onConfirm = async () => {
    if (!reasonOk || busy) return;
    setFlash(null);
    settle(await run(() => markTaken(dose.name, { confirm: true, reason: reason.trim() })));
  };

  const onCancel = () => {
    setPending(null);
    setReason('');
    clearError();
  };

  return (
    <li
      className={cx('cc-dose', `cc-dose--${dose.status}`, isNext && 'cc-dose--next')}
      aria-current={isNext ? 'step' : undefined}
    >
      <div className="cc-dose__row">
        <span className="cc-dose__time">{dose.spokenTime}</span>
        <div className="cc-dose__body">
          <span className="cc-dose__name">
            {dose.name} <span className="cc-dose__amount">{dose.dose}</span>
          </span>
          {(dose.critical || isNext) && (
            <span className="cc-dose__tags">
              {dose.critical && <Tag tone="danger">critical</Tag>}
              {isNext && <Tag tone="info">next up</Tag>}
            </span>
          )}
          {dose.instructions && <span className="cc-dose__note">{dose.instructions}</span>}
        </div>
        <Pill tone={doseTone(dose.status)}>{DOSE_LABEL[dose.status]}</Pill>
        {canMark && (
          <ActionButton
            className="cc-dose__action"
            aria-label={`Mark ${dose.name} (${dose.spokenTime}) taken`}
            busy={busy && pending === null}
            disabled={pending !== null}
            onClick={onMark}
          >
            Mark taken
          </ActionButton>
        )}
      </div>

      {pending && (
        <form
          className="cc-confirm"
          aria-label={`Confirm recording ${dose.name}`}
          onSubmit={(event) => {
            event.preventDefault();
            void onConfirm();
          }}
        >
          <p className="cc-confirm__text">{pending.spoken}</p>
          <label className="cc-field">
            <span className="cc-field__label">Reason (required)</span>
            <input
              className="cc-input"
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why record it anyway?"
              maxLength={200}
              autoFocus
            />
          </label>
          <div className="cc-confirm__actions">
            <ActionButton
              type="submit"
              variant="danger"
              aria-label={`Record ${dose.name} anyway`}
              busy={busy}
              disabled={!reasonOk}
            >
              Record anyway
            </ActionButton>
            <ActionButton variant="ghost" aria-label="Cancel recording" disabled={busy} onClick={onCancel}>
              Cancel
            </ActionButton>
          </div>
        </form>
      )}

      <div className="cc-live" aria-live="polite">
        {flash && (
          <p key={flash.key} className={cx('cc-flash', `cc-flash--${flash.tone}`)}>
            {flash.text}
          </p>
        )}
      </div>
      {error && <InlineError message={error} />}
    </li>
  );
}
