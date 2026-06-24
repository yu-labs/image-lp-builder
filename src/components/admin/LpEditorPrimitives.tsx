import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export const EDITOR_PANEL_CLASS =
  'rounded-2xl bg-white/78 p-5 shadow-[0_12px_30px_rgba(31,34,48,0.055)] ring-1 ring-white/70 sm:p-6';
export const EDITOR_SUB_PANEL_CLASS =
  'rounded-2xl bg-[#f8fafc]/82 p-4 ring-1 ring-[#e2e7f0] sm:p-5';
export const EDITOR_DIVIDER_CLASS = 'mt-5 border-t border-[#e2e7f0] pt-5';
export const EDITOR_LABEL_CLASS = 'text-xs font-bold text-[#687082]';
export const EDITOR_HELP_CLASS =
  'text-[11px] font-semibold leading-relaxed text-[#8b91a1]';
export const EDITOR_INPUT_CLASS =
  'min-h-[2.75rem] rounded-xl border border-[#d7deea] bg-white px-3 py-2 text-sm text-[#3f4352] outline-none transition focus:border-[#9bb4d6] focus:ring-2 focus:ring-[#d8e3f2] disabled:bg-[#f8fafc] disabled:opacity-70';
export const EDITOR_SELECT_CLASS =
  'min-h-[2.75rem] rounded-xl border border-[#d7deea] bg-white px-3 py-2 text-sm font-semibold text-[#3f4352] outline-none transition focus:border-[#9bb4d6] focus:ring-2 focus:ring-[#d8e3f2] disabled:bg-[#f8fafc] disabled:opacity-70';
export const EDITOR_PRIMARY_BUTTON_CLASS =
  'inline-flex min-h-[2.75rem] items-center justify-center rounded-full bg-[#567baf] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(86,123,175,0.16)] transition hover:bg-[#4c6f9f] disabled:cursor-not-allowed disabled:opacity-50';
export const EDITOR_SECONDARY_BUTTON_CLASS =
  'inline-flex min-h-[2.75rem] items-center justify-center rounded-full bg-[#f2f4f8] px-4 py-2 text-sm font-extrabold text-[#596173] transition hover:bg-[#e9edf4] disabled:cursor-not-allowed disabled:opacity-50';
export const EDITOR_DANGER_BUTTON_CLASS =
  'inline-flex min-h-[2.75rem] items-center justify-center rounded-full bg-[#fff1f1] px-4 py-2 text-sm font-extrabold text-[#b83232] transition hover:bg-[#ffe4e4] disabled:cursor-not-allowed disabled:opacity-50';
export const EDITOR_FIELD_ROW_CLASS =
  'flex max-w-full flex-wrap items-start gap-x-4 gap-y-4 lg:gap-x-5';
export const EDITOR_STACK_CLASS = 'space-y-5';
export const EDITOR_TIGHT_STACK_CLASS = 'space-y-4';

export function EditorPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={[EDITOR_PANEL_CLASS, className].filter(Boolean).join(' ')}>
      {children}
    </section>
  );
}

