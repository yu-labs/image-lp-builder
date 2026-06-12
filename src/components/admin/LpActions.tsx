/**
 * LpActions
 *
 * State-transition buttons for an LP shown in the admin edit screen.
 * Renders different controls depending on current status.
 *
 * On any successful action the page reloads — simpler than threading
 * state down from server-rendered data, and matches the rest of the
 * admin which is server-rendered Astro with islands of interactivity.
 */

import { Copy, EyeOff, MoreVertical, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { checkPublishReadiness, type CheckIssue } from '../../lib/publish-check';
import type { PageContent } from '../../lib/content';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';
import { queueAdminToast, showAdminToast } from '../../lib/admin-toast';
import {
  LP_CONTENT_SAVED,
  LP_SLUG_CHANGED,
  type LpSlugChangedDetail,
} from '../../lib/lp-events';
import LpDuplicateModal from './LpDuplicateModal';
import PrePublishModal from './PrePublishModal';
import PublishSuccessModal from './PublishSuccessModal';

interface LpRef {
  id: string;
  slug: string;
  status: string;
}

const dismissKey = (lpId: string) => `lp-publish-check-dismissed:${lpId}`;
const MENU_CLOSE_DELAY_MS = 140;

interface Props {
  lp: LpRef;
  showMenu?: boolean;
  initialHasPendingChanges?: boolean;
}

type ApiError = {
  success: false;
  error: { code: string; message: string };
};

type MainActionVariant = 'publish' | 'update' | 'stop';

const MAIN_ACTION_BASE =
  'lp-action-main inline-flex min-h-[3.2rem] min-w-[9rem] cursor-pointer items-center justify-center rounded-full px-7 py-3.5 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50';

const MAIN_ACTION_VARIANTS: Record<MainActionVariant, string> = {
  publish:
    'lp-action-publish bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-[0_16px_28px_rgba(15,186,117,0.26)] hover:from-emerald-600 hover:to-emerald-800 hover:shadow-[0_18px_32px_rgba(15,186,117,0.32)]',
  update:
    'lp-action-update bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-[0_16px_28px_rgba(217,119,6,0.24)] hover:from-amber-600 hover:to-amber-800 hover:shadow-[0_18px_32px_rgba(217,119,6,0.3)]',
  stop:
    'lp-action-secondary bg-[#fff1f1] text-[#b42323] shadow-[0_12px_24px_rgba(184,50,50,0.12)] hover:bg-[#ffe4e4] hover:text-[#921b1b]',
};

function MainActionButton({
  variant,
  disabled,
  onClick,
  children,
}: {
  variant: MainActionVariant;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`${MAIN_ACTION_BASE} ${MAIN_ACTION_VARIANTS[variant]}`}
    >
      {children}
    </button>
  );
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

export default function LpActions({
  lp,
  showMenu = true,
  initialHasPendingChanges = false,
}: Props) {
  const closeTimerRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateSlugDraft, setDuplicateSlugDraft] = useState(`${lp.slug}-copy`);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [checkIssues, setCheckIssues] = useState<CheckIssue[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(
    initialHasPendingChanges
  );
  const [currentStatus, setCurrentStatus] = useState(lp.status);
  const [currentSlug, setCurrentSlug] = useState(lp.slug);
  const [statusChange, setStatusChange] = useState<
    | { kind: 'published'; publicUrl: string }
    | { kind: 'unpublished' }
    | null
  >(null);
  const origin = useAdminPublicOrigin();
  const isPublished = currentStatus === 'published';
  const isTrash = currentStatus === 'trash';

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-lp-actions-menu]')) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDesktopHover()) return;
      const target = e.target as Element | null;
      if (target?.closest('[data-lp-actions-menu]')) {
        cancelHoverClose();
        return;
      }
      scheduleHoverClose();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousemove', onMouseMove);
    return () => {
      cancelHoverClose();
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousemove', onMouseMove);
    };
  }, [menuOpen]);

  useEffect(() => {
    setHasPendingChanges(initialHasPendingChanges);
  }, [initialHasPendingChanges]);

  useEffect(() => {
    setCurrentStatus(lp.status);
  }, [lp.status]);

  useEffect(() => {
    setCurrentSlug(lp.slug);
  }, [lp.slug]);

  useEffect(() => {
    const onSlugChanged = (event: Event) => {
      const detail = (event as CustomEvent<LpSlugChangedDetail>).detail;
      if (detail?.lpId !== lp.id || !detail.slug) return;
      setCurrentSlug(detail.slug);
    };
    window.addEventListener(LP_SLUG_CHANGED, onSlugChanged);
    return () => window.removeEventListener(LP_SLUG_CHANGED, onSlugChanged);
  }, [lp.id]);

  useEffect(() => {
    if (!isPublished) return;

    const refreshPendingState = async () => {
      try {
        const res = await fetch(`/api/lps/${lp.id}`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          success: true;
          data: { hasPendingChanges?: boolean };
        };
        if (typeof json.data?.hasPendingChanges === 'boolean') {
          setHasPendingChanges(json.data.hasPendingChanges);
        }
      } catch {
        // Keep the current button state; it will recover on reload/focus.
      }
    };

    window.addEventListener(LP_CONTENT_SAVED, refreshPendingState);
    window.addEventListener('focus', refreshPendingState);
    window.addEventListener('pageshow', refreshPendingState);
    return () => {
      window.removeEventListener(LP_CONTENT_SAVED, refreshPendingState);
      window.removeEventListener('focus', refreshPendingState);
      window.removeEventListener('pageshow', refreshPendingState);
    };
  }, [isPublished, lp.id]);

  function isDesktopHover() {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  function cancelHoverClose() {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function scheduleHoverClose() {
    if (!isDesktopHover()) return;
    cancelHoverClose();
    closeTimerRef.current = window.setTimeout(() => {
      setMenuOpen(false);
      closeTimerRef.current = null;
    }, MENU_CLOSE_DELAY_MS);
  }

  function openDuplicate() {
    setMenuOpen(false);
    setDuplicateError(null);
    setDuplicateSlugDraft(`${currentSlug}-copy`);
    setDuplicateOpen(true);
    void loadDuplicateSuggestion();
  }

  async function loadDuplicateSuggestion() {
    try {
      const res = await fetch(`/api/lps/${lp.id}/duplicate`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        success: true;
        data: { slug?: string };
      };
      if (json.data.slug) setDuplicateSlugDraft(json.data.slug);
    } catch {
      // Keep the local fallback. Submit still validates on the server.
    }
  }

  async function duplicate() {
    if (busy || duplicating) return;
    const next = duplicateSlugDraft.trim().toLowerCase();
    if (next.length === 0) {
      setDuplicateError('URL末尾を入力してください。');
      return;
    }

    setDuplicating(true);
    setDuplicateError(null);
    try {
      const res = await fetch(`/api/lps/${lp.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: next }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '複製に失敗しました'));
      const json = (await res.json()) as {
        success: true;
        data: { id: string };
      };
      queueAdminToast({
        message: '複製しました。下書きで開いています。',
      });
      window.location.assign(`/admin/lps/${json.data.id}`);
    } catch (err) {
      setDuplicateError(err instanceof Error ? err.message : String(err));
    } finally {
      setDuplicating(false);
    }
  }

  async function startPublishFlow() {
    if (busy) return;
    // Dismissed for this LP — skip the check, publish immediately.
    try {
      if (window.localStorage.getItem(dismissKey(lp.id)) === '1') {
        await call('/publish');
        return;
      }
    } catch {
      // localStorage might be blocked; fall through to the modal.
    }

    setBusy(true);
    try {
      const [lpRes, trackingRes] = await Promise.all([
        fetch(`/api/lps/${lp.id}`),
        fetch('/api/tracking-tags'),
      ]);
      if (!lpRes.ok) throw new Error('LP取得に失敗しました');
      const lpJson = (await lpRes.json()) as {
        success: true;
        data: {
          content: PageContent;
          password_hash: string | null;
          publish_at: string | null;
          unpublish_at: string | null;
        };
      };
      let trackingConfigured = false;
      if (trackingRes.ok) {
        const tj = (await trackingRes.json()) as {
          success: true;
          data: {
            gtmId?: string | null;
            ga4Id?: string | null;
            clarityId?: string | null;
            metaPixelId?: string | null;
            customHead?: string | null;
          };
        };
        trackingConfigured = Boolean(
          tj.data.gtmId ||
            tj.data.ga4Id ||
            tj.data.clarityId ||
            tj.data.metaPixelId ||
            (tj.data.customHead && tj.data.customHead.trim().length > 0)
        );
      }
      const issues = checkPublishReadiness({
        content: lpJson.data.content,
        page: {
          password_hash: lpJson.data.password_hash,
          publish_at: lpJson.data.publish_at,
          unpublish_at: lpJson.data.unpublish_at,
        },
        trackingConfigured,
      });
      setCheckIssues(issues);
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `公開前チェックに失敗しました： ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmPublish(dismissForFuture: boolean) {
    if (publishing) return;
    setPublishing(true);
    try {
      if (dismissForFuture) {
        try {
          window.localStorage.setItem(dismissKey(lp.id), '1');
        } catch {
          // ignore
        }
      }
      await call('/publish');
      // Close the pre-publish modal so it doesn't sit underneath the
      // success modal. If the publish failed, call() already surfaced
      // and the user will see the editor again on its own.
      setCheckIssues(null);
    } finally {
      setPublishing(false);
    }
  }

  async function republish() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lps/${lp.id}/republish`, {
        method: 'POST',
      });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const data = (await res.json()) as ApiError;
          if (data?.error?.message) message = data.error.message;
        } catch {
          // body wasn't JSON; keep the generic message
        }
        showAdminToast({ message: `エラー： ${message}`, tone: 'danger' });
        return;
      }
      setHasPendingChanges(false);
      showAdminToast({ message: '公開URLに反映しました', tone: 'success' });
    } catch (err) {
      showAdminToast({
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmUnpublish() {
    const confirmed = await confirmAdminAction({
      title: '公開を停止しますか?',
      message:
        '公開URLは「掲載終了しました」ページに切り替わります。\n編集内容は残るので、あとから再公開できます。',
      confirmLabel: '公開を停止する',
      tone: 'danger',
    });
    if (confirmed) void call('/unpublish');
  }

  async function call(path: string, method: 'POST' | 'DELETE' = 'POST') {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lps/${lp.id}${path}`, { method });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const data = (await res.json()) as ApiError;
          if (data?.error?.message) message = data.error.message;
        } catch {
          // body wasn't JSON; keep the generic message
        }
        showAdminToast({ tone: 'danger', message: `エラー： ${message}` });
        return;
      }
      let data: { slug?: string } | null = null;
      try {
        const json = (await res.json()) as {
          success: true;
          data?: { slug?: string };
        };
        data = json.data ?? null;
      } catch {
        // Some future endpoint may return no JSON body.
      }
      // Status-change actions get a dedicated success modal so the
      // operator gets a confirmation beat (and the public URL on
      // publish) before the page reloads.
      if (path === '/publish') {
        const publishedSlug = data?.slug ?? currentSlug;
        setCurrentStatus('published');
        setHasPendingChanges(false);
        setCurrentSlug(publishedSlug);
        setStatusChange({
          kind: 'published',
          publicUrl: origin ? `${origin}/${publishedSlug}` : `/${publishedSlug}`,
        });
        return;
      }
      if (path === '/unpublish') {
        setCurrentStatus('archived');
        setHasPendingChanges(false);
        setStatusChange({ kind: 'unpublished' });
        return;
      }
      if (method === 'DELETE') {
        queueAdminToast({
          tone: 'danger',
          message: isPublished
            ? '公開を停止して削除しました。7日後に完全削除されます。'
            : '削除しました。7日後に完全削除されます。',
        });
        window.location.assign('/admin');
        return;
      }
      window.location.reload();
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `通信エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <div className="lp-actions-root flex gap-2 items-center flex-wrap">
      {isTrash ? (
        <span className="px-3 py-2 text-sm text-gray-500">
          ゴミ箱に入っています（復元機能は今後実装）
        </span>
      ) : (
        <>
          {isPublished && hasPendingChanges ? (
            <MainActionButton
              variant="update"
              disabled={busy}
              onClick={republish}
            >
              {busy ? '再公開中...' : '再公開する'}
            </MainActionButton>
          ) : isPublished ? (
            <MainActionButton
              variant="stop"
              disabled={busy}
              onClick={confirmUnpublish}
            >
              公開を停止
            </MainActionButton>
          ) : (
            <MainActionButton
              variant="publish"
              disabled={busy}
              onClick={startPublishFlow}
            >
              公開する
            </MainActionButton>
          )}

          {showMenu && (
            <div
              className="relative"
              data-lp-actions-menu
              onMouseEnter={cancelHoverClose}
              onMouseLeave={scheduleHoverClose}
            >
              <button
                type="button"
                aria-label="メニューを開く"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="lp-action-menu-button rounded-full p-3 sm:p-2 text-gray-500 hover:bg-gray-100"
              >
                <MoreVertical size={23} strokeWidth={2.4} aria-hidden="true" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="lp-action-menu absolute right-0 top-full z-10 mt-2 min-w-[220px] rounded-2xl border border-white/80 bg-white/95 p-2 shadow-[0_18px_44px_rgba(31,34,48,0.16)] backdrop-blur-xl"
                  onMouseEnter={cancelHoverClose}
                  onMouseLeave={scheduleHoverClose}
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy || duplicating}
                    onClick={openDuplicate}
                    className="flex w-full cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 text-left transition hover:bg-[#567baf]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#567baf]/12 text-[#567baf]">
                      <Copy size={16} strokeWidth={2.3} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-[#3f4352]">
                        {duplicating ? '複製中...' : '複製して作る'}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-[#7f8797]">
                        同じ内容で別URLのLPを作成
                      </span>
                    </span>
                  </button>
                  {isPublished && hasPendingChanges && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={() => {
                        setMenuOpen(false);
                        void confirmUnpublish();
                      }}
                      className="mt-1 flex w-full cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 text-left transition hover:bg-[#567baf]/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#567baf]/12 text-[#567baf]">
                        <EyeOff size={16} strokeWidth={2.3} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-[#3f4352]">
                          公開を停止する
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-[#7f8797]">
                          公開URLを見られなくします
                        </span>
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={async () => {
                      setMenuOpen(false);
                      const confirmed = await confirmAdminAction({
                        title: isPublished
                          ? '公開を停止して削除しますか?'
                          : 'このLPを削除しますか?',
                        message: isPublished
                          ? '公開URLは見られなくなります。削除したLPは下書きに戻せますが、公開は再開されません。\n7日後に完全削除されます。'
                          : '削除したLPは下書きに戻せます。\n7日後に完全削除されます。',
                        confirmLabel: isPublished
                          ? '公開停止して削除'
                          : '削除する',
                        tone: 'danger',
                      });
                      if (confirmed) void call('', 'DELETE');
                    }}
                    className="mt-1 flex w-full cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 text-left transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                      <Trash2 size={16} strokeWidth={2.3} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-red-700">
                        {isPublished ? '公開を停止して削除する' : '削除する'}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-red-500">
                        {isPublished
                          ? '公開停止後、7日後に完全削除'
                          : '7日後に完全削除されます'}
                      </span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
    {duplicateOpen && (
      <LpDuplicateModal
        slug={duplicateSlugDraft}
        busy={duplicating}
        error={duplicateError}
        onSlugChange={setDuplicateSlugDraft}
        onSubmit={() => void duplicate()}
        onClose={() => setDuplicateOpen(false)}
      />
    )}
    {checkIssues !== null && (
      <PrePublishModal
        lpId={lp.id}
        issues={checkIssues}
        publishing={publishing}
        onConfirm={confirmPublish}
        onClose={() => setCheckIssues(null)}
      />
    )}
    {statusChange !== null && (
      <PublishSuccessModal
        kind={statusChange.kind}
        publicUrl={
          statusChange.kind === 'published' ? statusChange.publicUrl : undefined
        }
        onClose={() => {
          setStatusChange(null);
          window.location.reload();
        }}
      />
    )}
    </>
  );
}
