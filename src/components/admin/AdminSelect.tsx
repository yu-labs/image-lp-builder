import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

type AdminSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string;
};

const SELECT_CLASS =
  'min-h-[2.75rem] w-full appearance-none rounded-xl border border-[#d7deea] bg-white px-3 pr-10 text-sm font-bold text-[#3f4352] outline-none transition focus:border-[#9bb4d6] focus:ring-2 focus:ring-[#d8e3f2] disabled:cursor-not-allowed disabled:opacity-60';

export default function AdminSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: AdminSelectProps) {
  return (
    <span className={['relative block min-w-0', wrapperClassName].filter(Boolean).join(' ')}>
      <select
        {...props}
        className={[SELECT_CLASS, className].filter(Boolean).join(' ')}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        strokeWidth={2.4}
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8b91a1]"
      />
    </span>
  );
}