export function EditorSubPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={[EDITOR_SUB_PANEL_CLASS, className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

export function EditorSectionHeader({
  title,
  titleAdornment,
  description,
  children,
}: {
  title: string;
  titleAdornment?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div>
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-[#3f4352]">
        <span>{title}</span>
        {titleAdornment}
      </h3>
      {description && (
        <p className="mt-1.5 text-xs font-semibold leading-relaxed text-[#8b91a1]">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

export function EditorField({
  label,
  help,
  children,
  className,
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={['flex min-w-0 flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      <span className={EDITOR_LABEL_CLASS}>{label}</span>
      {children}
      {help && <span className={EDITOR_HELP_CLASS}>{help}</span>}
    </label>
  );
}

export function EditorSliderNumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  className,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  className?: string;
}) {
  const safeValue = clampNumber(value, min, max);
  const [inputValue, setInputValue] = useState(String(safeValue));
  const percent = max > min ? ((safeValue - min) / (max - min)) * 100 : 0;

  useEffect(() => {
    setInputValue(String(safeValue));
  }, [safeValue]);

  function commit(raw: string) {
    const next = Number(raw);
    const normalized = Number.isFinite(next) ? clampNumber(next, min, max) : safeValue;
    setInputValue(String(normalized));
    onChange(normalized);
  }

  function handleNumberInput(raw: string) {
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    setInputValue(digits);
    if (digits === '') return;
    const next = Number(digits);
    if (!Number.isFinite(next)) return;
    if (next >= min && next <= max) {
      onChange(next);
    }
  }

  return (
    <label
      className={[
        'flex w-full min-w-0 max-w-full flex-col gap-2 sm:w-[18rem]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={EDITOR_LABEL_CLASS}>{label}</span>
      <div className="flex min-h-[2.75rem] items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          onChange={(e) => commit(e.target.value)}
          className="h-3 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#567baf] [&::-moz-range-thumb]:shadow-[0_8px_18px_rgba(86,123,175,0.25)] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#567baf] [&::-webkit-slider-thumb]:shadow-[0_8px_18px_rgba(86,123,175,0.25)]"
          style={{
            background: `linear-gradient(to right, #567baf 0%, #567baf ${percent}%, #d8e3f2 ${percent}%, #d8e3f2 100%)`,
          }}
        />
        <div className="flex shrink-0 items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={inputValue}
            onChange={(e) => handleNumberInput(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            className={`${EDITOR_INPUT_CLASS} w-16 px-2 text-center`}
          />
          {unit && (
            <span className="text-xs font-extrabold text-[#8b91a1]">{unit}</span>
          )}
        </div>
      </div>
    </label>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type AdminTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const CALLOUT_TONE_CLASS: Record<AdminTone, string> = {
  neutral: 'border-white/75 bg-white/80 text-[#596173] shadow-[0_10px_24px_rgba(31,34,48,0.05)]',
  info: 'border-[#c8d5e8] bg-[#eef4fb] text-[#2f4f78] shadow-[0_12px_26px_rgba(86,123,175,0.08)]',
  success: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50/90 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
};

const STATUS_PILL_TONE_CLASS: Record<AdminTone, string> = {
  neutral: 'bg-white text-[#8b91a1] ring-[#e8ecf3]',
  info: 'bg-[#eef4fb] text-[#567baf] ring-[#d8e0ec]',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  warning: 'bg-amber-50 text-amber-800 ring-amber-100',
  danger: 'bg-red-50 text-red-700 ring-red-100',
};

export function AdminStatusPill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: AdminTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1',
        STATUS_PILL_TONE_CLASS[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}

export function AdminCallout({
  tone = 'neutral',
  title,
  children,
  className,
}: {
  tone?: AdminTone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        'rounded-2xl border px-4 py-3 text-xs leading-[1.55]',
        CALLOUT_TONE_CLASS[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {title && <div className="mb-1.5 font-extrabold text-[#3f4352]">{title}</div>}
      {children}
    </div>
  );
}

export function AdminActionRow({
  children,
  className,
  align = 'start',
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end' | 'between';
}) {
  const alignClass =
    align === 'end'
      ? 'justify-end'
      : align === 'between'
        ? 'justify-between'
        : 'justify-start';
  return (
    <div
      className={['flex flex-wrap items-center gap-2', alignClass, className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export function AdminToggleRow({
  title,
  help,
  checked,
  disabled = false,
  onChange,
  onLabel = 'ON',
  offLabel = 'OFF',
  className,
}: {
  title: ReactNode;
  help?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  onLabel?: string;
  offLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={[
        EDITOR_SUB_PANEL_CLASS,
        'flex flex-col gap-3 bg-white/82 sm:flex-row sm:items-center sm:justify-between',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-[#3f4352]">{title}</p>
        {help && <p className={`${EDITOR_HELP_CLASS} mt-1`}>{help}</p>}
      </div>
      <AdminToggleSwitch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        onLabel={onLabel}
        offLabel={offLabel}
      />
    </div>
  );
}

export function AdminToggleSwitch({
  checked,
  disabled = false,
  onChange,
  onLabel = 'ON',
  offLabel = 'OFF',
  className,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  onLabel?: string;
  offLabel?: string;
  className?: string;
}) {
  return (
    <label
      className={[
        'inline-flex min-h-[2.75rem] w-fit shrink-0 cursor-pointer items-center gap-2 rounded-full bg-[#f6f8fb] px-3 py-1.5',
        disabled ? 'cursor-not-allowed opacity-70' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={[
          'relative h-6 w-11 rounded-full transition',
          checked ? 'bg-[#567baf]' : 'bg-[#dfe5ee]',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span
          className={[
            'absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition',
            checked ? 'translate-x-5' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      </span>
      <span className="w-8 text-xs font-extrabold text-[#687082]">
        {checked ? onLabel : offLabel}
      </span>
    </label>
  );
}

export function AdminSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={[
        'inline-flex w-fit max-w-full rounded-full bg-[#eef2f7] p-1',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              'min-h-9 rounded-full px-3.5 text-sm font-extrabold transition',
              active
                ? 'bg-white text-[#567baf] shadow-[0_8px_18px_rgba(31,34,48,0.09)]'
                : 'text-[#8b91a1] hover:text-[#596173]',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={active}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function AdminChecklist({
  title,
  items,
  error,
  help,
  className,
}: {
  title: ReactNode;
  items: Array<{
    id: string;
    label: ReactNode;
    checked: boolean;
    onChange: () => void;
  }>;
  error?: ReactNode;
  help?: ReactNode;
  className?: string;
}) {
  const checkedCount = items.filter((item) => item.checked).length;
  return (
    <AdminCallout tone="neutral" className={['bg-[#f6f8fb]/85', className].filter(Boolean).join(' ')}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-extrabold text-[#3f4352]">{title}</div>
        <AdminStatusPill>{checkedCount}/{items.length}</AdminStatusPill>
      </div>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-start gap-2 rounded-xl bg-white/75 px-3 py-2 transition hover:bg-white"
          >
            <input
              type="checkbox"
              checked={item.checked}
              onChange={item.onChange}
              className="mt-0.5 h-4 w-4 accent-[#567baf]"
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
      {help && <p className="mt-2 text-[11px] leading-[1.55] text-[#8b91a1]">{help}</p>}
      {error && <p className="mt-2 text-[11px] font-bold leading-[1.55] text-red-700">{error}</p>}
    </AdminCallout>
  );
}
