/**
 * PreviewQr
 *
 * Small React island that lives inside the unified preview window's
 * 📱 スマホ tab. Fetches the right URL for the LP (public /<slug> if
 * published, /preview/<token> otherwise) and renders a QR alongside
 * the iPhone mock so the operator can scan with a real device.
 *
 * Issuing / rotating the preview token uses the same endpoint as
 * the standalone QR modal did before — kept as a one-button flow.
 */

import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';

interface Props {
  lpId: string;
  slug: string;
  isPublished: boolean;
  initialToken?: string | null;
  initialUrl?: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

export default function PreviewQr({
  lpId,
  slug,
  isPublished,
  initialToken = null,
  initialUrl = '',
}: Props) {
  // The preview window was opened from /admin/...; window.opener
  // points back at the editor. The URL the visitor would hit is
  // either the request origin (no custom domain) or the configured
  // public host (custom domain wired) — useAdminPublicOrigin makes
  // that call.
  const origin = useAdminPublicOrigin();
  const [token, setToken] = useState<string | null>(initialToken);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackOrigin] = useState(getBrowserOrigin);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveOrigin = origin || fallbackOrigin;

  useEffect(() => {
    if (isPublished || token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/lps/${lpId}/preview-token`);
        if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
        const json = (await res.json()) as {
          success: true;
          data: { token: string | null };
        };
        let nextToken = json.data.token;
        if (!nextToken) {
          nextToken = await issuePreviewToken();
        }
        if (!cancelled) setToken(nextToken);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lpId, isPublished, token]);

  async function issuePreviewToken(): Promise<string | null> {
    const res = await fetch(`/api/lps/${lpId}/preview-token`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(await readApiError(res, '発行失敗'));
    const json = (await res.json()) as {
      success: true;
      data: { token: string | null };
    };
    return json.data.token;
  }

  async function issueToken() {
    setLoading(true);
    setError(null);
    try {
      setToken(await issuePreviewToken());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const url = isPublished
    ? effectiveOrigin
      ? `${effectiveOrigin}/${slug}`
      : initialUrl
    : effectiveOrigin && token
      ? `${effectiveOrigin}/preview/${token}`
      : initialUrl;

  const isLocalhost =
    effectiveOrigin.includes('://localhost') ||
    effectiveOrigin.includes('://127.');

  async function copyUrl() {
    if (!url) return;
    setError(null);
    let copiedUrl = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copiedUrl = true;
      }
    } catch {
      copiedUrl = false;
    }

    if (!copiedUrl) {
      copiedUrl = copyWithSelection(url, urlInputRef.current);
    }

    if (copiedUrl) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      return;
    }

    setError('コピーできませんでした。URL欄を選択してコピーしてください。');
  }

  return (
    <div className="flex w-[17rem] flex-col gap-4 rounded-[1.35rem] border border-white/80 bg-white/90 p-4 text-[#3f4352] shadow-[0_22px_54px_rgba(31,34,48,0.18)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-sm font-extrabold">実機確認QR</p>
          <p className="m-0 mt-1 text-[11px] font-bold leading-relaxed text-[#8b91a1]">
            {isPublished ? '公開URLを読み取ります' : 'プレビューURLを読み取ります'}
          </p>
        </div>
        <span className="rounded-full bg-[#eef4fb] px-2.5 py-1 text-[10px] font-extrabold text-[#567baf]">
          {isPublished ? '公開URL' : 'プレビュー'}
        </span>
      </div>

      {loading && (
        <p className="m-0 text-center text-xs font-bold text-[#8b91a1]">
          読み込み中...
        </p>
      )}

      {url && (
        <>
          <div className="mx-auto rounded-[1.1rem] border border-[#e2e7f0] bg-white p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)]">
            <QRCodeSVG
              value={url}
              size={220}
              level="M"
              marginSize={4}
              bgColor="#ffffff"
              fgColor="#111827"
            />
          </div>

          <div className="w-full">
            <input
              ref={urlInputRef}
              type="text"
              value={url}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="w-full cursor-text rounded-xl border border-[#d7deea] bg-[#f8fafc] px-3 py-2 font-mono text-[10px] font-semibold text-[#596173] outline-none"
            />
            <button
              type="button"
              onClick={copyUrl}
              className={`mt-2 min-h-11 w-full cursor-pointer rounded-full px-4 py-2 text-sm font-extrabold shadow-[0_14px_26px_rgba(86,123,175,0.2)] transition ${
                copied
                  ? 'bg-[#e8f7ef] text-[#0f8f5c]'
                  : 'bg-[#567baf] text-white hover:bg-[#4d6f9c]'
              }`}
            >
              {copied ? 'コピー済み' : 'URLをコピー'}
            </button>
          </div>

          {!isPublished && (
            <button
              type="button"
              onClick={async () => {
                const confirmed = await confirmAdminAction({
                  title: 'プレビューURLを再発行しますか?',
                  message: '以前のURLは無効になります。',
                  confirmLabel: '再発行する',
                  tone: 'warning',
                });
                if (!confirmed) return;
                void issueToken();
              }}
              className="self-center cursor-pointer border-0 bg-transparent text-[11px] font-bold text-[#8b91a1] underline-offset-4 hover:text-[#567baf] hover:underline"
            >
              プレビューURLを再発行
            </button>
          )}

          <p className="m-0 text-center text-[11px] font-bold leading-relaxed text-[#8b91a1]">
            スマホのカメラで読んで実機確認
          </p>
        </>
      )}

      {isLocalhost && url && (
        <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold leading-relaxed text-amber-800">
          ローカルURLなので、スマホから見えない場合があります。
          <br />
          本番では実際のドメインで確認できます。
        </p>
      )}

      {error && (
        <p className="m-0 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-red-700">
          {error}
        </p>
      )}
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

function copyWithSelection(
  text: string,
  input: HTMLInputElement | null
): boolean {
  try {
    if (input) {
      input.focus();
      input.select();
      input.setSelectionRange(0, text.length);
      return runLegacyCopyCommand();
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = runLegacyCopyCommand();
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function runLegacyCopyCommand(): boolean {
  const legacyDocument = document as unknown as {
    execCommand?: (commandId: string) => boolean;
  };
  return legacyDocument.execCommand?.('copy') ?? false;
}

function getBrowserOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}
