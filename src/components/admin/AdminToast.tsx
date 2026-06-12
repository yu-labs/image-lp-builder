import { useEffect, useState } from 'react';
import {
  ADMIN_TOAST_EVENT,
  consumeQueuedAdminToast,
  type AdminToastMessage,
} from '../../lib/admin-toast';

export default function AdminToast() {
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const queued = consumeQueuedAdminToast();
    if (queued) {
      setLeaving(false);
      setToast(queued);
    }

    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<AdminToastMessage>).detail;
      if (detail?.message) {
        setLeaving(false);
        setToast(detail);
      }
    };

    window.addEventListener(ADMIN_TOAST_EVENT, onToast);
    return () => window.removeEventListener(ADMIN_TOAST_EVENT, onToast);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const fadeTimer = window.setTimeout(() => setLeaving(true), 3200);
    const removeTimer = window.setTimeout(() => {
      setToast(null);
      setLeaving(false);
    }, 3700);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [toast]);

  if (!toast) return null;

  const toneClass =
    toast.tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-800'
      : toast.tone === 'info'
        ? 'border-blue-200 bg-blue-50 text-blue-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-[140] -translate-x-1/2 -translate-y-1/2">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex min-h-[4rem] w-[calc(100vw-32px)] max-w-[24rem] items-center justify-center whitespace-pre-line rounded-xl border px-5 py-4 text-center text-sm font-semibold leading-relaxed break-words shadow-xl transition-opacity duration-500 sm:w-[24rem] sm:px-6 sm:py-5 sm:text-base ${leaving ? 'opacity-0' : 'opacity-100'} ${toneClass}`}
      >
        {toast.message}
      </div>
    </div>
  );
}
