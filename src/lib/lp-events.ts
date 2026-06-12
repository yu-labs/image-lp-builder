/**
 * Cross-island events for the LP edit screen.
 *
 * The admin edit page mounts several React islands that don't share
 * state (SectionList, CtaEditor (via SectionList), PromotionsPanel,
 * LpMetaPanel, PublishPanel, ...). When one island writes a new
 * `content` JSON, the others need to know so they can refresh
 * derived state (e.g. PublishPanel's "未反映の変更" badge).
 *
 * A window-scoped CustomEvent is the lightest coordination mechanism
 * that doesn't require dragging a context provider through Astro
 * islands or routing every save through a parent prop callback.
 */

export const LP_CONTENT_SAVED = 'lp:contentSaved';
export const LP_PASSWORD_STATE_CHANGED = 'lp:passwordStateChanged';
export const LP_SCHEDULE_STATE_CHANGED = 'lp:scheduleStateChanged';
export const LP_SLUG_CHANGED = 'lp:slugChanged';

export interface LpSlugChangedDetail {
  lpId: string;
  slug: string;
}

export function notifyLpContentSaved(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LP_CONTENT_SAVED));
}

export function notifyLpPasswordStateChanged(protectedState: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(LP_PASSWORD_STATE_CHANGED, {
      detail: { protected: protectedState },
    })
  );
}

export function notifyLpScheduleStateChanged(hasSchedule: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(LP_SCHEDULE_STATE_CHANGED, {
      detail: { hasSchedule },
    })
  );
}

export function notifyLpSlugChanged(lpId: string, slug: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<LpSlugChangedDetail>(LP_SLUG_CHANGED, {
      detail: { lpId, slug },
    })
  );
}
