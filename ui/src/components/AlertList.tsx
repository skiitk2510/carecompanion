import { useState } from 'react';
import type { DashboardAlert } from '@shared/dashboard';
import type { DashboardActions } from './types';
import { joinNames, truncate } from './format';
import { ActionButton, alertTone, cx, InlineError, Section, SeverityDot } from './Primitives';
import { useAsyncAction } from './useAsyncAction';

/** Details longer than this collapse behind "Show more". */
const DETAIL_LIMIT = 160;

interface Props {
  open: DashboardAlert[];
  resolved: DashboardAlert[];
  resolveAlert: DashboardActions['resolveAlert'];
  /** Name of the acting caregiver, for the optimistic "Acknowledged by" line before the next refresh. */
  actorName?: string;
}

/** Open alerts (as ordered by the server) with Acknowledge / Resolve, plus the recently resolved audit trail. */
export function AlertList({ open, resolved, resolveAlert, actorName }: Props) {
  return (
    <Section title="Open alerts" meta={open.length > 0 ? String(open.length) : undefined}>
      {open.length === 0 ? (
        <p className="cc-muted">No open alerts.</p>
      ) : (
        <ul className="cc-alerts">
          {open.map((alert) => (
            <AlertItem key={alert.id} alert={alert} resolveAlert={resolveAlert} actorName={actorName} />
          ))}
        </ul>
      )}
      {resolved.length > 0 && (
        <details className="cc-details">
          <summary className="cc-details__summary">Recently resolved ({resolved.length})</summary>
          <ul className="cc-resolved">
            {resolved.map((alert) => (
              <li key={alert.id} className="cc-resolved__item">
                <div className="cc-resolved__head">
                  <SeverityDot tone={alertTone(alert.severity)} />
                  <span className="cc-resolved__title">{alert.title}</span>
                  <span className="cc-resolved__when">{alert.createdWhen}</span>
                </div>
                <p className="cc-resolved__meta">
                  Resolved by {alert.resolvedBy ?? 'unknown'}
                  {alert.resolution ? ` — ${alert.resolution}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

type AlertAction = 'acknowledge' | 'resolve';

function AlertItem({
  alert,
  resolveAlert,
  actorName,
}: {
  alert: DashboardAlert;
  resolveAlert: Props['resolveAlert'];
  actorName?: string;
}) {
  const { busy, error, run, clearError } = useAsyncAction();
  const [inFlight, setInFlight] = useState<AlertAction | null>(null);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState(false);
  /** What this caregiver just did, shown until the next poll brings the server's view. */
  const [local, setLocal] = useState<'acknowledged' | 'resolved' | null>(null);

  const tone = alertTone(alert.severity);
  const acknowledgedBy = alert.acknowledgedBy ?? (local !== null ? (actorName ?? 'you') : null);
  const isLong = alert.detail.length > DETAIL_LIMIT;
  const detail = isLong && !expanded ? truncate(alert.detail, DETAIL_LIMIT) : alert.detail;

  const act = async (action: AlertAction, resolution?: string) => {
    if (busy) return;
    setInFlight(action);
    const ok = await run(async () => {
      await resolveAlert(alert.id, action, resolution);
      return true;
    });
    setInFlight(null);
    if (ok) {
      setLocal(action === 'acknowledge' ? 'acknowledged' : 'resolved');
      setResolving(false);
      setNote('');
    }
  };

  const cancelResolve = () => {
    setResolving(false);
    setNote('');
    clearError();
  };

  return (
    <li className={cx('cc-alert', `cc-alert--${alert.severity}`, local === 'resolved' && 'cc-alert--done')}>
      <span className="cc-alert__stripe" aria-hidden="true" />
      <div className="cc-alert__body">
        <div className="cc-alert__head">
          <span className={`cc-alert__severity cc-tone--${tone}`}>
            <SeverityDot tone={tone} />
            {alert.severity}
          </span>
          <span className="cc-alert__when">{alert.createdWhen}</span>
        </div>
        <h4 className="cc-alert__title">{alert.title}</h4>
        <p className="cc-alert__detail">
          {detail}
          {isLong && (
            <>
              {' '}
              <button
                type="button"
                className="cc-linkbtn"
                aria-expanded={expanded}
                aria-label={expanded ? `Show less of: ${alert.title}` : `Show more of: ${alert.title}`}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            </>
          )}
        </p>
        <p className="cc-alert__meta">
          {alert.notified.length > 0 ? `Notified: ${joinNames(alert.notified)}` : 'No one notified'}
          {acknowledgedBy && ` · Acknowledged by ${acknowledgedBy}`}
        </p>

        {local === 'resolved' ? (
          <p className="cc-flash cc-flash--success cc-flash--sticky" role="status">
            Resolved — it will leave this list on the next refresh.
          </p>
        ) : (
          <>
            {!resolving && (
              <div className="cc-alert__actions">
                {!acknowledgedBy && (
                  <ActionButton
                    aria-label={`Acknowledge alert: ${alert.title}`}
                    busy={busy && inFlight === 'acknowledge'}
                    disabled={busy}
                    onClick={() => void act('acknowledge')}
                  >
                    Acknowledge
                  </ActionButton>
                )}
                <ActionButton
                  variant="primary"
                  aria-label={`Resolve alert: ${alert.title}`}
                  disabled={busy}
                  onClick={() => {
                    setResolving(true);
                    clearError();
                  }}
                >
                  Resolve
                </ActionButton>
              </div>
            )}
            {resolving && (
              <form
                className="cc-confirm"
                aria-label={`Resolve ${alert.title}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void act('resolve', note.trim() || undefined);
                }}
              >
                <label className="cc-field">
                  <span className="cc-field__label">Resolution note (optional)</span>
                  <input
                    className="cc-input"
                    type="text"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="What happened?"
                    maxLength={500}
                    autoFocus
                  />
                </label>
                <div className="cc-confirm__actions">
                  <ActionButton
                    type="submit"
                    variant="primary"
                    aria-label={`Confirm resolving: ${alert.title}`}
                    busy={busy && inFlight === 'resolve'}
                    disabled={busy}
                  >
                    Confirm
                  </ActionButton>
                  <ActionButton variant="ghost" aria-label="Cancel resolving" disabled={busy} onClick={cancelResolve}>
                    Cancel
                  </ActionButton>
                </div>
              </form>
            )}
            {local === 'acknowledged' && !alert.acknowledgedBy && (
              <p className="cc-flash cc-flash--success" role="status">
                Acknowledged.
              </p>
            )}
          </>
        )}
        {error && <InlineError message={error} />}
      </div>
    </li>
  );
}
