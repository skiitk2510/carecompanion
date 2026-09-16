import { clockOf } from './format';
import { ActionButton, InlineError } from './Primitives';
import { useAsyncAction } from './useAsyncAction';

interface Props {
  lastUpdated: string | null;
  refresh(): Promise<void>;
}

export function Footer({ lastUpdated, refresh }: Props) {
  const { busy, error, run } = useAsyncAction();
  const updated = lastUpdated ? clockOf(lastUpdated, undefined, true) : '';

  return (
    <footer className="cc-footer">
      <div className="cc-footer__row">
        <span className="cc-footer__updated">{updated ? `Updated ${updated}` : 'Not updated yet'}</span>
        <ActionButton aria-label="Refresh the dashboard" busy={busy} onClick={() => void run(refresh)}>
          Refresh
        </ActionButton>
      </div>
      {error && <InlineError message={error} />}
      <p className="cc-footer__disclaimer">
        CareCompanion coordinates reminders and alerts; it is not medical advice. Demo data, not real patients.
      </p>
    </footer>
  );
}
