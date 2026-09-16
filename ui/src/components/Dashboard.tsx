/**
 * The shared caregiver dashboard — one component, two hosts: the MCP App view (ui/, inside Alexa+ / Inspector,
 * `compact`) and the simulated Alexa+ web app (web/). It renders only what it is given through `DashboardProps`
 * (see types.ts) and never talks to a network or runs timers of its own; the parent polls and passes fresh data.
 */
import './dashboard.css';
import type { DashboardProps } from './types';
import { longLocalDate, spokenClockTime } from './format';
import { ActionButton, cx } from './Primitives';
import { useAsyncAction } from './useAsyncAction';
import { CaregiverPicker } from './CaregiverPicker';
import { StatTiles } from './StatTiles';
import { AdherenceStrip } from './AdherenceStrip';
import { DoseTimeline } from './DoseTimeline';
import { AlertList } from './AlertList';
import { CheckInTrend } from './CheckInTrend';
import { Appointments } from './Appointments';
import { MedicationList } from './MedicationList';
import { Footer } from './Footer';

export type { DashboardActions, DashboardProps, MarkTakenOutcome } from './types';

export function Dashboard(props: DashboardProps) {
  const { data, loading, error, caregiverId, onCaregiverChange, actions, compact = false, lastUpdated = null } = props;
  const rootClass = cx('cc-dashboard', compact && 'cc-dashboard--compact');

  if (!data) {
    return (
      <div className={rootClass}>
        {error && <ErrorBanner message={error} retry={actions.refresh} />}
        {loading ? <LoadingBlock /> : !error && <p className="cc-empty">No dashboard data yet.</p>}
      </div>
    );
  }

  const actor = data.caregivers.find((c) => c.id === caregiverId);

  return (
    <div className={rootClass}>
      {error && <ErrorBanner message={error} retry={actions.refresh} stale />}

      <header className="cc-header">
        <div className="cc-header__text">
          <h2 className="cc-title">{data.elder.preferredName}'s week</h2>
          <p className="cc-subtitle">
            {longLocalDate(data.today)} · <span title={data.household.timezone}>{spokenClockTime(data.localTime)}</span>{' '}
            household time
          </p>
        </div>
        <CaregiverPicker caregivers={data.caregivers} selectedId={caregiverId} onChange={onCaregiverChange} />
      </header>

      <StatTiles data={data} />
      <AdherenceStrip adherence={data.adherence} today={data.today} />

      <div className="cc-columns">
        <div className="cc-col">
          <DoseTimeline doses={data.todaysDoses} nextUp={data.nextUp} markTaken={actions.markTaken} />
          <AlertList
            open={data.openAlerts}
            resolved={data.recentlyResolved}
            resolveAlert={actions.resolveAlert}
            actorName={actor?.name}
          />
        </div>
        <div className="cc-col">
          <CheckInTrend
            trend={data.checkInTrend}
            latest={data.latestCheckIn}
            checkedInToday={data.checkedInToday}
            today={data.today}
            timeZone={data.household.timezone}
          />
          <Appointments appointments={data.upcomingAppointments} />
          <MedicationList medications={data.medications} days={data.adherence.days} />
        </div>
      </div>

      <Footer lastUpdated={lastUpdated} refresh={actions.refresh} />
    </div>
  );
}

function ErrorBanner({ message, retry, stale = false }: { message: string; retry(): Promise<void>; stale?: boolean }) {
  const { busy, run } = useAsyncAction();
  return (
    <div className="cc-banner cc-banner--danger" role="alert">
      <p className="cc-banner__text">
        <strong>Could not update the dashboard.</strong> {message}
        {stale && ' Showing the last data received.'}
      </p>
      <ActionButton aria-label="Retry loading the dashboard" busy={busy} onClick={() => void run(retry)}>
        Retry
      </ActionButton>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="cc-loading" role="status" aria-live="polite">
      <p className="cc-loading__text">Loading the dashboard…</p>
      <div className="cc-skeleton" aria-hidden="true">
        <span className="cc-skeleton__bar cc-skeleton__bar--title" />
        <span className="cc-skeleton__tiles">
          <span />
          <span />
          <span />
        </span>
        <span className="cc-skeleton__bar cc-skeleton__bar--tall" />
        <span className="cc-skeleton__bar" />
        <span className="cc-skeleton__bar" />
      </div>
    </div>
  );
}
