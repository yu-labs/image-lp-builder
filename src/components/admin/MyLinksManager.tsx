/**
 * MyLinksManager
 *
 * Admin UI for reusable destinations used by LP CTA buttons. The UI is
 * intentionally built from the same editor primitives as the LP editor
 * so spacing, inputs, buttons and cards stay consistent.
 */

import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';
import {
  Check,
  Info,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { showAdminToast } from '../../lib/admin-toast';
import AdminModal from './AdminModal';
import AdminSelect from './AdminSelect';
import {
  EDITOR_DANGER_BUTTON_CLASS,
  EDITOR_HELP_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_SECONDARY_BUTTON_CLASS,
  EDITOR_SUB_PANEL_CLASS,
  EDITOR_TIGHT_STACK_CLASS,
  EditorPanel,
  EditorSectionHeader,
} from './LpEditorPrimitives';

interface MyLink {
  id: string;
  label: string;
  url: string;
  created_at: string;
  updated_at: string;
}

interface MyLinkUsage {
  usageCount: number;
  pages: Array<{
    id: string;
    slug: string;
    status: string;
    count: number;
  }>;
}

type ApiError = { success: false; error: { code: string; message: string } };
type MyLinkKind = 'url' | 'tel' | 'email';

const FORM_INPUT_CLASS = `${EDITOR_INPUT_CLASS} w-full`;
const FORM_ERROR_CLASS =
  'rounded-xl bg-red-50 px-3 py-2 text-xs font-bold leading-relaxed text-red-700';
const KIND_LABELS: Record<MyLinkKind, string> = {
  url: 'URL',
  tel: '電話番号',
  email: 'メール',
};
const INPUT_LABELS: Record<MyLinkKind, string> = {
  url: 'URL',
  tel: '電話番号',
  email: 'メールアドレス',
};
const INPUT_PLACEHOLDERS: Record<MyLinkKind, string> = {
  url: 'lin.ee/...',
  tel: '090-1234-5678',
  email: 'info@example.com',
};
const INPUT_HELP: Record<MyLinkKind, string> = {
  url: 'https:// は自動で付きます',
  tel: 'ハイフンありでも入力できます',
  email: 'メールアドレスを入力してください',
};

// Friendly client-side URL check. Server-side validation remains the
// source of truth.
function clientUrlError(value: string, kind: MyLinkKind): string | null {
  const trimmed = normalizeMyLinkUrlInput(value, kind);
  if (trimmed.length === 0) return `${INPUT_LABELS[kind]}を入力してください`;
  if (kind === 'tel') {
    const phone = stripLinkScheme(value, 'tel').replace(/\s+/g, '');
    if (!/^[0-9+\-()]+$/.test(phone)) {
      return '電話番号は半角数字・+・-・()で入力してください';
    }
    return null;
  }
  if (kind === 'email') {
    const email = stripLinkScheme(value, 'mailto');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return '正しいメールアドレスを入力してください';
    }
    return null;
  }
  if (trimmed.startsWith('//')) return 'URLの先頭が // で始まる形式は使えません';
  if (trimmed.startsWith('/')) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:', 'tel:', 'mailto:'].includes(parsed.protocol)) {
      return 'http:// / https:// / tel: / mailto: のいずれかで入力してください';
    }
    return null;
  } catch {
    return 'http:// や https:// で始まるURLを入力してください';
  }
}

