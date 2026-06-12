import { useState } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { showAdminToast } from '../../lib/admin-toast';
import { RESERVED_SLUGS, SLUG_PATTERN } from '../../lib/slugs';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';
import { notifyLpSlugChanged } from '../../lib/lp-events';

interface Props {
  lpId: string;
  slug: string;
  isPublished: boolean;
}

type ApiError = { success: false; error: { code: string; message: string } };

const INPUT_CLASS =
  'rounded-xl border border-[#d7deea] bg-white px-3 py-2 text-sm text-[#3f4352] outline-none transition disabled:bg-[#f2f4f8] disabled:text-[#8b91a1] focus:border-[#9bb4d6] focus:ring-2 focus:ring-[#d8e3f2]';
const MONO_INPUT_CLASS = `${INPUT_CLASS} font-mono`;
const PRIMARY_BUTTON_CLASS =
  'rounded-full bg-[#567baf] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(86,123,175,0.16)] transition hover:bg-[#4c6f9f] disabled:opacity-50';
const SECONDARY_BUTTON_CLASS =
  'rounded-full bg-[#f2f4f8] px-4 py-2 text-sm font-extrabold text-[#596173] transition hover:bg-[#e9edf4] disabled:opacity-50';

export default function LpPublicUrlControl({
  lpId,
  slug: initialSlug,
  isPublished,
}: Props) {
  const origin = useAdminPublicOrigin();
  const [slug, setSlug] = useState(initialSlug);
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(initialSlug);
  const [savingSlug, setSavingSlug] = useState(false);
  const prefix = origin ? `${origin}/` : '/';
  const compactPrefix = origin ? `${origin.slice(0, 11)}.../` : '/';
  const publicUrl = `${prefix}${slug}`;

  function startEditSlug() {
    setSlugDraft(slug);
    setEditingSlug(true);
  }

  function cancelEditSlug() {
    setEditingSlug(false);
    setSlugDraft(slug);
  }

  function slugErrorFor(value: string): string | null {
    if (value.length === 0) return 'URL末尾を入力してください';
    if (value.length > 100) return '100文字以下にしてください';
    if (!SLUG_PATTERN.test(value)) {
      return '半角英数字とハイフンのみ使えます（先頭・末尾はハイフン不可）';
    }
    if (RESERVED_SLUGS.has(value)) {
      return `「${value}」はシステムで使うURLのため選べません。別のURL末尾にしてください`;
    }
    return null;
  }

  async function commitSlug() {
    const next = slugDraft.trim().toLowerCase();
    if (next === slug) {
      setEditingSlug(false);
      return;
    }
    const err = slugErrorFor(next);
    if (err) {
      showAdminToast({ tone: 'danger', message: err });
      return;
    }
    if (isPublished) {
      const confirmed = await confirmAdminAction({
        title: `公開URLを「/${next}」に変更しますか?`,
        message:
          `以前のURL「/${slug}」は404になります。\n` +
          'SNSなどに共有済みのリンクが切れるので、共有先の更新が必要です。',
        confirmLabel: '変更する',
        tone: 'warning',
      });
      if (!confirmed) return;
    }
    setSavingSlug(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: next }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '更新失敗'));
      setSlug(next);
      setEditingSlug(false);
      notifyLpSlugChanged(lpId, next);
      showAdminToast({ message: '公開URLを変更しました。' });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSavingSlug(false);
    }
  }

  return (
    <div className="mt-3 w-full max-w-full">
      <div className="space-y-2">
        <div
          className={
            editingSlug
              ? 'grid w-full min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
              : 'flex w-full min-w-0 items-center gap-1.5'
          }
        >
          {editingSlug ? (
            <>
              <div className="relative min-w-0 sm:flex sm:flex-auto sm:items-center sm:gap-2">
                <code
                  className="pointer-events-none absolute left-3 top-1 z-10 max-w-[calc(100%-1.5rem)] truncate rounded-md bg-white/90 px-1 font-mono text-[10px] font-semibold text-[#8b91a1] sm:pointer-events-auto sm:static sm:min-w-0 sm:max-w-none sm:shrink sm:bg-transparent sm:px-0 sm:text-sm"
                  title={prefix}
                >
                  {prefix}
                </code>
                <input
                  type="text"
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value)}
                  disabled={savingSlug}
                  autoFocus
                  maxLength={100}
                  className={`${MONO_INPUT_CLASS} min-w-0 w-full pt-5 sm:min-w-[7rem] sm:flex-1 sm:pt-2`}
                />
              </div>
              <div className="flex items-center justify-start gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={commitSlug}
                  disabled={savingSlug}
                  className={`${PRIMARY_BUTTON_CLASS} shrink-0`}
                >
                  {savingSlug ? '保存中...' : '保存'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditSlug}
                  disabled={savingSlug}
                  className={`${SECONDARY_BUTTON_CLASS} shrink-0 whitespace-nowrap`}
                >
                  キャンセル
                </button>
              </div>
            </>
          ) : (
            <>
              {isPublished ? (
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex min-w-0 max-w-[calc(100%-4.25rem)] items-center gap-0 rounded-xl outline-none transition hover:text-[#476895] focus-visible:ring-2 focus-visible:ring-[#d8e3f2]"
                  title="公開URLを別タブで開く"
                >
                  <code
                    className="min-w-0 shrink truncate font-mono text-[10px] font-normal tracking-[-0.05em] text-[#9aa1af] sm:text-sm sm:tracking-normal sm:text-[#8b91a1]"
                    title={prefix}
                  >
                    <span className="sm:hidden">{compactPrefix}</span>
                    <span className="hidden sm:inline">{prefix}</span>
                  </code>
                  <span className="min-w-0 shrink truncate font-mono text-sm font-extrabold leading-relaxed text-[#3f4352] transition group-hover:text-[#567baf] sm:text-base sm:text-[#3f4352]">
                    {slug}
                  </span>
                  <ExternalLink
                    className="ml-1 h-3.5 w-3.5 shrink-0 text-[#8b91a1] transition group-hover:text-[#567baf]"
                    strokeWidth={2.4}
                    aria-hidden="true"
                  />
                </a>
              ) : (
                <div className="inline-flex min-w-0 max-w-[calc(100%-4.25rem)] items-center gap-0">
                  <code
                    className="min-w-0 shrink truncate font-mono text-[10px] font-normal tracking-[-0.05em] text-[#9aa1af] sm:text-sm sm:tracking-normal sm:text-[#8b91a1]"
                    title={prefix}
                  >
                    <span className="sm:hidden">{compactPrefix}</span>
                    <span className="hidden sm:inline">{prefix}</span>
                  </code>
                  <span className="min-w-0 shrink truncate font-mono text-sm font-extrabold leading-relaxed text-[#3f4352] sm:text-base sm:text-[#3f4352]">
                    {slug}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={startEditSlug}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-extrabold text-[#567baf] transition hover:text-[#476895] sm:justify-end"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
                編集
              </button>
            </>
          )}
        </div>
        {editingSlug && isPublished && (
          <p className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-normal text-amber-700">
            公開後の変更は、以前のURLが即404になります。共有済みのリンク更新が必要です。
          </p>
        )}
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
