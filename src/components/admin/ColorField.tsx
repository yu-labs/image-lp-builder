interface ColorFieldProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  label: string;
  textInputClassName?: string;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export default function ColorField({
  value,
  onChange,
  onBlur,
  label,
  textInputClassName = 'w-24 sm:w-28',
}: ColorFieldProps) {
  const swatchValue = HEX_COLOR_RE.test(value) ? value : '#ffffff';

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        type="color"
        value={swatchValue}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-label={label}
        className="color-input h-10 w-11 shrink-0 rounded-xl border border-[#d7deea] bg-white p-1"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="#ffffff"
        aria-label={`${label}のカラーコード`}
        className={`${textInputClassName} rounded-xl border border-[#d7deea] bg-white px-3 py-2 font-mono text-xs text-[#3f4352] outline-none transition focus:border-[#9bb4d6] focus:ring-2 focus:ring-[#d8e3f2]`}
      />
    </div>
  );
}