function normalizeMyLinkUrlInput(value: string, kind: MyLinkKind): string {
  const trimmed = value.trim();
  if (kind === 'tel') {
    const phone = stripLinkScheme(trimmed, 'tel').replace(/\s+/g, '');
    return phone ? `tel:${phone}` : '';
  }
  if (kind === 'email') {
    const email = stripLinkScheme(trimmed, 'mailto');
    return email ? `mailto:${email}` : '';
  }
  if (
    trimmed.length === 0 ||
    trimmed.startsWith('/') ||
    /^(https?|tel|mailto):/i.test(trimmed)
  ) {
    return trimmed;
  }
  if (looksLikeBareHost(trimmed)) return `https://${trimmed}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function inferMyLinkKind(url: string): MyLinkKind {
  if (/^tel:/i.test(url)) return 'tel';
  if (/^mailto:/i.test(url)) return 'email';
  return 'url';
}

function displayMyLinkValue(url: string): string {
  const kind = inferMyLinkKind(url);
  if (kind === 'tel') return stripLinkScheme(url, 'tel');
  if (kind === 'email') return stripLinkScheme(url, 'mailto');
  return url;
}

function stripLinkScheme(value: string, scheme: 'tel' | 'mailto'): string {
  return value.trim().replace(new RegExp(`^${scheme}:`, 'i'), '').trim();
}

function looksLikeBareHost(value: string): boolean {
  return /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[^/\s:]+\.[^/\s:]+)(?::\d+)?(?:[/?#]|$)/i.test(
    value
  );
}

export default function MyLinksManager() {
  const [items, setItems] = useState<MyLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<MyLinkKind>('url');
  const [draftLabel, setDraftLabel] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<MyLinkKind>('url');
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    link: MyLink;
    usage: MyLinkUsage;
  } | null>(null);
  const [checkingDeleteId, setCheckingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    const closeOpenMenu = () => setOpenMenuId(null);
    document.addEventListener('click', closeOpenMenu);
    return () => document.removeEventListener('click', closeOpenMenu);
  }, []);

  async function loadList() {
    setPageError(null);
    try {
      const res = await fetch('/api/my-links');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { myLinks: MyLink[] };
      };
      setItems(json.data.myLinks);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPageError(message);
      showAdminToast({ tone: 'danger', message: `リンクを取得できませんでした。${message}` });
    } finally {
      setLoading(false);
    }
  }

  function openCreateForm() {
    setCreating(true);
    setCreateError(null);
  }

  function closeCreateForm() {
    setCreating(false);
    setCreateError(null);
    setNewKind('url');
    setNewLabel('');
    setNewUrl('');
  }

  async function createNew() {
    if (busy) return;
    const label = newLabel.trim();
    const url = normalizeMyLinkUrlInput(newUrl, newKind);
    if (!label) {
      setCreateError('表示名を入力してください');
      return;
    }
    const urlErr = clientUrlError(newUrl, newKind);
    if (urlErr) {
      setCreateError(urlErr);
      return;
    }

    setBusy(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/my-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: newKind, label, url }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '作成失敗'));
      closeCreateForm();
      await loadList();
      showAdminToast({ message: 'リンクを追加しました。' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCreateError(message);
      showAdminToast({ tone: 'danger', message: `リンクを追加できませんでした。${message}` });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(link: MyLink) {
    setOpenMenuId(null);
    setEditingId(link.id);
    setDraftKind(inferMyLinkKind(link.url));
    setDraftLabel(link.label);
    setDraftUrl(displayMyLinkValue(link.url));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    if (busy) return;
    const label = draftLabel.trim();
    const url = normalizeMyLinkUrlInput(draftUrl, draftKind);
    if (!label) {
      setEditError('表示名を入力してください');
      return;
    }
    const urlErr = clientUrlError(draftUrl, draftKind);
    if (urlErr) {
      setEditError(urlErr);
      return;
    }

    setBusy(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/my-links/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: draftKind, label, url }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '更新失敗'));
      setEditingId(null);
      await loadList();
      showAdminToast({ message: 'リンクを更新しました。' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setEditError(message);
      showAdminToast({ tone: 'danger', message: `リンクを更新できませんでした。${message}` });
    } finally {
      setBusy(false);
    }
  }

  async function prepareRemove(link: MyLink) {
    if (busy || checkingDeleteId) return;
    setOpenMenuId(null);
    setCheckingDeleteId(link.id);
    setPageError(null);
    try {
      const res = await fetch(`/api/my-links/${link.id}/usage`);
      if (!res.ok) throw new Error(await readApiError(res, '使用状況の確認失敗'));
      const json = (await res.json()) as {
        success: true;
        data: MyLinkUsage;
      };
      setDeleteTarget({ link, usage: json.data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPageError(message);
      showAdminToast({ tone: 'danger', message: `使用状況を確認できませんでした。${message}` });
    } finally {
      setCheckingDeleteId(null);
    }
  }

  async function confirmRemove() {
    if (busy || !deleteTarget) return;
    const { link, usage } = deleteTarget;
    setBusy(true);
    setPageError(null);
    try {
      const res = await fetch(`/api/my-links/${link.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, '削除失敗'));
      setOpenMenuId(null);
      setDeleteTarget(null);
      await loadList();
      showAdminToast(
        usage.usageCount > 0
          ? {
              tone: 'danger',
              message: 'リンクを削除しました。使用中のLPボタンは現在のURLで残ります。',
            }
          : { tone: 'danger', message: 'リンクを削除しました。' }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPageError(message);
      showAdminToast({ tone: 'danger', message: `リンクを削除できませんでした。${message}` });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <EditorPanel>
        <p className="m-0 text-sm font-semibold text-[#8b91a1]">読み込み中...</p>
      </EditorPanel>
    );
  }

  return (
    <div className={EDITOR_TIGHT_STACK_CLASS}>
      <EditorPanel>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <EditorSectionHeader
            title="登録したリンク"
            titleAdornment={
              items.length > 0 ? (
                <span className="rounded-full bg-[#eef4fb] px-2.5 py-1 text-xs font-extrabold text-[#567baf]">
                  {items.length}個
                </span>
              ) : undefined
            }
            description="LINE、予約フォーム、問い合わせ先などを登録します。"
          />
          {!creating && (
            <button
              type="button"
              onClick={openCreateForm}
              disabled={busy}
              className={`${EDITOR_PRIMARY_BUTTON_CLASS} min-h-14 gap-2 px-5 text-base sm:min-h-[2.75rem] sm:px-4 sm:text-sm`}
            >
              <Plus size={17} strokeWidth={2.4} aria-hidden="true" />
              <span>リンクを追加</span>
            </button>
          )}
        </div>

        {pageError && (
          <p className={`${FORM_ERROR_CLASS} mb-4`}>
            {pageError}
          </p>
        )}

        {creating && (
          <div className="mb-4">
            <MyLinkForm
              mode="create"
              kind={newKind}
              label={newLabel}
              url={newUrl}
              error={createError}
              busy={busy}
              onKindChange={(value) => {
                setNewKind(value);
                if (createError) setCreateError(null);
              }}
              onLabelChange={(value) => {
                setNewLabel(value);
                if (createError) setCreateError(null);
              }}
              onUrlChange={(value) => {
                setNewUrl(value);
                if (createError) setCreateError(null);
              }}
              onCancel={closeCreateForm}
              onSubmit={() => void createNew()}
            />
          </div>
        )}

        {items.length === 0 && !creating ? (
          <EmptyLinksState onCreate={openCreateForm} />
        ) : (
          <ul className="space-y-3">
            {items.map((link) => (
              <MyLinkRow
                key={link.id}
                link={link}
                editing={editingId === link.id}
                menuOpen={openMenuId === link.id}
                busy={busy}
                checkingDelete={checkingDeleteId === link.id}
                draftLabel={draftLabel}
                draftUrl={draftUrl}
                draftKind={draftKind}
                editError={editError}
                onDraftKindChange={(value) => {
                  setDraftKind(value);
                  if (editError) setEditError(null);
                }}
                onDraftLabelChange={(value) => {
                  setDraftLabel(value);
                  if (editError) setEditError(null);
                }}
                onDraftUrlChange={(value) => {
                  setDraftUrl(value);
                  if (editError) setEditError(null);
                }}
                onCancelEdit={cancelEdit}
                onSave={() => void saveEdit(link.id)}
                onStartEdit={() => startEdit(link)}
                onPrepareRemove={() => void prepareRemove(link)}
                onToggleMenu={(event) => {
                  event.stopPropagation();
                  setOpenMenuId(openMenuId === link.id ? null : link.id);
                }}
              />
            ))}
          </ul>
        )}
      </EditorPanel>

      <section className={`${EDITOR_SUB_PANEL_CLASS} flex gap-3 border border-[#c8d5e8]/80 bg-[#f3f7fd]/78 text-sm text-[#2f4f78]`}>
        <Info size={18} strokeWidth={2.3} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="mb-1 font-extrabold">LPボタンでの使い方</p>
          <p className="text-[0.82rem] font-semibold leading-relaxed">
            LPのボタン編集で選べます。リンク先を変えると、このリンクを使っているボタンにも反映されます。
          </p>
        </div>
      </section>

      {deleteTarget && (
        <MyLinkDeleteDialog
          target={deleteTarget}
          busy={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmRemove()}
        />
      )}
    </div>
  );
}

