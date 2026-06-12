export const SITE_SETTINGS_STATUS_CHANGED = 'ilpb-site-settings-status-changed';

export function notifySiteSettingsStatusChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SITE_SETTINGS_STATUS_CHANGED));
}
