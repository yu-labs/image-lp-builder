import { useEffect, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import AdminSelect from './AdminSelect';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';
import { showAdminToast } from '../../lib/admin-toast';
import { EditorPanel, EditorSectionHeader } from './LpEditorPrimitives';
import {
  LP_SLUG_CHANGED,
  type LpSlugChangedDetail,
} from '../../lib/lp-events';

interface UtmLink {
  id: string;
  label: string;
  short_path: string | null;
}

interface Props {
  lpId: string;
  slug: string;
  isPublished: boolean;
}

type ApiError = { success: false; error: { code: string; message: string } };

const UTM_LINKS_CHANGED = 'ilpb:utm-links-changed';
const STATIC_SELECT_CLASS =
  'inline-flex min-h-[2.75rem] w-full items-center rounded-xl bg-[#f2f4f8] px-3 text-sm font-extrabold text-[#596173]';

export default function DistributionUrlCopy({
  lpId,
  slug,
  isPublished,
}: Props) {
  const origin = useAdminPublicOrigin();
  const [currentSlug, setCurrentSlug] = useState(slug);
  const [fallbackOrigin, setFallbackOrigin] = useState('');
  const [utmLinks, setUtmLinks] = useState<UtmLink[]>([]);
  const [selected, setSelected] = useState('public');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const effectiveOrigin = origin || fallbackOrigin;

  useEffect(() => {
    setFallbackOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    setCurrentSlug(slug);
  }, [slug]);

  useEffect(() => {
    const onSlugChanged = (event: Event) => {
      const detail = (event as CustomEvent<LpSlugChangedDetail>).detail;
      if (detail?.lpId !== lpId || !detail.slug) return;
      setCurrentSlug(detail.slug);
    };
    window.addEventListener(LP_SLUG_CHANGED, onSlugChanged);
    return () => window.removeEventListener(LP_SLUG_CHANGED, onSlugChanged);
  }, [lpId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/lps/${lpId}/utm-links`);
        if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
        const json = (await res.json()) as {
          success: true;
          data: { utmLinks: UtmLink[] };
        };
        if (!cancelled) {
          const links = json.data.utmLinks.filter((item) => item.short_path);
          setUtmLinks(links);
          setSelected((current) =>
            current === 'public' || links.some((item) => item.id === current)
              ? current
              : 'public'
          );
        }
      } catch {
        if (!cancelled) setUtmLinks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const onChanged = () => void load();
    window.addEventListener(UTM_LINKS_CHANGED, onChanged);
    window.addEventListener('focus', onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(UTM_LINKS_CHANGED, onChanged);
      window.removeEventListener('focus', onChanged);
    };
  }, [lpId]);

  const selectedUrl = useMemo(() => {
    if (!effectiveOrigin) return '';
    if (selected === 'public') return `${effectiveOrigin}/${currentSlug}`;
    const item = utmLinks.find((link) => link.id === selected);
    if (!item?.short_path) return `${effectiveOrigin}/${currentSlug}`;
    return `${effectiveOrigin}/go/${item.short_path}`;
  }, [currentSlug, effectiveOrigin, selected, utmLinks]);

  async function copyUrl() {
    if (!isPublished || !selectedUrl) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(selectedUrl);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) ok = copyWithSelection(selectedUrl);
    if (!ok) {
      showAdminToast({
        tone: 'danger',
        message: 'コピーできませんでした。URLを選択してコピーしてください。',
      });
      return;
    }

    setCopied(true);
    showAdminToast({ message: '流入経路URLをコピーしました。' });
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <EditorPanel>
      <div className="mb-5">
        <EditorSectionHeader
          title="流入経路URL"
          description={
            <>
              SNS・広告に貼るURLです。<a
                href="#panel-utm"
                data-open-advanced="true"
                className="font-extrabold text-[#567baf] underline underline-offset-2"
              >
                流入経路URL
              </a>から追加できます。
            </>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <div className="flex w-full min-w-0 flex-col gap-3 sm:max-w-[42rem] sm:flex-[1_1_32rem] sm:flex-row sm:items-center sm:gap-4">
        {utmLinks.length > 0 ? (
          <label className="sr-only" htmlFor="distribution-url-kind">
            コピーするURL
          </label>
        ) : null}
        {utmLinks.length > 0 ? (
          <AdminSelect
            id="distribution-url-kind"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            wrapperClassName="w-full sm:flex-[0_1_13rem]"
          >
            <option value="public">通常URL</option>
            {utmLinks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </AdminSelect>
        ) : (
          <span className={`${STATIC_SELECT_CLASS} sm:flex-[0_1_13rem]`}>
            通常URL
          </span>
        )}

        <code className="flex min-h-[2.75rem] w-full min-w-0 items-center truncate rounded-xl bg-[#f8fafc] px-3 py-0 font-mono text-xs font-semibold leading-none text-[#567baf] shadow-[inset_0_0_0_1px_rgba(215,222,234,0.78)] sm:flex-[1_1_18rem]">
          {selectedUrl || 'URLを読み込み中...'}
        </code>
        </div>

        <button
          type="button"
          onClick={copyUrl}
          disabled={!isPublished || !selectedUrl || loading}
          className={`inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-base font-extrabold transition disabled:cursor-not-allowed disabled:opacity-55 sm:min-h-[3rem] sm:w-auto sm:gap-1.5 sm:text-sm ${
            copied
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-[#567baf] text-white shadow-[0_10px_22px_rgba(86,123,175,0.16)] hover:bg-[#4c6f9f]'
          }`}
        >
          {copied ? (
            <Check size={16} strokeWidth={2.4} aria-hidden="true" />
          ) : (
            <Copy size={16} strokeWidth={2.3} aria-hidden="true" />
          )}
          {copied ? 'コピー済み' : 'コピー'}
        </button>
      </div>

      {!isPublished && (
        <p className="mt-4 inline-block max-w-full rounded-xl bg-[#fff6db] px-3 py-2.5 text-xs font-semibold leading-[1.6] text-[#8a641f]">
          <strong className="font-extrabold">まだ公開されていません。</strong>{' '}
          公開後にコピーできます。
        </p>
      )}
    </EditorPanel>
  );
}

function copyWithSelection(text: string): boolean {
  try {
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

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
