/**
 * The elder's "today" screen, rendered when a host shows the `get_todays_plan` result on a device with a display.
 * Large type, few words, one clear next action — per the Alexa+ design guide's reduced-density rule.
 */
import type { DashboardActions } from '../types';
import { DoseTimeline } from '../DoseTimeline';
import { ActionButton, Notice, Section } from '../Primitives';
import { spokenClockTime } from '../format';
import type { TodaysPlanData } from './types';

interface Props {
  data: TodaysPlanData;
  /** The tool's spoken sentence (what the assistant said), shown as the headline. */
  spoken: string | null;
  markTaken: DashboardActions['markTaken'];
  refresh: () => Promise<void>;
  busy?: boolean;
}

export function TodayScreen({ data, spoken, markTaken, refresh, busy = false }: Props) {
  const soon = data.appointments.filter((a) => /^(today|tomorrow)\b/i.test(a.when)).slice(0, 2);
  const done = data.doses.filter((d) => d.status === 'taken' || d.status === 'late').length;

  return (
    <div className="cc-elder">
      <header className="cc-elder__head">
        <div>
          <h2 className="cc-elder__title">{data.elderName}&rsquo;s day</h2>
          <p className="cc-elder__sub">
            {spokenClockTime(data.localTime)} · {done} of {data.doses.length} doses done
            {data.nextUp ? ` · next: ${data.nextUp.name} at ${data.nextUp.spokenTime}` : ''}
          </p>
        </div>
        <ActionButton aria-label="Refresh today's plan" variant="ghost" busy={busy} onClick={() => void refresh()}>
          Refresh
        </ActionButton>
      </header>

      {spoken && (
        <p className="cc-elder__spoken" aria-live="polite">
          {spoken}
        </p>
      )}

      <DoseTimeline doses={data.doses} nextUp={data.nextUp} markTaken={markTaken} />

      {soon.length > 0 && (
        <Section title="Coming up">
          <ul className="cc-appts">
            {soon.map((a) => (
              <li key={a.id} className="cc-appt">
                <span className="cc-appt__title">{a.title}</span>
                <span className="cc-appt__when">{a.when}</span>
                {a.location && <span className="cc-appt__where">{a.location}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!data.checkedInToday && (
        <Notice tone="info">No check-in yet today. Tell Alexa how you feel and the family will know.</Notice>
      )}
    </div>
  );
}
