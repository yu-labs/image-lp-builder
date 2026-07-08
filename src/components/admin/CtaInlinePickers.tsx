/**
 * Small reusable inline input controls for the CTA editor forms:
 * a color picker, a numeric text input, a range+number field, and a
 * compact number picker. Leaf components — extracted from CtaEditor so
 * both the main editor and the decoration panels share one copy.
 */

import { useEffect, useState } from 'react';
import {
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_SECONDARY_BUTTON_CLASS,
} from './LpEditorPrimitives';

interface ColorPickerInlineProps {
  label: string;
  value: string;
  isOverride: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
}

export function ColorPickerInline({
  label,
  value,
  isOverride,
  onChange,
  onReset,
}: ColorPickerInlineProps) {
  // Plain span wrapper — no <label> implicit `for` association.
  // Reasoning: with <label>, clicking the label text or any padding
  // inside it opens the color picker (because <input type=color> is
  // the first focusable child). The operator wanted the click area
  // limited to the swatch / hex input themselves.
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-xs">
      {label && <span className="font-semibold text-[#687082]">{label}</span>}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="color-input h-[2.75rem] w-11 shrink-0 cursor-pointer rounded-xl border border-[#d7deea] bg-white p-1"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${EDITOR_INPUT_CLASS} h-[2.75rem] w-28 min-w-0 px-2 py-1 font-mono text-xs`}
      />
      {isOverride && (
        <button
          type="button"
          onClick={onReset}
          title="プリセット既定に戻す"
          className={`${EDITOR_SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[10px]`}
        >
          既定
        </button>
      )}
    </span>
  );
}

interface NumberPickerInlineProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unit?: string;
  normalizeValue?: (v: number) => number;
}

interface NumericTextInputProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  className?: string;
  normalizeValue?: (v: number) => number;
}

export function NumericTextInput({
  value,
  onChange,
  min,
  max,
  className,
  normalizeValue,
}: NumericTextInputProps) {
  const safeValue = normalizeNumber(value, min, max, normalizeValue);
  const [inputValue, setInputValue] = useState(String(safeValue));

  useEffect(() => {
    setInputValue(String(safeValue));
  }, [safeValue]);

  function clean(raw: string) {
    const sign = min < 0 && raw.trimStart().startsWith('-') ? '-' : '';
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (sign && digits === '') return '-';
    return `${sign}${digits}`;
  }

  function commit(raw: string) {
    const cleaned = clean(raw);
    if (cleaned === '' || cleaned === '-') {
      setInputValue(String(safeValue));
      onChange(safeValue);
      return;
    }
    const next = normalizeNumber(Number(cleaned), min, max, normalizeValue);
    setInputValue(String(next));
    onChange(next);
  }

  function handleInput(raw: string) {
    const cleaned = clean(raw);
    setInputValue(cleaned);
    if (cleaned === '' || cleaned === '-') return;
    const next = Number(cleaned);
    if (!Number.isFinite(next)) return;
    if (next >= min && next <= max) {
      onChange(normalizeNumber(next, min, max, normalizeValue));
    }
  }

  return (
    <input
      type="text"
      inputMode={min < 0 ? 'text' : 'numeric'}
      pattern={min < 0 ? '-?[0-9]*' : '[0-9]*'}
      value={inputValue}
      onChange={(e) => handleInput(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      className={className}
    />
  );
}

function normalizeNumber(
  value: number,
  min: number,
  max: number,
  normalizeValue?: (v: number) => number,
) {
  const base = Number.isFinite(value) ? value : min;
  const normalized = normalizeValue ? normalizeValue(base) : base;
  return Math.max(min, Math.min(max, normalized));
}

interface CtaRangeNumberFieldProps extends NumericTextInputProps {
  label: string;
  unit?: string;
  step?: number;
}

const CTA_RANGE_INPUT_CLASS =
  'h-3 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#567baf] [&::-moz-range-thumb]:shadow-[0_8px_18px_rgba(86,123,175,0.25)] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#567baf] [&::-webkit-slider-thumb]:shadow-[0_8px_18px_rgba(86,123,175,0.25)]';

export function CtaRangeNumberField({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  step = 1,
  className,
  normalizeValue,
}: CtaRangeNumberFieldProps) {
  const safeValue = normalizeNumber(value, min, max, normalizeValue);
  const percent = max > min ? ((safeValue - min) / (max - min)) * 100 : 0;

  return (
    <label className={['flex min-w-0 flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {label && <span className={EDITOR_LABEL_CLASS}>{label}</span>}
      <span className="flex min-h-[2.75rem] w-full max-w-[22rem] items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          onChange={(e) =>
            onChange(normalizeNumber(Number(e.target.value), min, max, normalizeValue))
          }
          className={CTA_RANGE_INPUT_CLASS}
          style={{
            background: `linear-gradient(to right, #567baf 0%, #567baf ${percent}%, #d8e3f2 ${percent}%, #d8e3f2 100%)`,
          }}
        />
        <span className="flex shrink-0 items-center gap-1">
          <NumericTextInput
            value={safeValue}
            onChange={onChange}
            min={min}
            max={max}
            normalizeValue={normalizeValue}
            className={`${EDITOR_INPUT_CLASS} h-[2.75rem] w-[4.5rem] px-2 py-1 text-center text-xs`}
          />
          {unit && (
            <span className="text-xs font-extrabold text-[#8b91a1]">{unit}</span>
          )}
        </span>
      </span>
    </label>
  );
}

export function NumberPickerInline({
  label,
  value,
  onChange,
  min,
  max,
  unit = 'px',
  normalizeValue,
}: NumberPickerInlineProps) {
  // span wrapper to keep the click area tight to the input itself
  // (label-text and the trailing "px" are deliberately non-interactive).
  return (
    <span className="inline-flex min-w-[12rem] max-w-full text-xs">
      <CtaRangeNumberField
        label={label}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        unit={unit}
        normalizeValue={normalizeValue}
      />
    </span>
  );
}
