import { useId } from 'react';
import type { DashboardData } from '@shared/dashboard';
import { firstName } from './format';
import { cx } from './Primitives';

interface Props {
  caregivers: DashboardData['caregivers'];
  selectedId: string;
  onChange(caregiverId: string): void;
}

/** Segmented control naming who is acting on alerts and doses (Priya or Daniel in the demo). */
export function CaregiverPicker({ caregivers, selectedId, onChange }: Props) {
  const labelId = useId();
  if (caregivers.length === 0) return null;

  const shortNames = caregivers.map((c) => firstName(c.name));
  const shortNamesUnique = new Set(shortNames).size === shortNames.length;

  return (
    <div className="cc-picker">
      <span className="cc-picker__label" id={labelId}>
        Acting as
      </span>
      <div className="cc-segmented" role="group" aria-labelledby={labelId}>
        {caregivers.map((caregiver, index) => {
          const selected = caregiver.id === selectedId;
          return (
            <button
              key={caregiver.id}
              type="button"
              className={cx('cc-segmented__btn', selected && 'cc-segmented__btn--on')}
              aria-pressed={selected}
              aria-label={`${caregiver.name} (${caregiver.relationship})`}
              title={`${caregiver.name} — ${caregiver.relationship}`}
              onClick={() => {
                if (!selected) onChange(caregiver.id);
              }}
            >
              {shortNamesUnique ? shortNames[index] : caregiver.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
