import type { DashboardCheckIn } from '@shared/dashboard';
import { capitalize, clockOf, relativeDay, weekdayInitial } from './format';
import { checkInTone, cx, Notice, Section, SeverityDot } from './Primitives';

const SEVERITY_LABEL: Record<DashboardCheckIn['severity'], string> = {
  none: 'no concerns',
  watch: 'watch',
  urgent: 'urgent',
  emergency: 'emergency',
};

interface Props {
  /** Oldest first, as the server sends it. */
  trend: DashboardCheckIn[];
  latest: DashboardCheckIn | null;
  checkedInToday: boolean;
  today: string;
  timeZone: string;
}

/** The last seven check-ins as chips (weekday, mood, severity dot) and the latest one spelled out. */
export function CheckInTrend({ trend, latest, checkedInToday, today, timeZone }: Props) {
  const recent = trend.slice(-7);

  return (
    <Section title="Check-ins" meta={recent.length > 0 ? `last ${recent.length}` : undefined}>
      {!checkedInToday && <Notice tone="warning">No check-in yet today.</Notice>}
      {recent.length === 0 ? (
        <p className="cc-muted">No check-ins recorded yet.</p>
      ) : (
        <ol className="cc-chips" aria-label="Recent check-ins">
          {recent.map((checkIn) => {
            const symptoms = checkIn.symptoms.length > 0 ? `, ${checkIn.symptoms.join(', ')}` : '';
            const label = `${capitalize(relativeDay(checkIn.localDate, today))}: ${checkIn.mood}${symptoms} (${
              SEVERITY_LABEL[checkIn.severity]
            })`;
            return (
              <li key={checkIn.at} className={cx('cc-chip', checkIn.flagged && 'cc-chip--flagged')} title={label}>
                <span className="cc-chip__day" aria-hidden="true">
                  {weekdayInitial(checkIn.localDate)}
                </span>
                <span className="cc-chip__mood" aria-hidden="true">
                  {checkIn.mood}
                </span>
                <SeverityDot tone={checkInTone(checkIn.severity)} />
                <span className="cc-sr-only">{label}</span>
              </li>
            );
          })}
        </ol>
      )}
      {latest && (
        <p className="cc-checkin__latest">
          <strong>Latest:</strong> {relativeDay(latest.localDate, today)} {clockOf(latest.at, timeZone)} — felt{' '}
          {latest.mood}
          {latest.symptoms.length > 0 ? `; symptoms: ${latest.symptoms.join(', ')}` : '; no symptoms reported'}
          {latest.severity !== 'none' && (
            <>
              {' · '}
              <span className={`cc-tone--${checkInTone(latest.severity)} cc-strong`}>
                {SEVERITY_LABEL[latest.severity]}
              </span>
            </>
          )}
        </p>
      )}
    </Section>
  );
}
