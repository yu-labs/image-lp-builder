/**
 * NewLpForm
 *
 * Form for creating a new LP. The slug becomes the public URL path,
 * so the field is given top billing with a live URL preview to make
 * the URL-shape obvious before the user commits.
 *
 * Validation mirrors POST /api/lps server-side rules but happens
 * client-first for fast feedback. The server is still the source of
 * truth (uniqueness, reserved words, etc.).
 */

import { useState } from 'react';
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from '../../lib/slugs';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';

const SLUG_MIN = SLUG_MIN_LENGTH;
const SLUG_MAX = SLUG_MAX_LENGTH;
const TITLE_MAX = 80;

type ApiError = { success: false; error: { code: string; message: string } };

export default function NewLpForm() {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const origin = useAdminPublicOrigin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror the server's normalization so the preview matches what's
  // actually saved.
  const normalized = slug.trim().toLowerCase();
  const normalizedTitle = title.trim();
  const titleError = clientValidateTitle(normalizedTitle);
  const slugError = clientValidate(normalized);
  const urlPrefix = origin || 'https://...';

  const previewUrl = normalized
    ? `${urlPrefix}/${normalized}`
    : `${urlPrefix}/自動で作成`;

  async function submit() {
    if (busy) return;
    setError(null);

    if (titleError || slugError) {
      setError(titleError ?? slugError);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/lps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: normalizedTitle, slug: normalized }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, '作成失敗'));
      }
      const json = (await res.json()) as {
        success: true;
        data: { id: string };
      };
      window.location.href = `/admin/lps/${json.data.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function onSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    void submit();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-sm font-extrabold text-[#3f4352]">LP名</span>
            <span className="text-xs font-bold text-red-600">必須</span>
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：AIキャンプ春募集LP"
            required
            maxLength={TITLE_MAX}
            autoFocus
            className="w-full rounded-xl border border-[#d7deea] bg-white/95 px-3.5 py-3.5 text-base font-bold text-[#3f4352] outline-none transition placeholder:font-semibold placeholder:text-[#a0a7b4] focus:border-[#567baf] focus:ring-2 focus:ring-[#567baf]/20"
          />
          <span className="mt-1.5 block text-xs font-semibold leading-[1.45] text-[#8b91a1]">
            一覧で見分ける名前です。後で編集できます。
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-sm font-extrabold text-[#3f4352]">URL末尾</span>
            <span className="text-xs font-bold text-[#8b91a1]">空欄で自動作成</span>
          </span>
          <div className="relative min-w-0 overflow-hidden rounded-xl border border-[#d7deea] bg-white/95 transition focus-within:border-[#567baf] focus-within:ring-2 focus-within:ring-[#567baf]/20 sm:flex">
            <code
              className="pointer-events-none absolute left-3 top-1 z-10 max-w-[calc(100%-1.5rem)] truncate rounded-md bg-white/90 px-1 font-mono text-[10px] font-semibold text-[#8b91a1] sm:pointer-events-auto sm:static sm:flex sm:max-w-[48%] sm:shrink-0 sm:items-center sm:rounded-l-xl sm:rounded-r-none sm:border-r sm:border-[#d7deea] sm:bg-[#f6f8fb] sm:px-3 sm:py-3.5 sm:text-sm"
              title={`${urlPrefix}/`}
            >
              {urlPrefix}/
            </code>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-lp"
              maxLength={SLUG_MAX}
              // Pattern mirrors src/lib/slugs.ts:SLUG_PATTERN. The `pattern`
              // attribute anchors implicitly so omit the ^ / $.
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              title="半角英数字とハイフンのみ（先頭・末尾はハイフン不可）"
              className="min-w-0 w-full flex-1 bg-transparent px-3 pb-2.5 pt-5 font-mono text-base font-bold text-[#3f4352] outline-none placeholder:text-[#a0a7b4] sm:w-auto sm:py-3.5"
            />
          </div>
          <span className="mt-1.5 block text-xs font-semibold leading-[1.45] text-[#8b91a1]">
            半角英数字とハイフンのみ使えます。後で編集できます。
          </span>
        </label>
      </div>

      <div className="rounded-xl bg-[#f8fafc] px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(215,222,234,0.72)]">
        <p className="text-xs font-extrabold text-[#687082]">作成されるURL</p>
        <code className="mt-1 flex min-h-[1.7rem] items-center break-all font-mono text-sm font-bold leading-[1.35] text-[#567baf]">
          {previewUrl}
        </code>
      </div>

      {(titleError || slugError || error) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold leading-[1.55] text-red-700">
          {error ?? titleError ?? slugError}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
        <a
          href="/admin"
          className="inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-bold text-[#596173] transition hover:bg-white/80"
        >
          キャンセル
        </a>
        <button
          type="submit"
          disabled={
            busy ||
            !!titleError ||
            !!slugError ||
            normalizedTitle.length === 0
          }
          className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-[#567baf] px-6 text-base font-extrabold text-white shadow-[0_12px_24px_rgba(86,123,175,0.22)] transition hover:bg-[#4c6f9f] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-11 sm:w-auto sm:text-sm"
        >
          {busy ? '作成中...' : 'LPを作成'}
        </button>
      </div>
    </form>
  );
}

function clientValidateTitle(title: string): string | null {
  if (title.length === 0) return null; // empty -> no error yet
  if (title.length > TITLE_MAX) return `${TITLE_MAX}文字以下で入力してください`;
  return null;
}

function clientValidate(slug: string): string | null {
  if (slug.length === 0) return null; // empty -> no error yet
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX)
    return `${SLUG_MIN}〜${SLUG_MAX}文字で入力してください`;
  if (!SLUG_PATTERN.test(slug))
    return '半角英数字とハイフンのみ使えます（先頭・末尾はハイフン不可）';
  if (RESERVED_SLUGS.has(slug))
    return `「${slug}」はシステムで使うURLのため選べません。別のURL末尾にしてください`;
  return null;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
