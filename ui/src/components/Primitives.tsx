/**
 * Small presentational pieces shared by the dashboard sections: tone mapping, dots, pills, tags, section cards and
 * the busy-aware action button. Status is never colour alone — every dot sits next to a text label.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import type { DashboardAlert, DashboardCheckIn, DashboardDoseStatus } from '@shared/dashboard';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function alertTone(severity: DashboardAlert['severity']): Tone {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
  }
}

export function checkInTone(severity: DashboardCheckIn['severity']): Tone {
  switch (severity) {
    case 'none':
      return 'success';
    case 'watch':
      return 'warning';
    case 'urgent':
    case 'emergency':
      return 'danger';
  }
}

export function doseTone(status: DashboardDoseStatus): Tone {
  switch (status) {
    case 'taken':
      return 'success';
    case 'late':
    case 'skipped':
      return 'warning';
    case 'missed':
      return 'danger';
    case 'scheduled':
      return 'neutral';
  }
}

export const DOSE_LABEL: Record<DashboardDoseStatus, string> = {
  scheduled: 'Scheduled',
  taken: 'Taken',
  late: 'Taken late',
  missed: 'Missed',
  skipped: 'Skipped',
};

/** A decorative status dot; always pair it with visible or screen-reader text. */
export function SeverityDot({ tone }: { tone: Tone }) {
  return <span className={`cc-dot cc-dot--${tone}`} aria-hidden="true" />;
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`cc-pill cc-pill--${tone}`}>{children}</span>;
}

export function Tag({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`cc-tag cc-tag--${tone}`}>{children}</span>;
}

export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <p className={`cc-notice cc-notice--${tone}`} role="status">
      {children}
    </p>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <p className="cc-inline-error" role="alert">
      {message}
    </p>
  );
}

interface SectionProps {
  title: string;
  /** Small text at the right of the heading (a count, a window). */
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Section({ title, meta, className, children }: SectionProps) {
  const headingId = useId();
  return (
    <section className={cx('cc-section', className)} aria-labelledby={headingId}>
      <div className="cc-section__head">
        <h3 className="cc-section__title" id={headingId}>
          {title}
        </h3>
        {meta !== undefined && meta !== null && <span className="cc-section__meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the label stays announced while the visible text is replaced by the busy ellipsis. */
  'aria-label': string;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

export function ActionButton({
  busy = false,
  variant = 'secondary',
  type = 'button',
  className,
  disabled,
  children,
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type={type}
      className={cx('cc-btn', `cc-btn--${variant}`, busy && 'cc-btn--busy', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      <span className="cc-btn__label">{children}</span>
      {busy && (
        <span className="cc-btn__busy" aria-hidden="true">
          …
        </span>
      )}
    </button>
  );
}
