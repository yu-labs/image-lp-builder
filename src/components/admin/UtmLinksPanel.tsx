
import { useEffect, useState } from 'react';
import { Check, Copy, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import AdminSelect from './AdminSelect';
import CollapseToggleIcon from './CollapseToggleIcon';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { showAdminToast } from '../../lib/admin-toast';
import {
  LP_SLUG_CHANGED,
  type LpSlugChangedDetail,
} from '../../lib/lp-events';
import {
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
} from './LpEditorPrimitives';

interface UtmLink {
  id: string;
  label: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  short_path: string | null;
  created_at: string;
}

interface Props {
  lpId: string;
  slug: string;
}

type ApiError = { success: false; error: { code: string; message: string } };
type UtmPresetId =
  | 'custom'
  | 'instagram'
  | 'instagram_stories'
  | 'instagram_profile'
  | 'x_post'
  | 'line'
  | 'email'
  | 'ad';

const EMPTY_FORM = {
  label: '',
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  utmContent: '',
  utmTerm: '',
};
type UtmForm = typeof EMPTY_FORM;

const UTM_PRESETS: Array<{
  id: UtmPresetId;
  label: string;
  description: string;
  values: typeof EMPTY_FORM;
}> = [
  {
    id: 'instagram',
    label: 'Instagram用',
    description: 'Instagramで使うURL',
    values: {
      ...EMPTY_FORM,
      label: 'Instagram用',
      utmSource: 'instagram',
      utmMedium: 'social',
    },
  },
  {
    id: 'instagram_stories',
    label: 'Instagramストーリーズ用',
    description: 'Instagramストーリーズで使うURL',
    values: {
      ...EMPTY_FORM,
      label: 'Instagramストーリーズ用',
      utmSource: 'instagram',
      utmMedium: 'social',
      utmContent: 'stories',
    },
  },
  {
    id: 'instagram_profile',
    label: 'Instagramプロフィール用',
    description: 'Instagramプロフィールで使うURL',
    values: {
      ...EMPTY_FORM,
      label: 'Instagramプロフィール用',
      utmSource: 'instagram',
      utmMedium: 'social',
      utmContent: 'profile',
    },
  },
  {
    id: 'x_post',
    label: 'X投稿用',
    description: 'Xの投稿で使うURL',
    values: {
      ...EMPTY_FORM,
      label: 'X投稿用',
      utmSource: 'x',
      utmMedium: 'social',
      utmContent: 'post',
    },
  },
  {
    id: 'line',
    label: 'LINE用',
    description: 'LINEで使うURL',
    values: {
      ...EMPTY_FORM,
      label: 'LINE用',
      utmSource: 'line',
      utmMedium: 'social',
    },
  },
  {
    id: 'email',
    label: 'メール用',
    description: 'メールで使うURL',
    values: {
      ...EMPTY_FORM,
      label: 'メール用',
      utmSource: 'email',
      utmMedium: 'email',
    },
  },
  {
    id: 'ad',
    label: '広告用',
    description: '広告で使うURL',
    values: {
      ...EMPTY_FORM,
      label: '広告用',
      utmSource: 'ad',
      utmMedium: 'paid',
    },
  },
];

function isSameForm(a: UtmForm, b: UtmForm): boolean {
  return (
    a.label === b.label &&
    a.utmSource === b.utmSource &&
    a.utmMedium === b.utmMedium &&
    a.utmCampaign === b.utmCampaign &&
    a.utmContent === b.utmContent &&
    a.utmTerm === b.utmTerm
  );
}

function formFromItem(item: UtmLink): UtmForm {
  return {
    label: item.label,
    utmSource: item.utm_source ?? '',
    utmMedium: item.utm_medium ?? '',
    utmCampaign: item.utm_campaign ?? '',
    utmContent: item.utm_content ?? '',
    utmTerm: item.utm_term ?? '',
  };
}

function getUtmEntries(targetForm: UtmForm) {
  return [
    { label: '媒体', value: targetForm.utmSource },
    { label: '種類', value: targetForm.utmMedium },
    { label: 'キャンペーン', value: targetForm.utmCampaign },
    { label: '表示場所', value: targetForm.utmContent },
    { label: '検索語句', value: targetForm.utmTerm },
  ].filter((entry) => entry.value.trim().length > 0);
}

const PANEL_CLASS =
  'overflow-visible rounded-2xl bg-white shadow-[0_10px_24px_rgba(31,34,48,0.045)]';
const PANEL_HEADER_CLASS =
  'w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-[#f8fafc]';
const PANEL_TITLE_CLASS = 'text-[0.95rem] font-extrabold text-[#3f4352]';
const PANEL_DESC_CLASS =
  'mt-1 text-xs font-semibold leading-relaxed text-[#8b91a1]';
const STATUS_BADGE_CLASS =
  'ml-2 inline-flex shrink-0 rounded-full px-2.5 py-1 align-middle text-[0.7rem] font-extrabold leading-none';
const STATUS_CONFIGURED_CLASS = 'bg-[#e8f7ef] text-[#0f8f5c]';
const STATUS_EMPTY_CLASS = 'bg-[#f2f4f8] text-[#8b91a1]';
const PANEL_BODY_CLASS = 'space-y-4 border-t border-[#e2e7f0] px-5 py-5';
const INPUT_CLASS = EDITOR_INPUT_CLASS;
const LABEL_CLASS = EDITOR_LABEL_CLASS;
const ITEM_CLASS =
  'relative rounded-2xl border border-white/75 bg-white/90 p-3 shadow-[0_14px_32px_rgba(31,34,48,0.075)]';
const UTM_LINKS_CHANGED = 'ilpb:utm-links-changed';
const OPEN_UTM_PANEL = 'ilpb:open-utm-panel';

export default function UtmLinksPanel({ lpId, slug }: Props) {
  const [items, setItems] = useState<UtmLink[]>([]);
  const [currentSlug, setCurrentSlug] = useState(slug);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [customForm, setCustomForm] = useState(EMPTY_FORM);
  const [presetId, setPresetId] = useState<UtmPresetId>('custom');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const origin = useAdminPublicOrigin();
  const [fallbackOrigin, setFallbackOrigin] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const displayOrigin = origin || fallbackOrigin;
  const isConfigured = items.length > 0;
  const selectedPreset = UTM_PRESETS.find((preset) => preset.id === presetId);
  const isSelectedPresetEdited = selectedPreset
    ? !isSameForm(form, selectedPreset.values)
    : false;

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
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpId]);

  useEffect(() => {
    const closeOpenMenu = () => setOpenMenuId(null);
    document.addEventListener('click', closeOpenMenu);
    return () => document.removeEventListener('click', closeOpenMenu);
  }, []);

  useEffect(() => {
    const openPanel = () => setCollapsed(false);
    window.addEventListener(OPEN_UTM_PANEL, openPanel);
    return () => window.removeEventListener(OPEN_UTM_PANEL, openPanel);
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/utm-links`);
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { utmLinks: UtmLink[] };
      };
      setItems(json.data.utmLinks);
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `流入経路URLを読み込めませんでした：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(nextPresetId: UtmPresetId) {
    if (nextPresetId === 'custom') {
      setPresetId('custom');
      setForm(customForm);
      setAdvancedOpen(true);
      return;
    }
    if (presetId === 'custom') {
      setCustomForm(form);
    }
    setPresetId(nextPresetId);
    const preset = UTM_PRESETS.find((item) => item.id === nextPresetId);
    if (!preset) return;
    setForm(preset.values);
    setAdvancedOpen(true);
  }

  function updateForm(nextForm: UtmForm) {
    setForm(nextForm);
    if (presetId === 'custom') {
      setCustomForm(nextForm);
    }
  }

  function resetCreateForm() {
    setCreating(false);
    setOpenMenuId(null);
    setPresetId('custom');
    setForm(EMPTY_FORM);
    setCustomForm(EMPTY_FORM);
    setAdvancedOpen(false);
  }

  function resetEditForm() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setOpenMenuId(null);
  }

  function startNew() {
    setOpenMenuId(null);
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setPresetId('custom');
    setForm(EMPTY_FORM);
    setCustomForm(EMPTY_FORM);
    setAdvancedOpen(false);
    setCreating(true);
  }

  function startEdit(item: UtmLink) {
    setOpenMenuId(null);
    setCreating(false);
    setEditingId(item.id);
    setEditForm(formFromItem(item));
  }

  async function createNew() {
    if (busy) return;
    if (!form.label.trim()) {
      showAdminToast({ tone: 'danger', message: '表示名を入力してください。' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/utm-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          utmSource: form.utmSource.trim() || null,
          utmMedium: form.utmMedium.trim() || null,
          utmCampaign: form.utmCampaign.trim() || null,
          utmContent: form.utmContent.trim() || null,
          utmTerm: form.utmTerm.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '作成失敗'));
      setForm(EMPTY_FORM);
      setCustomForm(EMPTY_FORM);
      setPresetId('custom');
      setAdvancedOpen(false);
      setCreating(false);
      await load();
      window.dispatchEvent(new CustomEvent(UTM_LINKS_CHANGED));
      showAdminToast({ message: '流入経路URLを作成しました。' });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `流入経路URLを作成できませんでした：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function updateExisting() {
    if (busy || !editingId) return;
    if (!editForm.label.trim()) {
      showAdminToast({ tone: 'danger', message: '表示名を入力してください。' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/utm-links/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: editForm.label.trim(),
          utmSource: editForm.utmSource.trim() || null,
          utmMedium: editForm.utmMedium.trim() || null,
          utmCampaign: editForm.utmCampaign.trim() || null,
          utmContent: editForm.utmContent.trim() || null,
          utmTerm: editForm.utmTerm.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '更新失敗'));
      resetEditForm();
      await load();
      window.dispatchEvent(new CustomEvent(UTM_LINKS_CHANGED));
      showAdminToast({ message: '流入経路URLを更新しました。' });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `流入経路URLを更新できませんでした：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: UtmLink) {
    if (busy) return;
    const confirmed = await confirmAdminAction({
      title: `「${item.label}」を削除しますか?`,
      message: '短縮URLが即無効になります。',
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/utm-links/${item.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readApiError(res, '削除失敗'));
      if (editingId === item.id) resetEditForm();
      await load();
      window.dispatchEvent(new CustomEvent(UTM_LINKS_CHANGED));
      showAdminToast({ tone: 'danger', message: '流入経路URLを削除しました。' });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `流入経路URLを削除できませんでした：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyShort(item: UtmLink) {
    setOpenMenuId(null);
    if (!item.short_path) return;
    const baseOrigin =
      origin ||
      fallbackOrigin ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    if (!baseOrigin) return;
    const url = `${baseOrigin}/go/${item.short_path}`;
    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      copied = copyWithSelection(url);
    }

    if (copied) {
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 1500);
      showAdminToast({ message: '流入経路URLをコピーしました。' });
      return;
    }

    showAdminToast({
      tone: 'danger',
      message: 'コピーできませんでした。URLを選択してコピーしてください。',
    });
  }

  function buildShortUrl(item: UtmLink): string {
    if (!displayOrigin || !item.short_path) return '';
    return `${displayOrigin}/go/${item.short_path}`;
  }

  function buildDestinationUrl(targetForm: UtmForm): string {
    if (!displayOrigin) return '';
    const params = new URLSearchParams();
    if (targetForm.utmSource.trim()) {
      params.set('utm_source', targetForm.utmSource.trim());
    }
    if (targetForm.utmMedium.trim()) {
      params.set('utm_medium', targetForm.utmMedium.trim());
    }
    if (targetForm.utmCampaign.trim()) {
      params.set('utm_campaign', targetForm.utmCampaign.trim());
    }
    if (targetForm.utmContent.trim()) {
      params.set('utm_content', targetForm.utmContent.trim());
    }
    if (targetForm.utmTerm.trim()) {
      params.set('utm_term', targetForm.utmTerm.trim());
    }
    const query = params.toString();
    return `${displayOrigin}/${currentSlug}${query ? `?${query}` : ''}`;
  }

  function renderUtmLinkItem(item: UtmLink) {
    const isEditing = editingId === item.id;
    const itemForm = formFromItem(item);
    const summaryEntries = getUtmEntries(itemForm);
    const destinationUrl = buildDestinationUrl(isEditing ? editForm : itemForm);
    const shortUrl = buildShortUrl(item);

    if (isEditing) {
      return (
        <li key={item.id} className={`${ITEM_CLASS} z-20`}>
          <div className="space-y-3">
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-[#3f4352]">
                このURLを編集
              </p>
              {shortUrl && (
                <code className="mt-1 block truncate font-mono text-[11px] font-semibold text-[#567baf]">
                  {shortUrl}
                </code>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                label="表示名"
                value={editForm.label}
                onChange={(v) => setEditForm({ ...editForm, label: v })}
                placeholder="例：チラシQR / 店頭POP"
              />
              <Input
                label="媒体（utm_source・任意）"
                value={editForm.utmSource}
                onChange={(v) => setEditForm({ ...editForm, utmSource: v })}
                placeholder="x / instagram / mail"
              />
              <Input
                label="種類（utm_medium・任意）"
                value={editForm.utmMedium}
                onChange={(v) => setEditForm({ ...editForm, utmMedium: v })}
                placeholder="social / email / referral"
              />
              <Input
                label="キャンペーン（utm_campaign・任意）"
                value={editForm.utmCampaign}
                onChange={(v) => setEditForm({ ...editForm, utmCampaign: v })}
                placeholder="spring2026"
              />
              <Input
                label="表示場所（utm_content・任意）"
                value={editForm.utmContent}
                onChange={(v) => setEditForm({ ...editForm, utmContent: v })}
                placeholder="banner_top"
              />
              <Input
                label="検索語句（utm_term・任意）"
                value={editForm.utmTerm}
                onChange={(v) => setEditForm({ ...editForm, utmTerm: v })}
                placeholder="検索キーワード等"
              />
            </div>

            {destinationUrl && (
              <div className="rounded-2xl bg-[#f8fafc] p-3 ring-1 ring-[#e2e7f0]">
                <p className="text-xs font-extrabold text-[#596173]">
                  実際に開くURL
                </p>
                <code className="mt-2 block break-all rounded-xl bg-white px-3 py-2 font-mono text-[11px] font-semibold text-[#567baf]">
                  {destinationUrl}
                </code>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={resetEditForm}
                disabled={busy}
                className="rounded-full px-4 py-2 text-sm font-bold text-[#596173] hover:bg-[#f2f4f8] disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={updateExisting}
                disabled={busy}
                className="rounded-full bg-[#567baf] px-4 py-2 text-sm font-bold text-white shadow-[0_10px_22px_rgba(86,123,175,0.16)] hover:bg-[#4c6f9f] disabled:opacity-50"
              >
                {busy ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </li>
      );
    }

    return (
      <li
        key={item.id}
        className={`${ITEM_CLASS} ${openMenuId === item.id ? 'z-30' : 'z-0'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:min-w-[22rem]">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="truncate text-sm font-extrabold text-[#3f4352]">
                {item.label}
              </div>
              {shortUrl && (
                <code className="block truncate font-mono text-[11px] font-semibold text-[#567baf]">
                  {shortUrl}
                </code>
              )}
              {summaryEntries.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {summaryEntries.slice(0, 3).map((entry) => (
                    <span
                      key={entry.label}
                      className="rounded-full bg-[#f2f4f8] px-2 py-1 text-[10px] font-bold text-[#687082]"
                    >
                      {entry.label}: {entry.value}
                    </span>
                  ))}
                </div>
              )}
              {destinationUrl && (
                <details className="pt-1">
                  <summary className="cursor-pointer text-[11px] font-bold text-[#8b91a1] hover:text-[#567baf]">
                    実際に開くURL
                  </summary>
                  <code className="mt-1 block break-all rounded-xl bg-[#f8fafc] px-3 py-2 font-mono text-[11px] font-semibold text-[#567baf]">
                    {destinationUrl}
                  </code>
                </details>
              )}
            </div>
            <div className="relative shrink-0 sm:hidden">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === item.id ? null : item.id);
                }}
                disabled={busy}
                aria-label={`${item.label}の操作`}
                aria-expanded={openMenuId === item.id}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#7f8797] transition hover:bg-[#f2f4f8] hover:text-[#567baf] disabled:opacity-50"
              >
                <MoreVertical size={20} strokeWidth={2.3} aria-hidden="true" />
              </button>
              {openMenuId === item.id && (
                <div
                  className="absolute right-0 top-[calc(100%+0.375rem)] z-[140] w-44 overflow-hidden rounded-2xl border border-white/75 bg-white/95 p-1.5 shadow-[0_18px_42px_rgba(31,34,48,0.16)] backdrop-blur-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    disabled={busy}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold text-[#596173] transition hover:bg-[#567baf]/10 hover:text-[#567baf] disabled:opacity-50"
                  >
                    <Pencil size={16} strokeWidth={2.3} aria-hidden="true" />
                    <span>編集</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyShort(item)}
                    disabled={busy}
                    className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold text-[#596173] transition hover:bg-[#567baf]/10 hover:text-[#567baf] disabled:opacity-50"
                  >
                    {copiedId === item.id ? (
                      <Check size={16} strokeWidth={2.4} aria-hidden="true" />
                    ) : (
                      <Copy size={16} strokeWidth={2.3} aria-hidden="true" />
                    )}
                    <span>{copiedId === item.id ? 'コピー済み' : 'コピー'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      void remove(item);
                    }}
                    disabled={busy}
                    className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={16} strokeWidth={2.3} aria-hidden="true" />
                    <span>削除</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="hidden shrink-0 flex-wrap gap-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => startEdit(item)}
              disabled={busy}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full bg-[#f2f4f8] px-3 py-2 text-sm font-bold text-[#596173] transition hover:bg-[#eef4fb] disabled:opacity-50"
              aria-label="編集"
              title="編集"
            >
              <Pencil size={16} strokeWidth={2.2} aria-hidden="true" />
              <span>編集</span>
            </button>
            <button
              type="button"
              onClick={() => copyShort(item)}
              disabled={busy}
              className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold transition disabled:opacity-50 ${
                copiedId === item.id
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-[#f2f4f8] text-[#596173] hover:bg-[#eef4fb]'
              }`}
              aria-label="短縮URLをコピー"
              title={copiedId === item.id ? 'コピーしました' : 'コピー'}
            >
              {copiedId === item.id ? (
                <Check size={16} strokeWidth={2.4} aria-hidden="true" />
              ) : (
                <Copy size={16} strokeWidth={2.2} aria-hidden="true" />
              )}
              <span>{copiedId === item.id ? 'コピー済み' : 'コピー'}</span>
            </button>
            <button
              type="button"
              onClick={() => remove(item)}
              disabled={busy}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full bg-red-50 px-3 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
              aria-label="削除"
              title="削除"
            >
              <Trash2 size={16} strokeWidth={2.2} aria-hidden="true" />
              <span>削除</span>
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <section className={PANEL_CLASS}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className={PANEL_HEADER_CLASS}
      >
        <div className="min-w-0">
          <h2 className={PANEL_TITLE_CLASS}>
            流入経路URL
            <span
              className={`${STATUS_BADGE_CLASS} ${
                isConfigured ? STATUS_CONFIGURED_CLASS : STATUS_EMPTY_CLASS
              }`}
            >
              {isConfigured ? '設定済み' : '未設定'}
            </span>
          </h2>
          <p className={PANEL_DESC_CLASS}>
            SNS・広告など、使う場所ごとのURLを作れます。
          </p>
        </div>
        <CollapseToggleIcon open={!collapsed} />
      </button>

      {!collapsed && (
        <div className={PANEL_BODY_CLASS}>
          {!creating && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-extrabold text-[#3f4352]">
                流入経路URL
                {!loading && items.length > 0 && (
                  <span className="ml-1 text-[#8b91a1]">({items.length}件)</span>
                )}
              </p>
              <button
                type="button"
                onClick={startNew}
                disabled={busy}
                className="inline-flex min-h-[2.75rem] items-center justify-center gap-1.5 rounded-full bg-[#567baf] px-4 py-2 text-sm font-bold text-white shadow-[0_10px_22px_rgba(86,123,175,0.16)] hover:bg-[#4c6f9f] disabled:opacity-50 sm:min-h-[2.5rem]"
              >
                <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                新規作成
              </button>
            </div>
          )}

          {creating && (
            <div className="space-y-4 rounded-2xl bg-white p-0">
              <div className="rounded-2xl bg-[#f8fafc] p-3 ring-1 ring-[#e2e7f0]">
                <div className="mb-3">
                  <p className="text-sm font-extrabold text-[#3f4352]">
                    流入経路URLを作成
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)]">
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className={LABEL_CLASS}>URLを置く場所</span>
                    <AdminSelect
                      value={presetId}
                      onChange={(e) => applyPreset(e.target.value as UtmPresetId)}
                    >
                      <option value="custom">自分で入力</option>
                      <optgroup label="よく使う設定">
                        {UTM_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </optgroup>
                    </AdminSelect>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className={LABEL_CLASS}>表示名</span>
                    <input
                      type="text"
                      value={form.label}
                      onChange={(e) => {
                        updateForm({ ...form, label: e.target.value });
                      }}
                      placeholder="例：チラシQR / 店頭POP"
                      maxLength={200}
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>
                {presetId === 'custom' ? (
                  <p className="mt-2 text-[11px] font-semibold leading-relaxed text-[#8b91a1]">
                    表示名だけでも作成できます。流入元を分けたい時だけ下の計測名を入力します。
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] font-bold leading-relaxed text-[#567baf]">
                    {selectedPreset?.description}
                    <span className="ml-1 text-[#8b91a1]">
                      下の計測名に自動入力されています。
                    </span>
                    {isSelectedPresetEdited && (
                      <span className="ml-2 inline-flex rounded-full bg-white px-2 py-0.5 text-[10px] text-[#567baf] ring-1 ring-[#d7deea]">
                        一部編集済み
                      </span>
                    )}
                  </p>
                )}
              </div>

              <details
                className="rounded-2xl bg-[#f8fafc] p-3 ring-1 ring-[#e2e7f0]"
                open={advancedOpen}
                onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
              >
                <summary className="cursor-pointer text-xs font-extrabold text-[#596173]">
                  計測名を確認・編集
                </summary>
                <p className="mt-2 text-[11px] font-semibold leading-relaxed text-[#8b91a1]">
                  空欄でもURLは作成できます。流入元を分けたい時だけ入力します。
                </p>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    label="媒体（utm_source・任意）"
                    value={form.utmSource}
                    onChange={(v) => {
                      updateForm({ ...form, utmSource: v });
                    }}
                    placeholder="x / instagram / mail"
                  />
                  <Input
                    label="種類（utm_medium・任意）"
                    value={form.utmMedium}
                    onChange={(v) => {
                      updateForm({ ...form, utmMedium: v });
                    }}
                    placeholder="social / email / referral"
                  />
                  <Input
                    label="キャンペーン（utm_campaign・任意）"
                    value={form.utmCampaign}
                    onChange={(v) => {
                      updateForm({ ...form, utmCampaign: v });
                    }}
                    placeholder="spring2026"
                  />
                  <Input
                    label="表示場所（utm_content・任意）"
                    value={form.utmContent}
                    onChange={(v) => {
                      updateForm({ ...form, utmContent: v });
                    }}
                    placeholder="banner_top"
                  />
                  <Input
                    label="検索語句（utm_term・任意）"
                    value={form.utmTerm}
                    onChange={(v) => {
                      updateForm({ ...form, utmTerm: v });
                    }}
                    placeholder="検索キーワード等"
                  />
                </div>
              </details>
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={resetCreateForm}
                  disabled={busy}
                  className="rounded-full px-4 py-2 text-sm font-bold text-[#596173] hover:bg-white disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={createNew}
                  disabled={busy}
                  className="rounded-full bg-[#567baf] px-4 py-2 text-sm font-bold text-white shadow-[0_10px_22px_rgba(86,123,175,0.16)] hover:bg-[#4c6f9f] disabled:opacity-50"
                >
                  {busy ? '作成中...' : '作成'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm font-semibold text-[#8b91a1]">読み込み中...</p>
          ) : items.length === 0 && !creating ? (
            <p className="py-4 text-center text-xs font-semibold text-[#8b91a1]">
              まだ流入経路URLがありません
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map(renderUtmLinkItem)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL_CLASS}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        className={INPUT_CLASS}
      />
    </label>
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
