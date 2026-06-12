/**
 * TrashSection
 *
 * Collapsible trash bin shown beneath the LP grid on /admin. Lists
 * soft-deleted LPs newest-first and exposes two actions per row:
 *
 *   - 復元 (restore)   → moves the LP back to draft
 *   - 完全削除 (purge) → drops the row from D1, irreversibly
 *
 * Purge confirms with the user via a typed-slug modal so a stray
 * click can't wipe a real LP.
 */

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import AdminImagePlaceholder from './AdminImagePlaceholder';
import AdminModal from './AdminModal';
import CollapseToggleIcon from './CollapseToggleIcon';
import { queueAdminToast, showAdminToast } from '../../lib/admin-toast';
import { parseContent } from '../../lib/content';

interface TrashedLp {
  id: string;
  slug: string;
  title: string | null;
  content: string;
  trashed_at: string | null;
  updated_at: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

export default function TrashSection() {
  const [items, setItems] = useState<TrashedLp[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashedLp | null>(null);
  const [purgeInput, setPurgeInput] = useState('');
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (collapsed) return;
    window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const rect = panel.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const bottomPadding = window.matchMedia('(max-width: 640px)').matches
        ? 96
        : 24;
      const hiddenBottom = rect.bottom - viewportHeight + bottomPadding;

      if (hiddenBottom > 0) {
        window.scrollBy({
          top: hiddenBottom,
          behavior: 'smooth',
        });
      }
    });
  }, [collapsed]);

  async function load() {
    try {
      const res = await fetch('/api/lps/trash');
      if (!res.ok) throw new Error(await readApiError(res, 'ゴミ箱取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { pages: TrashedLp[] };
      };
      setItems(json.data.pages);
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }

  async function restore(item: TrashedLp) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/lps/${item.id}/restore`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await readApiError(res, '復元失敗'));
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      queueAdminToast({
        message: '下書きに戻しました。公開は再開されていません。',
      });
      // Reload the page so the LP shows up in the main grid above.
      window.location.reload();
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusyId(null);
    }
  }

  function openPurge(item: TrashedLp) {
    setPurgeTarget(item);
    setPurgeInput('');
    setPurgeError(null);
  }

  function closePurge() {
    if (busyId) return;
    setPurgeTarget(null);
    setPurgeInput('');
    setPurgeError(null);
  }

  async function purge(item: TrashedLp) {
    if (busyId) return;
    if (purgeInput.trim() !== item.slug) {
      setPurgeError('URL末尾が一致していません。');
      return;
    }
    setBusyId(item.id);
    setPurgeError(null);
    try {
      const res = await fetch(`/api/lps/${item.id}/purge`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readApiError(res, '削除失敗'));
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      setPurgeTarget(null);
      setPurgeInput('');
      showAdminToast({ tone: 'danger', message: '完全に削除しました。' });
    } catch (err) {
      setPurgeError(`エラー： ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return null; // don't show the section while we're checking

  const hasTrash = items.length > 0;

  if (!hasTrash) {
    return (
      <section className="mt-8 rounded-2xl border border-white/75 bg-white/62 px-5 py-4 text-[#8b91a1] shadow-[0_12px_30px_rgba(31,34,48,0.05)] backdrop-blur-xl">
        <h2 className="text-sm font-bold text-[#596173]">削除したLPはありません</h2>
        <p className="mt-1 text-xs">削除するとここに表示されます</p>
      </section>
    );
  }

  return (
    <section className={collapsed ? 'mt-8' : 'mt-8 pb-24 sm:pb-0'}>
      <div className="overflow-hidden rounded-2xl border border-white/75 bg-white/76 shadow-[0_16px_38px_rgba(31,34,48,0.07)] backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-[#596173] transition hover:bg-[#567baf]/7"
        >
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#3f4352]">削除したLP {items.length}件</h2>
            <p className="mt-1 text-xs text-[#8b91a1]">
              復元すると下書きに戻ります
            </p>
          </div>
          <CollapseToggleIcon open={!collapsed} />
        </button>

      {!collapsed && (
        <div
          ref={panelRef}
          data-trash-panel="true"
          className="border-t border-[#e2e7f0]/80 bg-[#f6f8fb]/70 p-3 sm:p-4"
        >
          <div className="space-y-3">
            {items.map((item) => {
              const thumbnail = trashThumbnail(item);
              const displayTitle = item.title?.trim() || item.slug;
              return (
                <article
                  key={item.id}
                  className="flex gap-3 rounded-2xl border border-white/75 bg-white/88 p-2 shadow-[0_10px_26px_rgba(31,34,48,0.05)] sm:items-center sm:p-3"
                >
                  <TrashThumbnail src={thumbnail} alt={displayTitle} />
                  <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-[#3f4352]">
                        {displayTitle}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-[#8b91a1]">
                        /{item.slug}
                      </div>
                      <div className="mt-1 text-xs text-[#8b91a1]">
                        削除日 {formatTrashDate(item.trashed_at)}
                      </div>
                      <div className="mt-1 text-xs text-[#8b91a1]">
                        公開は再開されません
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 sm:mt-0 sm:shrink-0 sm:flex-nowrap">
                      <button
                        type="button"
                        onClick={() => restore(item)}
                        disabled={busyId !== null}
                        className="rounded-full bg-[#567baf]/10 px-3 py-2 text-xs font-bold text-[#567baf] transition hover:bg-[#567baf] hover:text-white disabled:opacity-50"
                      >
                        {busyId === item.id ? '...' : '下書きに戻す'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openPurge(item)}
                        disabled={busyId !== null}
                        className="rounded-full px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        完全削除
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
      </div>
      {purgeTarget && (
        <PurgeModal
          item={purgeTarget}
          value={purgeInput}
          error={purgeError}
          busy={busyId === purgeTarget.id}
          onValueChange={setPurgeInput}
          onClose={closePurge}
          onSubmit={() => void purge(purgeTarget)}
        />
      )}
    </section>
  );
}

function PurgeModal({
  item,
  value,
  error,
  busy,
  onValueChange,
  onClose,
  onSubmit,
}: {
  item: TrashedLp;
  value: string;
  error: string | null;
  busy: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const displayTitle = item.title?.trim() || item.slug;

  return (
    <AdminModal
      as="form"
      ariaLabel="LPを完全削除"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      panelClassName="p-5 sm:p-6"
    >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-bold text-[#3f4352]">
              完全に削除しますか?
            </h2>
            <p className="text-xs font-semibold leading-[1.45] text-[#8b91a1]">
              この操作は取り消せません。確認のためURL末尾を入力してください。
            </p>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            disabled={busy}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#9aa1ae] transition hover:bg-[#f2f4f8] hover:text-[#3f4352] disabled:opacity-50"
          >
            <X size={18} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>

        <div className="rounded-2xl border border-[#e2e7f0] bg-[#f6f8fb] p-3">
          <p className="truncate text-sm font-bold text-[#3f4352]">
            {displayTitle}
          </p>
          <p className="mt-1 font-mono text-xs text-[#8b91a1]">/{item.slug}</p>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-[#3f4352]">URL末尾</span>
          <input
            value={value}
            onChange={(event) => onValueChange(event.currentTarget.value)}
            className="mt-2 w-full rounded-xl border border-[#d7deea] px-3 py-3 text-base text-[#3f4352] outline-none focus:border-[#9bb4d6] focus:ring-2 focus:ring-[#d8e3f2]"
            placeholder={item.slug}
            autoFocus
          />
        </label>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-semibold text-[#596173] hover:bg-[#f2f4f8] disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(220,38,38,0.22)] hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? '削除中...' : '完全削除する'}
          </button>
        </div>
    </AdminModal>
  );
}

function TrashThumbnail({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <AdminImagePlaceholder className="h-20 w-24" />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="h-20 w-24 shrink-0 rounded-xl bg-[#f3f1f7] object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function trashThumbnail(item: TrashedLp): string | null {
  const content = parseContent(item.content);
  return content.meta?.ogImage || content.sections[0]?.image.url || null;
}

function formatTrashDate(value: string | null): string {
  if (!value) return '不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
