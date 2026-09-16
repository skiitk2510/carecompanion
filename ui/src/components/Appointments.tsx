import type { DashboardAppointment } from '@shared/dashboard';
import { capitalize } from './format';
import { Section } from './Primitives';

/** Upcoming appointments in the server's order (soonest first). */
export function Appointments({ appointments }: { appointments: DashboardAppointment[] }) {
  return (
    <Section title="Upcoming appointments" meta={appointments.length > 0 ? String(appointments.length) : undefined}>
      {appointments.length === 0 ? (
        <p className="cc-muted">Nothing scheduled.</p>
      ) : (
        <ul className="cc-appts">
          {appointments.map((appointment) => (
            <li key={appointment.id} className="cc-appt">
              <span className="cc-appt__title">{appointment.title}</span>
              <span className="cc-appt__when">{capitalize(appointment.when)}</span>
              {appointment.location && <span className="cc-appt__where">{appointment.location}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
