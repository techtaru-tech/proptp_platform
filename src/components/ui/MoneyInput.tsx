import { useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { Input } from './Input';
import { moneyFactor, moneyUnit } from '../../utils/format';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label?: string;
  error?: string;
  hint?: string;
  wrapperClassName?: string;
  /** The amount in rupees, as the rest of the app holds it. */
  value: string | number | undefined;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * An amount field that follows the points setting. The app keeps every amount in rupees; when
 * points are on this shows and takes points, and hands the rupee value back through onChange,
 * so the forms around it do not change. A "(₹)" in the label becomes the current unit.
 */
export function MoneyInput({ value, onChange, label, min, max, step, ...rest }: Props) {
  const k = moneyFactor();
  const [typing, setTyping] = useState<string | null>(null);
  const unit = label?.replace('(₹)', `(${moneyUnit()})`);
  if (k === 1) return <Input {...rest} label={unit} min={min} max={max} step={step} value={value ?? ''} onChange={onChange} />;

  const raw = value === '' || value === undefined ? NaN : Number(value);
  const shown = typing ?? (Number.isNaN(raw) ? '' : String(round(raw * k, 4)));
  const scale = (v: number | string | undefined) => (v === undefined ? undefined : round(Number(v) * k, 4));
  // Rupee amounts are whole numbers unless the field takes decimals (a per-area rate does).
  const places = step !== undefined && String(step).includes('.') ? 2 : 0;
  return (
    <Input
      {...rest}
      label={unit}
      min={scale(min)}
      max={scale(max)}
      step={step !== undefined ? scale(step) : undefined}
      value={shown}
      onFocus={() => setTyping(shown)}
      onBlur={() => setTyping(null)}
      onChange={(e) => {
        setTyping(e.target.value);
        const rupees = e.target.value === '' ? '' : String(round(Number(e.target.value) / k, places));
        onChange({ ...e, target: { ...e.target, value: rupees }, currentTarget: { ...e.currentTarget, value: rupees } } as unknown as ChangeEvent<HTMLInputElement>);
      }}
    />
  );
}
