import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type MobilePlacement = 'sheet' | 'center';
type FormSubmitHandler = ComponentPropsWithoutRef<'form'>['onSubmit'];

interface Props {
  children: ReactNode;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  as?: 'div' | 'form';
  closeOnBackdrop?: boolean;
  maxHeightClass?: string;
  maxWidthClass?: string;
  mobilePlacement?: MobilePlacement;
  onClose?: () => void;
  onSubmit?: FormSubmitHandler;
  overflowClass?: string;
  panelClassName?: string;
  zIndexClass?: string;
}

export default function AdminModal({
  children,
  ariaLabel,
  ariaLabelledBy,
  as = 'div',
  closeOnBackdrop = true,
  maxHeightClass = 'max-h-[92dvh]',
  maxWidthClass = 'max-w-lg',
  mobilePlacement = 'sheet',
  onClose,
  onSubmit,
  overflowClass = 'overflow-auto',
  panelClassName,
  zIndexClass = 'z-[130]',
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const placementClass =
    mobilePlacement === 'center'
      ? 'items-center px-4 py-6 sm:p-4'
      : 'items-end p-0 sm:items-center sm:p-4';
  const radiusClass =
    mobilePlacement === 'center' ? 'rounded-2xl' : 'rounded-t-[1.25rem] sm:rounded-2xl';
  const panelClasses = [
    'admin-modal-panel w-full border border-white/70 bg-white/95 shadow-[0_28px_70px_rgba(31,34,48,0.22)] backdrop-blur-xl',
    maxWidthClass,
    maxHeightClass,
    overflowClass,
    radiusClass,
    panelClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const closeFromBackdrop = () => {
    if (closeOnBackdrop) onClose?.();
  };

  const panel =
    as === 'form' ? (
      <form
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={panelClasses}
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        {children}
      </form>
    ) : (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={panelClasses}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    );

  return createPortal(
    <div
      className={`admin-modal-backdrop fixed inset-0 ${zIndexClass} flex justify-center bg-slate-950/45 backdrop-blur-sm ${placementClass}`}
      role="presentation"
      onClick={closeFromBackdrop}
    >
      {panel}
    </div>,
    document.body
  );
}
