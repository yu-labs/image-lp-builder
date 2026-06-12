import { useEffect, useRef, useState } from 'react';
import {
  ADMIN_CONFIRM_EVENT,
  type AdminConfirmOptions,
  type AdminConfirmRequest,
} from '../../lib/admin-dialog';
import AdminModal from './AdminModal';

interface ActiveDialog {
  options: AdminConfirmOptions;
  respond: (confirmed: boolean) => void;
}

export default function AdminConfirmDialog() {
  const [active, setActive] = useState<ActiveDialog | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onConfirm = (event: Event) => {
      const custom = event as CustomEvent<AdminConfirmRequest>;
      const detail = custom.detail;
      if (!detail?.options || !detail.respond) return;
      event.preventDefault();
      setActive((current) => {
        current?.respond(false);
        return {
          options: detail.options,
          respond: detail.respond,
        };
      });
    };

    window.addEventListener(ADMIN_CONFIRM_EVENT, onConfirm);
    return () => window.removeEventListener(ADMIN_CONFIRM_EVENT, onConfirm);
  }, []);

  useEffect(() => {
    if (!active) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;

  const { options } = active;
  const tone = options.tone ?? 'default';
  const confirmClass =
    tone === 'danger'
      ? 'bg-[#b83232] text-white shadow-[0_14px_28px_rgba(184,50,50,0.18)] hover:bg-[#a62d2d]'
      : tone === 'warning'
        ? 'bg-amber-600 text-white shadow-[0_14px_28px_rgba(217,119,6,0.18)] hover:bg-amber-700'
        : 'bg-[#567baf] text-white shadow-[0_14px_28px_rgba(86,123,175,0.18)] hover:bg-[#4c6f9f]';
  const badgeClass =
    tone === 'danger'
      ? 'bg-red-50 text-red-700'
      : tone === 'warning'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-[#eef4fb] text-[#567baf]';

  function close(confirmed: boolean) {
    setActive((current) => {
      current?.respond(confirmed);
      return null;
    });
  }

  return (
    <AdminModal
      ariaLabelledBy="admin-confirm-title"
      zIndexClass="z-[170]"
      maxWidthClass="max-w-md"
      panelClassName="p-5"
      onClose={() => close(false)}
    >
      <div className={`mb-4 inline-flex rounded-full px-3 py-1 text-xs font-extrabold ${badgeClass}`}>
        確認
      </div>
      <h2 id="admin-confirm-title" className="text-xl font-extrabold leading-snug text-[#3f4352]">
        {options.title}
      </h2>
      {options.message && (
        <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-relaxed text-[#687082]">
          {options.message}
        </p>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          ref={cancelRef}
          onClick={() => close(false)}
          className="min-h-[44px] rounded-full bg-[#f2f4f8] px-5 py-2.5 text-sm font-extrabold text-[#596173] transition hover:bg-[#e9edf4]"
        >
          {options.cancelLabel ?? 'キャンセル'}
        </button>
        <button
          type="button"
          onClick={() => close(true)}
          className={`min-h-[44px] rounded-full px-5 py-2.5 text-sm font-extrabold transition ${confirmClass}`}
        >
          {options.confirmLabel ?? '実行する'}
        </button>
      </div>
    </AdminModal>
  );
}
