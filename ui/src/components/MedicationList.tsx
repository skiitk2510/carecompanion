import type { DashboardMedication } from '@shared/dashboard';
import { percent, spokenClockTime } from './format';
import { cx, Section, Tag } from './Primitives';

interface Props {
  medications: DashboardMedication[];
  /** The adherence window the per-medication rates cover. */
  days: number;
}

/** Every medication on file with its schedule, purpose and adherence over the window; inactive ones greyed. */
export function MedicationList({ medications, days }: Props) {
  return (
    <Section title="Medications" meta={`${days}-day adherence`}>
      {medications.length === 0 ? (
        <p className="cc-muted">No medications on file.</p>
      ) : (
        <ul className="cc-meds">
          {medications.map((med) => {
            const taken = med.adherence.taken + med.adherence.late;
            const fill = med.adherence.rate === null ? 0 : Math.round(med.adherence.rate * 100);
            const schedule = med.scheduleTimes.map(spokenClockTime).join(' · ');
            return (
              <li key={med.id} className={cx('cc-med', !med.active && 'cc-med--inactive')}>
                <div className="cc-med__head">
                  <span className="cc-med__name">
                    {med.name} <span className="cc-med__dose">{med.dose}</span>
                  </span>
                  {(med.critical || !med.active) && (
                    <span className="cc-med__tags">
                      {med.critical && <Tag tone="danger">critical</Tag>}
                      {!med.active && <Tag>inactive</Tag>}
                    </span>
                  )}
                  <span className="cc-med__rate">
                    {percent(med.adherence.rate)}
                    {med.adherence.due > 0 && (
                      <span className="cc-med__counts">
                        {' '}
                        {taken}/{med.adherence.due}
                      </span>
                    )}
                  </span>
                </div>
                <div className="cc-med__sub">
                  {schedule || 'no fixed schedule'}
                  {med.purpose && ` · ${med.purpose}`}
                </div>
                <div
                  className="cc-meter"
                  role="img"
                  aria-label={
                    med.adherence.due > 0
                      ? `${med.name}: ${taken} of ${med.adherence.due} due doses taken`
                      : `${med.name}: no doses due in the window`
                  }
                >
                  <div className="cc-meter__fill" style={{ width: `${fill}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
