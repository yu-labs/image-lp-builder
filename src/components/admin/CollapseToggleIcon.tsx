import { ChevronDown } from 'lucide-react';

interface Props {
  open: boolean;
  className?: string;
}

export default function CollapseToggleIcon({ open, className = '' }: Props) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
        open ? 'bg-[#f2f4f8] text-[#8b91a1]' : 'bg-[#eef4fb] text-[#567baf]'
      } ${className}`}
    >
      <ChevronDown
        className={`h-4 w-4 transition-transform duration-150 ${
          open ? 'rotate-180' : ''
        }`}
        strokeWidth={2.7}
      />
    </span>
  );
}
