export type AdminConfirmTone = 'default' | 'danger' | 'warning';

export interface AdminConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: AdminConfirmTone;
}

export interface AdminConfirmRequest {
  options: AdminConfirmOptions;
  respond: (confirmed: boolean) => void;
}

export const ADMIN_CONFIRM_EVENT = 'ilpb-admin-confirm';

export function confirmAdminAction(
  options: AdminConfirmOptions
): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const normalized = normalizeOptions(options);
    const respond = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      resolve(confirmed);
    };

    const event = new CustomEvent<AdminConfirmRequest>(ADMIN_CONFIRM_EVENT, {
      cancelable: true,
      detail: {
        options: normalized,
        respond,
      },
    });

    const handled = !window.dispatchEvent(event);
    if (handled) return;
    void openFallbackConfirm(normalized).then(respond);
  });
}

function normalizeOptions(options: AdminConfirmOptions): AdminConfirmOptions {
  return {
    ...options,
    confirmLabel: options.confirmLabel ?? '実行する',
    cancelLabel: options.cancelLabel ?? 'キャンセル',
    tone: options.tone ?? 'default',
  };
}

function openFallbackConfirm(options: AdminConfirmOptions): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    const previousActive =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'presentation');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '9999',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      background: 'rgba(17, 24, 39, 0.42)',
    });

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'admin-confirm-fallback-title');
    Object.assign(dialog.style, {
      width: 'min(100%, 28rem)',
      borderRadius: '1rem',
      background: '#ffffff',
      padding: '1.25rem',
      boxShadow: '0 24px 60px rgba(31, 34, 48, 0.24)',
      color: '#3f4352',
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
    });

    const badge = document.createElement('div');
    badge.textContent = '確認';
    Object.assign(badge.style, {
      display: 'inline-flex',
      marginBottom: '1rem',
      borderRadius: '9999px',
      padding: '0.25rem 0.75rem',
      fontSize: '0.75rem',
      fontWeight: '800',
      background:
        options.tone === 'danger'
          ? '#fef2f2'
          : options.tone === 'warning'
            ? '#fffbeb'
            : '#eef4fb',
      color:
        options.tone === 'danger'
          ? '#b91c1c'
          : options.tone === 'warning'
            ? '#b45309'
            : '#567baf',
    });

    const title = document.createElement('h2');
    title.id = 'admin-confirm-fallback-title';
    title.textContent = options.title;
    Object.assign(title.style, {
      margin: '0',
      fontSize: '1.25rem',
      lineHeight: '1.35',
      fontWeight: '800',
    });

    const message = document.createElement('p');
    message.textContent = options.message ?? '';
    Object.assign(message.style, {
      display: options.message ? 'block' : 'none',
      margin: '0.75rem 0 0',
      whiteSpace: 'pre-line',
      color: '#687082',
      fontSize: '0.875rem',
      lineHeight: '1.7',
      fontWeight: '600',
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '0.5rem',
      marginTop: '1.5rem',
      flexWrap: 'wrap',
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = options.cancelLabel ?? 'キャンセル';
    Object.assign(cancelButton.style, {
      minHeight: '44px',
      border: '0',
      borderRadius: '9999px',
      padding: '0.625rem 1.25rem',
      background: '#f2f4f8',
      color: '#596173',
      fontSize: '0.875rem',
      fontWeight: '800',
      cursor: 'pointer',
    });

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = options.confirmLabel ?? '実行する';
    Object.assign(confirmButton.style, {
      minHeight: '44px',
      border: '0',
      borderRadius: '9999px',
      padding: '0.625rem 1.25rem',
      background:
        options.tone === 'danger'
          ? '#b83232'
          : options.tone === 'warning'
            ? '#d97706'
            : '#567baf',
      color: '#ffffff',
      fontSize: '0.875rem',
      fontWeight: '800',
      cursor: 'pointer',
    });

    function close(confirmed: boolean) {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      previousActive?.focus();
      resolve(confirmed);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close(false);
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false);
    });
    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKeyDown);

    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    dialog.appendChild(badge);
    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    cancelButton.focus();
  });
}
