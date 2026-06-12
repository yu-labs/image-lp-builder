export type AdminToastTone = 'success' | 'danger' | 'info';

export interface AdminToastMessage {
  message: string;
  tone?: AdminToastTone;
}

export const ADMIN_TOAST_EVENT = 'ilpb-admin-toast';

const STORAGE_KEY = 'ilpb-admin-toast';

export function showAdminToast(toast: AdminToastMessage): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<AdminToastMessage>(ADMIN_TOAST_EVENT, {
      detail: normalizeToast(toast),
    })
  );
}

export function queueAdminToast(toast: AdminToastMessage): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeToast(toast))
    );
  } catch {
    // Ignore storage failures; the action itself already succeeded.
  }
}

export function consumeQueuedAdminToast(): AdminToastMessage | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<AdminToastMessage>;
    if (typeof parsed.message !== 'string' || parsed.message.length === 0) {
      return null;
    }
    return normalizeToast(parsed as AdminToastMessage);
  } catch {
    return null;
  }
}

function normalizeToast(toast: AdminToastMessage): AdminToastMessage {
  return {
    tone: toast.tone ?? 'success',
    message: formatToastMessage(toast.message),
  };
}

function formatToastMessage(message: string): string {
  return message
    .trim()
    .replace(/。(?=\S)/g, '。\n');
}
