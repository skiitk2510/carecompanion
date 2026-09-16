import type { ReactNode } from 'react';
import type { DashboardAlert, DashboardData } from '@shared/dashboard';
import { percent } from './format';
import { alertTone, SeverityDot } from './Primitives';

const SEVERITY_RANK: Record<DashboardAlert['severity'], number> = { info: 0, warning: 1, critical: 2 };

export function mostSevere(alerts: readonly DashboardAlert[]): DashboardAlert['severity'] | null {
  let worst: DashboardAlert['severity'] | null = null;
  for (const alert of alerts) {
    if (worst === null || SEVERITY_RANK[alert.severity] > SEVERITY_RANK[worst]) worst = alert.severity;
  }
  return worst;
}

function Tile({ label, value, sub }: { label: string; value: string; sub: ReactNode }) {
  return (
    <li className="cc-tile">
      <span className="cc-tile__label">{label}</span>
      <span className="cc-tile__value">{value}</span>
      <span className="cc-tile__sub">{sub}</span>
    </li>
  );
}

/** The KPI row: adherence over the window, today's doses, open alerts. */
export function StatTiles({ data }: { data: DashboardData }) {
  const { adherence, todaysDoses, openAlerts } = data;

  const done = todaysDoses.filter((d) => d.status === 'taken' || d.status === 'late').length;
  const missed = todaysDoses.filter((d) => d.status === 'missed').length;
  const skipped = todaysDoses.filter((d) => d.status === 'skipped').length;
  const remaining = todaysDoses.filter((d) => d.status === 'scheduled').length;
  const dosesSub =
    todaysDoses.length === 0
      ? 'nothing scheduled'
      : [missed > 0 && `${missed} missed`, skipped > 0 && `${skipped} skipped`, remaining > 0 && `${remaining} to go`]
          .filter(Boolean)
          .join(' · ') || 'all done';

  const worst = mostSevere(openAlerts);

  return (
    <ul className="cc-tiles" aria-label="Summary">
      <Tile
        label={`${adherence.days}-day adherence`}
        value={percent(adherence.rate)}
        sub={
          adherence.due === 0 ? 'nothing due yet' : `${adherence.taken + adherence.late} of ${adherence.due} due doses`
        }
      />
      <Tile label="Doses today" value={`${done}/${todaysDoses.length}`} sub={dosesSub} />
      <Tile
        label="Open alerts"
        value={String(openAlerts.length)}
        sub={
          worst ? (
            <>
              <SeverityDot tone={alertTone(worst)} />
              <span>most severe: {worst}</span>
            </>
          ) : (
            'none open'
          )
        }
      />
    </ul>
  );
}
