/**
 * SiteMetaPanel
 *
 * One source image -> two shipped variants:
 *   - Favicon (48px)            for browser tabs
 *   - Apple Touch Icon (180px)  for iOS home screens
 *
 * The self-hoster uploads once; the client compresses to both sizes
 * (browser-image-compression) and stores the two resulting R2 URLs
 * on the site_meta singleton.
 */

import { useEffect, useRef, useState } from 'react';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { showAdminToast } from '../../lib/admin-toast';
import { notifySiteSettingsStatusChanged } from '../../lib/site-settings-events';
import { uploadIconSet } from '../../lib/upload';

type ApiError = { success: false; error: { code: string; message: string } };

interface SiteMetaForm {
  faviconUrl: string | null;
  appleTouchIconUrl: string | null;
}

const EMPTY: SiteMetaForm = {
  faviconUrl: null,
  appleTouchIconUrl: null,
};

interface Props {
  hideHeading?: boolean;
}

export default function SiteMetaPanel({ hideHeading = false }: Props) {
  const [data, setData] = useState<SiteMetaForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void load();
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 4000);
  }

  async function load() {
    try {
      const res = await fetch('/api/site-meta');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { faviconUrl: string | null; appleTouchIconUrl: string | null };
      };
      setData({
        faviconUrl: json.data.faviconUrl ?? null,
        appleTouchIconUrl: json.data.appleTouchIconUrl ?? null,
      });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }

  async function patch(body: Record<string, string | null>) {
    const res = await fetch('/api/site-meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
    const json = (await res.json()) as {
      success: true;
      data: SiteMetaForm;
    };
    setData(json.data);
    notifySiteSettingsStatusChanged();
  }

  async function handleFile(file: File) {
    if (busy) return;
    setBusy(true);
    try {
      setStage('画像を変換中...');
      const { faviconUrl, appleTouchIconUrl } = await uploadIconSet(file);
      setStage('保存中...');
      await patch({ faviconUrl, appleTouchIconUrl });
      showNotice('アイコン画像をアップロードしました。');
      showAdminToast({ message: 'アイコン画像をアップロードしました。' });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  async function clearAll() {
    if (busy) return;
    const confirmed = await confirmAdminAction({
      title: 'アイコン設定をクリアしますか?',
      message: 'ファビコン・Apple Touch Iconを両方クリアします。',
      confirmLabel: 'クリアする',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await patch({ faviconUrl: null, appleTouchIconUrl: null });
      showNotice('アイコン設定をクリアしました。');
      showAdminToast({ tone: 'danger', message: 'アイコン設定をクリアしました。' });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFile(file);
  }

  function onDragOver(e: React.DragEvent) {
    if (busy) return;
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
    if (e.currentTarget.src.endsWith('/no-image.svg')) return;
    e.currentTarget.src = '/no-image.svg';
  }

  if (loading) return <p className="text-sm text-[#8b91a1]">読み込み中...</p>;

  const hasIcon = data.faviconUrl || data.appleTouchIconUrl;

  return (
    <section className="space-y-5 rounded-2xl border border-white/75 bg-white/85 p-4 shadow-[0_16px_36px_rgba(31,34,48,0.07)] backdrop-blur-xl sm:p-6">
      <header>
        {!hideHeading && (
          <h2 className="text-lg font-bold text-[#3f4352]">
            サイト全体のアイコン
          </h2>
        )}
        <p className={`leading-[1.55] text-[#8b91a1] ${hideHeading ? 'text-sm' : 'mt-1 text-xs'}`}>
          1枚アップロードすると、ファビコン（ブラウザタブ）とApple Touch Icon（iOSホーム画面）の両方を自動生成します。<br />
          推奨：512×512程度の正方形PNG。
        </p>
      </header>

      {notice && (
        <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold leading-relaxed text-emerald-700">
          {notice}
        </p>
      )}

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative rounded-2xl border-2 p-4 transition-colors ${
          dragOver
            ? 'border-[#567baf] border-solid bg-[#eef4fb]'
            : hasIcon
              ? 'border-white border-solid bg-white/70'
              : 'border-[#d8e0ec] border-dashed bg-[#f6f8fb]/90'
        }`}
      >
        {hasIcon ? (
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <img
                src={data.faviconUrl || '/no-image.svg'}
                alt="ファビコン"
                className="h-8 w-8 rounded-xl bg-[#f2f4f8]"
                onError={onImgError}
              />
              <div className="text-xs">
                <div className="font-bold text-[#3f4352]">ファビコン</div>
                <div className="text-[#8b91a1]">48×48</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <img
                src={data.appleTouchIconUrl || '/no-image.svg'}
                alt="Apple Touch Icon"
                className="h-12 w-12 rounded-2xl bg-[#f2f4f8]"
                onError={onImgError}
              />
              <div className="text-xs">
                <div className="font-bold text-[#3f4352]">
                  Apple Touch Icon
                </div>
                <div className="text-[#8b91a1]">180×180</div>
              </div>
            </div>
            <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
              <UploadButton
                busy={busy}
                stage={stage}
                onChange={onPick}
                label="画像を変更"
              />
              <button
                type="button"
                onClick={clearAll}
                disabled={busy}
                className="rounded-full bg-red-50 px-5 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50 sm:px-3 sm:py-2 sm:text-xs"
              >
                クリア
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-sm leading-[1.55] text-[#596173]">
              画像をドラッグ&ドロップ<br className="sm:hidden" />
              またはボタンから選択（1枚で2サイズ自動生成）
            </p>
            <UploadButton
              busy={busy}
              stage={stage}
              onChange={onPick}
              label="アイコン画像をアップロード"
            />
          </div>
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-[#567baf]/20">
            <span className="px-3 py-1.5 rounded-full bg-[#567baf] text-white text-sm font-medium shadow-lg">
              ドロップで設定（2サイズ自動生成）
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function UploadButton({
  busy,
  stage,
  onChange,
  label,
}: {
  busy: boolean;
  stage: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center justify-center rounded-full px-5 py-3.5 text-base font-bold transition sm:px-4 sm:py-2 sm:text-sm ${
        busy
          ? 'bg-[#f2f4f8] text-[#b0b6c2] cursor-not-allowed'
          : 'bg-[#567baf] text-white shadow-[0_12px_24px_rgba(86,123,175,0.22)] hover:bg-[#4c6f9f]'
      }`}
    >
      {busy ? stage || '処理中...' : label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={onChange}
        disabled={busy}
      />
    </label>
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
