import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { DashboardData } from '@shared/dashboard';
import { percent, shortLocalDate, weekdayInitial, weekdayName } from './format';
import { cx, Section } from './Primitives';

const HEIGHT = 64;
const LABEL_BAND = 16;
const TOP_PAD = 3;
const PLOT_H = HEIGHT - LABEL_BAND - TOP_PAD;
const BASELINE = TOP_PAD + PLOT_H;
const BAR_MAX = 24;
const BAR_MIN = 3;

/** Pixel width of the strip's box, kept current through ResizeObserver (no timers; a layout observer only). */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** A column growing from the baseline with a rounded top and square bottom. */
function barPath(x: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  const top = BASELINE - height;
  return [
    `M${round(x)},${BASELINE}`,
    `V${round(top + r)}`,
    `Q${round(x)},${round(top)} ${round(x + r)},${round(top)}`,
    `H${round(x + width - r)}`,
    `Q${round(x + width)},${round(top)} ${round(x + width)},${round(top + r)}`,
    `V${BASELINE}`,
    'Z',
  ].join(' ');
}

interface Props {
  adherence: DashboardData['adherence'];
  today: string;
}

/** One bar per day of the adherence window: height = (taken + late) / due, hatched when nothing was due. */
export function AdherenceStrip({ adherence, today }: Props) {
  const days = adherence.perDay;
  const { ref, width } = useContainerWidth();
  const rawId = useId();
  const patternId = `cc-hatch-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const n = days.length;
  const slot = n > 0 && width > 0 ? width / n : 0;
  const barWidth = Math.max(BAR_MIN, Math.min(BAR_MAX, slot * 0.6));
  const labelEvery = slot >= 9 ? 1 : Math.ceil(9 / Math.max(slot, 1));
  const summary = days
    .map((d) => `${weekdayName(d.localDate)} ${d.rate === null ? 'nothing due' : percent(d.rate)}`)
    .join(', ');

  return (
    <Section title="Adherence by day" meta={`last ${adherence.days} days`} className="cc-strip">
      <div className="cc-strip__box" ref={ref}>
        {n === 0 ? (
          <p className="cc-muted">No adherence history yet.</p>
        ) : (
          width > 0 && (
            <svg
              className="cc-strip__svg"
              width={width}
              height={HEIGHT}
              viewBox={`0 0 ${width} ${HEIGHT}`}
              role="img"
              aria-label={`Adherence per day: ${summary}`}
            >
              <defs>
                <pattern
                  id={patternId}
                  patternUnits="userSpaceOnUse"
                  width="6"
                  height="6"
                  patternTransform="rotate(45)"
                >
                  <line x1="0" y1="0" x2="0" y2="6" className="cc-strip__hatch" />
                </pattern>
              </defs>
              <line x1={0} x2={width} y1={BASELINE + 0.5} y2={BASELINE + 0.5} className="cc-strip__baseline" />
              {days.map((day, i) => {
                const x = i * slot + (slot - barWidth) / 2;
                const fillHeight = day.rate === null ? 0 : Math.round(day.rate * PLOT_H);
                const isToday = day.localDate === today;
                const tip = `${weekdayName(day.localDate)} ${shortLocalDate(day.localDate)}: ${
                  day.rate === null
                    ? 'nothing due'
                    : `${day.taken + day.late} of ${day.due} doses (${percent(day.rate)})`
                }`;
                return (
                  <g key={day.localDate} className="cc-strip__day">
                    <title>{tip}</title>
                    <rect x={round(i * slot)} y={0} width={round(slot)} height={HEIGHT} fill="transparent" />
                    {day.rate === null ? (
                      <path d={barPath(x, barWidth, PLOT_H)} className="cc-strip__empty" fill={`url(#${patternId})`} />
                    ) : (
                      <path d={barPath(x, barWidth, PLOT_H)} className="cc-strip__track" />
                    )}
                    {fillHeight > 0 && <path d={barPath(x, barWidth, fillHeight)} className="cc-strip__fill" />}
                    {i % labelEvery === 0 && (
                      <text
                        x={round(i * slot + slot / 2)}
                        y={HEIGHT - 4}
                        textAnchor="middle"
                        className={cx('cc-strip__label', isToday && 'cc-strip__label--today')}
                      >
                        {weekdayInitial(day.localDate)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )
        )}
      </div>
    </Section>
  );
}