function MyLinkForm({
  mode,
  kind,
  label,
  url,
  error,
  busy,
  onKindChange,
  onLabelChange,
  onUrlChange,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  kind: MyLinkKind;
  label: string;
  url: string;
  error: string | null;
  busy: boolean;
  onKindChange: (value: MyLinkKind) => void;
  onLabelChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const inputMode = kind === 'email' ? 'email' : kind === 'url' ? 'url' : undefined;

  return (
    <div className={`${EDITOR_SUB_PANEL_CLASS} border border-[#d7deea]/80 bg-[#f8fafc]/82`}>
      <div className="grid gap-3 lg:grid-cols-[minmax(7rem,9rem)_minmax(9rem,13rem)_minmax(14rem,1fr)]">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={EDITOR_LABEL_CLASS}>種類</span>
          <AdminSelect
            value={kind}
            onChange={(e) => onKindChange(e.target.value as MyLinkKind)}
          >
            <option value="url">URL</option>
            <option value="tel">電話番号</option>
            <option value="email">メール</option>
          </AdminSelect>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={EDITOR_LABEL_CLASS}>表示名</span>
          <input
            type="text"
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="例：公式LINE"
            maxLength={50}
            required
            className={FORM_INPUT_CLASS}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 lg:col-start-3 lg:row-start-1">
          <span className={EDITOR_LABEL_CLASS}>{INPUT_LABELS[kind]}</span>
          <input
            type="text"
            inputMode={inputMode}
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder={INPUT_PLACEHOLDERS[kind]}
            required
            className={`${FORM_INPUT_CLASS} font-mono text-xs`}
          />
          <span className={EDITOR_HELP_CLASS}>{INPUT_HELP[kind]}</span>
        </label>
      </div>

      {error && (
        <p className={`${FORM_ERROR_CLASS} mt-3`}>{error}</p>
      )}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={`${EDITOR_SECONDARY_BUTTON_CLASS} gap-1.5`}
        >
          <X size={16} strokeWidth={2.3} aria-hidden="true" />
          <span>キャンセル</span>
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className={`${EDITOR_PRIMARY_BUTTON_CLASS} gap-1.5`}
        >
          {!busy && <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
          <span>{busy ? '保存中...' : mode === 'create' ? '追加する' : '保存する'}</span>
        </button>
      </div>
    </div>
  );
}

function MyLinkRow({
  link,
  editing,
  menuOpen,
  busy,
  checkingDelete,
  draftLabel,
  draftUrl,
  draftKind,
  editError,
  onDraftKindChange,
  onDraftLabelChange,
  onDraftUrlChange,
  onCancelEdit,
  onSave,
  onStartEdit,
  onPrepareRemove,
  onToggleMenu,
}: {
  link: MyLink;
  editing: boolean;
  menuOpen: boolean;
  busy: boolean;
  checkingDelete: boolean;
  draftLabel: string;
  draftUrl: string;
  draftKind: MyLinkKind;
  editError: string | null;
  onDraftKindChange: (value: MyLinkKind) => void;
  onDraftLabelChange: (value: string) => void;
  onDraftUrlChange: (value: string) => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onStartEdit: () => void;
  onPrepareRemove: () => void;
  onToggleMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <li
      className={`relative rounded-2xl border border-white/75 bg-white/88 p-3 shadow-[0_10px_26px_rgba(31,34,48,0.05)] ${
        menuOpen ? 'z-30' : 'z-0'
      }`}
    >
      {editing ? (
        <MyLinkForm
          mode="edit"
          kind={draftKind}
          label={draftLabel}
          url={draftUrl}
          error={editError}
          busy={busy}
          onKindChange={onDraftKindChange}
          onLabelChange={onDraftLabelChange}
          onUrlChange={onDraftUrlChange}
          onCancel={onCancelEdit}
          onSubmit={onSave}
        />
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef4fb] text-[#567baf]">
            <Link2 size={18} strokeWidth={2.4} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-sm font-extrabold text-[#3f4352]">
                {link.label}
              </span>
              <span className="shrink-0 rounded-full bg-[#eef4fb] px-2 py-0.5 text-[10px] font-extrabold text-[#567baf]">
                {KIND_LABELS[inferMyLinkKind(link.url)]}
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-xs font-semibold text-[#8b91a1]">
              {displayMyLinkValue(link.url)}
            </div>
          </div>
          <div className="hidden shrink-0 gap-2 sm:flex">
            <button
              type="button"
              onClick={onStartEdit}
              disabled={busy}
              className={`${EDITOR_SECONDARY_BUTTON_CLASS} min-h-[2.5rem] gap-1.5 px-3 py-2 text-xs`}
            >
              <Pencil size={15} strokeWidth={2.3} aria-hidden="true" />
              <span>編集</span>
            </button>
            <button
              type="button"
              onClick={onPrepareRemove}
              disabled={busy || checkingDelete}
              className={`${EDITOR_DANGER_BUTTON_CLASS} min-h-[2.5rem] gap-1.5 px-3 py-2 text-xs`}
            >
              <Trash2 size={15} strokeWidth={2.3} aria-hidden="true" />
              <span>{checkingDelete ? '確認中...' : '削除'}</span>
            </button>
          </div>
          <div className="relative shrink-0 sm:hidden">
            <button
              type="button"
              onClick={onToggleMenu}
              disabled={busy}
              aria-label={`${link.label}の操作`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#7f8797] transition hover:bg-[#f2f4f8] hover:text-[#567baf] disabled:opacity-50"
            >
              <MoreVertical size={22} strokeWidth={2.3} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-[calc(100%+0.375rem)] z-[140] w-44 overflow-hidden rounded-2xl border border-white/75 bg-white/95 p-1.5 shadow-[0_18px_42px_rgba(31,34,48,0.16)] backdrop-blur-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={onStartEdit}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold text-[#596173] transition hover:bg-[#567baf]/10 hover:text-[#567baf] disabled:opacity-50"
                >
                  <Pencil size={16} strokeWidth={2.3} aria-hidden="true" />
                  <span>編集</span>
                </button>
                <button
                  type="button"
                  onClick={onPrepareRemove}
                  disabled={busy || checkingDelete}
                  className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={16} strokeWidth={2.3} aria-hidden="true" />
                  <span>{checkingDelete ? '確認中...' : '削除'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function EmptyLinksState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#d7deea] bg-[#f6f8fb]/70 px-4 py-10 text-center text-[#8b91a1]">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef4fb] text-[#567baf]">
        <Link2 size={22} strokeWidth={2.4} aria-hidden="true" />
      </div>
      <p className="m-0 text-sm font-extrabold text-[#596173]">
        登録したリンクはまだありません
      </p>
      <button
        type="button"
        onClick={onCreate}
        className={`${EDITOR_PRIMARY_BUTTON_CLASS} mt-4 min-h-12 gap-2 px-5`}
      >
        <Plus size={17} strokeWidth={2.4} aria-hidden="true" />
        <span>リンクを追加</span>
      </button>
    </div>
  );
}

function MyLinkDeleteDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: { link: MyLink; usage: MyLinkUsage };
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AdminModal
      ariaLabel="よく使うリンクを削除"
      closeOnBackdrop={!busy}
      onClose={onCancel}
      panelClassName="p-5 sm:p-6"
    >
      <div className="mb-4 inline-flex rounded-full bg-red-50 px-3 py-1 text-xs font-extrabold text-red-700">
        確認
      </div>
      <h2 className="text-base font-extrabold leading-snug text-[#3f4352]">
        「{target.link.label}」を削除しますか？
      </h2>

      {target.usage.usageCount > 0 ? (
        <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-semibold leading-relaxed text-red-800">
          <p className="font-extrabold">
            このリンクはLPボタン {target.usage.usageCount}箇所で使われています。
          </p>
          <p className="mt-2">
            削除してもLPボタンは消えず、現在のURLのまま残ります。ただし、今後このリンクからまとめて変更できなくなります。
          </p>
          {target.usage.pages.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-red-700">
              {target.usage.pages.slice(0, 3).map((page) => (
                <li key={page.id}>
                  /{page.slug}：{page.count}箇所
                </li>
              ))}
              {target.usage.pages.length > 3 && (
                <li>ほか {target.usage.pages.length - 3}件</li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <p className={`${EDITOR_HELP_CLASS} mt-4 text-sm`}>
          このリンクは現在、LPボタンでは使われていません。
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={EDITOR_SECONDARY_BUTTON_CLASS}
        >
          キャンセル
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full bg-[#b83232] px-4 py-2 text-sm font-extrabold text-white shadow-[0_14px_28px_rgba(184,50,50,0.18)] transition hover:bg-[#a62d2d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '削除中...' : '削除する'}
        </button>
      </div>
    </AdminModal>
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
