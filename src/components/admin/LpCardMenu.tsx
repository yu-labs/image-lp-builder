import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Copy, MoreVertical, Trash2, X } from 'lucide-react';
import { queueAdminToast } from '../../lib/admin-toast';
import AdminModal from './AdminModal';
import AdminImagePlaceholder from './AdminImagePlaceholder';
import LpDuplicateModal from './LpDuplicateModal';

type LpStatus = 'draft' | 'published' | 'preview' | 'archived' | 'trash';

interface LpCardRef {
  id: string;
  slug: string;
  status: LpStatus;
  thumbnail: string;
}

interface Props {
  lp: LpCardRef;
}

type ApiError = {
  success: false;
  error: { code: string; message: string };
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
};

const MENU_WIDTH = 256;
const MENU_HEIGHT_ESTIMATE = 180;
const MENU_GAP = 8;
const VIEWPORT_MARGIN = 12;
const DESKTOP_CARD_PADDING = 12;
const DESKTOP_BREAKPOINT = '(min-width: 769px)';
const MENU_CLOSE_DELAY_MS = 140;

export default function LpCardMenu({ lp }: Props) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [slugDraft, setSlugDraft] = useState(`${lp.slug}-copy`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    updateMenuPosition();
    const card = buttonRef.current?.closest('.lp-card');
    card?.classList.add('lp-card-menu-open');
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(`[data-lp-card-menu="${lp.id}"]`)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onReposition = () => updateMenuPosition();
    const onMouseMove = (event: MouseEvent) => {
      if (!isDesktopHover()) return;
      const target = event.target as Element | null;
      const currentCard = buttonRef.current?.closest('.lp-card');
      if (
        target?.closest(`[data-lp-card-menu="${lp.id}"]`) ||
        (target && currentCard?.contains(target))
      ) {
        cancelHoverClose();
        return;
      }
      scheduleHoverClose();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      cancelHoverClose();
      card?.classList.remove('lp-card-menu-open');
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [lp.id, menuOpen]);

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

  function updateMenuPosition() {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const isDesktop = window.matchMedia(DESKTOP_BREAKPOINT).matches;
    const card = button.closest('.lp-card');

    if (isDesktop && card) {
      const cardRect = card.getBoundingClientRect();
      const width = Math.min(
        MENU_WIDTH,
        Math.max(180, cardRect.width - DESKTOP_CARD_PADDING * 2)
      );
      const left = Math.min(
        Math.max(cardRect.left + DESKTOP_CARD_PADDING, rect.right - width),
        cardRect.right - width - DESKTOP_CARD_PADDING
      );
      const top = Math.min(
        Math.max(
          cardRect.top + DESKTOP_CARD_PADDING,
          rect.top - MENU_HEIGHT_ESTIMATE - MENU_GAP
        ),
        cardRect.bottom - MENU_HEIGHT_ESTIMATE - DESKTOP_CARD_PADDING
      );

      setMenuPosition({ left, top, width });
      return;
    }

    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const width = Math.min(MENU_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN + viewportLeft, rect.right - width),
      viewportRight - width - VIEWPORT_MARGIN
    );
    const topBelow = rect.bottom + MENU_GAP;
    const topAbove = rect.top - MENU_HEIGHT_ESTIMATE - MENU_GAP;
    const top =
      topBelow + MENU_HEIGHT_ESTIMATE > viewportBottom - VIEWPORT_MARGIN &&
      topAbove > viewportTop + VIEWPORT_MARGIN
        ? topAbove
        : topBelow;

    setMenuPosition({ left, top, width });
  }

  function toggleMenu() {
    if (!menuOpen) updateMenuPosition();
    setMenuOpen((value) => !value);
  }

  function openDuplicate() {
    setMenuOpen(false);
    setError(null);
    setSlugDraft(`${lp.slug}-copy`);
    setDuplicateOpen(true);
    void loadDuplicateSuggestion();
  }

  function openDelete() {
    setMenuOpen(false);
    setError(null);
    setDeleteOpen(true);
  }

  async function duplicate() {
    if (busy) return;
    const slug = slugDraft.trim().toLowerCase();
    if (!slug) {
      setError('URL末尾を入力してください。');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lps/${lp.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadDuplicateSuggestion() {
    try {
      const res = await fetch(`/api/lps/${lp.id}/duplicate`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        success: true;
        data: { slug?: string };
      };
      if (json.data.slug) setSlugDraft(json.data.slug);
    } catch {
      // Keep the local fallback. Submit still validates on the server.
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lps/${lp.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, '削除に失敗しました'));
      queueAdminToast({
        tone: 'danger',
        message: isPublished
          ? '公開を停止して削除しました。7日後に完全削除されます。'
          : '削除しました。7日後に完全削除されます。',
      });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const isPublished = lp.status === 'published';

  return (
    <div
      className="absolute bottom-2 right-2 z-20"
      data-lp-card-menu={lp.id}
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={cancelHoverClose}
      onMouseLeave={scheduleHoverClose}
    >
      <button
        type="button"
        aria-label={`${lp.slug}の操作メニュー`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        ref={buttonRef}
        onClick={toggleMenu}
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-[#7f8797] transition hover:bg-white/75 hover:text-[#567baf] hover:shadow-[0_10px_24px_rgba(31,34,48,0.1)]"
      >
        <MoreVertical size={21} strokeWidth={2.4} aria-hidden="true" />
      </button>

      {menuOpen && menuPosition && (
        <Portal>
          <div
            role="menu"
            data-lp-card-menu={lp.id}
            className="fixed z-[100] overflow-hidden rounded-2xl border border-white/75 bg-white/90 p-1.5 text-left shadow-[0_22px_50px_rgba(31,34,48,0.18)] backdrop-blur-xl"
            onMouseEnter={cancelHoverClose}
            onMouseLeave={scheduleHoverClose}
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              width: menuPosition.width,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={openDuplicate}
              className="flex w-full cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 text-left transition hover:bg-[#567baf]/10"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#567baf]/12 text-[#567baf]">
                <Copy size={16} strokeWidth={2.3} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-[#3f4352]">
                  複製して作る
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[#7f8797]">
                  同じ内容で別URLのLPを作成
                </span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={openDelete}
              className="mt-1 flex w-full cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 text-left transition hover:bg-red-50"
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
        </Portal>
      )}

      {duplicateOpen && (
        <LpDuplicateModal
          slug={slugDraft}
          busy={busy}
          error={error}
          preview={<LpPreview lp={lp} />}
          onSlugChange={setSlugDraft}
          onSubmit={() => void duplicate()}
          onClose={() => setDuplicateOpen(false)}
        />
      )}

      {deleteOpen && (
        <ActionModal
          title={isPublished ? '公開を停止して削除しますか?' : 'このLPを削除しますか?'}
          onClose={() => !busy && setDeleteOpen(false)}
        >
          <div className="space-y-4">
            <LpPreview lp={lp} />
            <p className="text-sm leading-relaxed text-gray-600">
              {isPublished
                ? 'このLPの公開URLは見られなくなります。削除したLPから下書きに戻せますが、公開は再開されません。7日後に完全削除されます。'
                : '削除したLPからあとで復元できます。7日後に完全削除されます。'}
            </p>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteOpen(false)}
                className="rounded-full px-4 py-2 text-sm font-semibold text-[#596173] hover:bg-[#f2f4f8] disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(220,38,38,0.22)] hover:bg-red-700 disabled:opacity-50"
              >
                {busy
                  ? '削除中...'
                  : isPublished
                    ? '公開を停止して削除する'
                    : '削除する'}
              </button>
            </div>
          </div>
        </ActionModal>
      )}
    </div>
  );
}

function ActionModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <AdminModal
      ariaLabel={title}
      zIndexClass="z-50"
      onClose={onClose}
      panelClassName="p-5 sm:p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-base font-bold text-[#3f4352]">{title}</h2>
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#9aa1ae] transition hover:bg-[#f2f4f8] hover:text-[#3f4352]"
        >
          <X size={18} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
      {children}
    </AdminModal>
  );
}

function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

function LpPreview({ lp }: { lp: LpCardRef }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = lp.thumbnail !== '/no-image.svg' && !imageFailed;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#e2e7f0] bg-white/75 p-2 shadow-[0_10px_24px_rgba(31,34,48,0.05)]">
      {showImage ? (
        <img
          src={lp.thumbnail}
          alt={lp.slug}
          className="h-16 w-20 shrink-0 rounded-xl bg-gray-100 object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <AdminImagePlaceholder
          className="h-16 w-20"
          iconClassName="h-9 w-9"
          iconSize={28}
        />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-[#3f4352]">/{lp.slug}</p>
        <p className="mt-1 text-xs text-[#8b91a1]">選択中のLP</p>
      </div>
    </div>
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
