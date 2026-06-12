/**
 * AdminMembersPanel
 *
 * Lists every admin in the current workspace, lets the operator
 * add a new one by email, and lets them remove anyone except
 * themselves.
 */

import { Check, Info, Mail, MoreVertical, Plus, Trash2, UserPlus, X } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { showAdminToast } from '../../lib/admin-toast';
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

interface Admin {
  id: string;
  email: string;
  role: string;
  created_at: string;
  last_login_at: string | null;
  signed_in: boolean;
}

interface Props {
  currentAdminId: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

const FORM_ERROR_CLASS =
  'whitespace-pre-line rounded-xl bg-red-50 px-3 py-2 text-xs font-bold leading-relaxed text-red-700';
const FIELD_ERROR_CLASS = 'text-xs font-bold leading-relaxed text-red-600';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminMembersPanel({ currentAdminId }: Props) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-action-menu]')) return;
      setOpenMenuId(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  async function load() {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin-members');
      if (!res.ok) throw new Error(await readApiError(res, '取得に失敗しました'));
      const json = (await res.json()) as {
        success: true;
        data: { admins: Admin[] };
      };
      setAdmins(json.data.admins);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      showAdminToast({
        tone: 'danger',
        message: `メンバー一覧を取得できませんでした。${message}`,
      });
    } finally {
      setLoading(false);
    }
  }

  function openAddForm() {
    setAdding(true);
    setErrorMessage(null);
    setAddError(null);
  }

  function closeAddForm() {
    setAdding(false);
    setNewEmail('');
    setAddError(null);
    setErrorMessage(null);
  }

  async function addAdmin() {
    if (busy) return;
    const email = newEmail.trim().toLowerCase();
    if (!email) {
      setAddError('メールアドレスを入力してください');
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setAddError('正しいメールアドレスを入力してください');
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    setAddError(null);
    try {
      const res = await fetch('/api/admin-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '追加に失敗しました'));
      closeAddForm();
      await load();
      showAdminToast({ message: 'メンバーを追加しました。' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAddError(message);
      showAdminToast({
        tone: 'danger',
        message: `メンバーを追加できませんでした。${message}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function askRemoveAdmin(admin: Admin) {
    if (busy) return;
    setOpenMenuId(null);
    const ok = await confirmAdminAction({
      title: `${admin.email} を削除しますか？`,
      message:
        'このメンバーは管理画面にログインできなくなります。LPや公開ページは削除されません。',
      confirmLabel: '削除する',
      cancelLabel: 'キャンセル',
      tone: 'danger',
    });
    if (!ok) return;
    await removeAdmin(admin.id);
  }

  async function removeAdmin(id: string) {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin-members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '削除に失敗しました'));
      await load();
      showAdminToast({ tone: 'danger', message: 'メンバーを削除しました。' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      showAdminToast({
        tone: 'danger',
        message: `メンバーを削除できませんでした。${message}`,
      });
    } finally {
      setBusy(false);
    }
  }

  const sortedAdmins = useMemo(() => {
    return [...admins].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [admins]);

  return (
    <div className={EDITOR_TIGHT_STACK_CLASS}>
      {errorMessage && <p className={FORM_ERROR_CLASS}>{errorMessage}</p>}

      <EditorPanel>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <EditorSectionHeader
            title="メンバー一覧"
            titleAdornment={
              admins.length > 0 ? (
                <span className="rounded-full bg-[#eef4fb] px-2.5 py-1 text-xs font-extrabold text-[#567baf]">
                  {admins.length}人
                </span>
              ) : undefined
            }
            description="管理画面に入れるGoogleアカウントを管理します。"
          />
          {!adding && (
            <button
              type="button"
              onClick={openAddForm}
              disabled={busy}
              className={`${EDITOR_PRIMARY_BUTTON_CLASS} min-h-14 gap-2 px-5 text-base sm:min-h-[2.75rem] sm:px-4 sm:text-sm`}
            >
              <Plus size={17} strokeWidth={2.4} aria-hidden="true" />
              <span>メンバーを追加</span>
            </button>
          )}
        </div>

        {adding && (
          <MemberAddForm
            email={newEmail}
            error={addError}
            busy={busy}
            onEmailChange={(value) => {
              setNewEmail(value);
              if (addError) setAddError(null);
            }}
            onSubmit={() => void addAdmin()}
            onCancel={closeAddForm}
          />
        )}

        {loading ? (
          <EmptyMembersState label="読み込み中..." />
        ) : sortedAdmins.length === 0 ? (
          <EmptyMembersState label="メンバーが登録されていません。" onCreate={openAddForm} />
        ) : (
          <ul className="space-y-3">
            {sortedAdmins.map((admin) => (
              <MemberRow
                key={admin.id}
                admin={admin}
                isMe={admin.id === currentAdminId}
                busy={busy}
                menuOpen={openMenuId === admin.id}
                onToggleMenu={(event) => {
                  event.stopPropagation();
                  setOpenMenuId(openMenuId === admin.id ? null : admin.id);
                }}
                onRemove={() => void askRemoveAdmin(admin)}
              />
            ))}
          </ul>
        )}
      </EditorPanel>

      <section className={`${EDITOR_SUB_PANEL_CLASS} flex gap-3 border border-[#c8d5e8]/80 bg-[#f3f7fd]/78 text-sm text-[#2f4f78]`}>
        <Info size={18} strokeWidth={2.3} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="mb-1 font-extrabold">追加の流れ</p>
          <ol className="space-y-0.5 text-[0.82rem] font-semibold leading-relaxed">
            <li>1. メールアドレスを登録します。</li>
            <li>2. 相手にこの管理画面のURLを共有します。</li>
            <li>3. 相手がGoogleアカウントでログインすると使えるようになります。</li>
          </ol>
        </div>
      </section>
    </div>
  );
}

function MemberAddForm({
  email,
  error,
  busy,
  onEmailChange,
  onSubmit,
  onCancel,
}: {
  email: string;
  error: string | null;
  busy: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={`${EDITOR_SUB_PANEL_CLASS} mb-4 border border-[#d7deea]/80 bg-[#f8fafc]/82`}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={EDITOR_LABEL_CLASS}>Googleアカウントのメールアドレス</span>
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="someone@example.com"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'admin-member-email-error' : undefined}
            className={`${EDITOR_INPUT_CLASS} w-full`}
            autoFocus
          />
          {error && (
            <span id="admin-member-email-error" className={FIELD_ERROR_CLASS}>
              {error}
            </span>
          )}
          <span className={EDITOR_HELP_CLASS}>
            登録したメールアドレスのGoogleアカウントだけがログインできます
          </span>
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={`${EDITOR_SECONDARY_BUTTON_CLASS} min-h-14 gap-1.5 text-base sm:min-h-[2.75rem] sm:text-sm`}
          >
            <X size={16} strokeWidth={2.3} aria-hidden="true" />
            <span>キャンセル</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSubmit}
            className={`${EDITOR_PRIMARY_BUTTON_CLASS} min-h-14 gap-1.5 text-base sm:min-h-[2.75rem] sm:text-sm`}
          >
            {!busy && <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
            <span>{busy ? '追加中...' : '追加する'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  admin,
  isMe,
  busy,
  menuOpen,
  onToggleMenu,
  onRemove,
}: {
  admin: Admin;
  isMe: boolean;
  busy: boolean;
  menuOpen: boolean;
  onToggleMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={`relative rounded-2xl border border-white/75 bg-white/88 p-3 shadow-[0_10px_26px_rgba(31,34,48,0.05)] ${
        menuOpen ? 'z-30' : 'z-0'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef4fb] text-[#567baf]">
          <Mail size={18} strokeWidth={2.4} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-extrabold text-[#3f4352]">
              {admin.email}
            </span>
            {isMe && (
              <span className="shrink-0 rounded-full bg-[#eef4fb] px-2 py-0.5 text-[10px] font-extrabold text-[#567baf]">
                自分
              </span>
            )}
            {!admin.signed_in && (
              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">
                未ログイン
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-semibold leading-relaxed text-[#8b91a1]">
            追加 {formatDateTime(admin.created_at)}
            {admin.last_login_at && (
              <>
                {' '}｜ 最終ログイン {formatDateTime(admin.last_login_at)}
              </>
            )}
          </p>
        </div>

        {!isMe && (
          <>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className={`${EDITOR_DANGER_BUTTON_CLASS} max-lg:!hidden min-h-[2.5rem] shrink-0 gap-1.5 px-3 py-2 text-xs lg:!inline-flex`}
            >
              <Trash2 size={15} strokeWidth={2.3} aria-hidden="true" />
              <span>削除</span>
            </button>
            <div className="relative shrink-0 lg:hidden" data-action-menu>
              <button
                type="button"
                aria-label={`${admin.email}の操作`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={onToggleMenu}
                disabled={busy}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#7f8797] transition hover:bg-[#f2f4f8] hover:text-[#567baf] disabled:opacity-50"
              >
                <MoreVertical size={22} strokeWidth={2.3} aria-hidden="true" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+0.375rem)] z-[140] w-40 overflow-hidden rounded-2xl border border-white/75 bg-white/95 p-1.5 shadow-[0_18px_42px_rgba(31,34,48,0.16)] backdrop-blur-xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={onRemove}
                    disabled={busy}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={16} strokeWidth={2.3} aria-hidden="true" />
                    <span>削除</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function EmptyMembersState({
  label,
  onCreate,
}: {
  label: string;
  onCreate?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[#d7deea] bg-[#f6f8fb]/70 px-4 py-10 text-center text-[#8b91a1]">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef4fb] text-[#567baf]">
        <UserPlus size={22} strokeWidth={2.4} aria-hidden="true" />
      </div>
      <p className="m-0 text-sm font-extrabold text-[#596173]">{label}</p>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className={`${EDITOR_PRIMARY_BUTTON_CLASS} mt-4 min-h-12 gap-2 px-5`}
        >
          <Plus size={17} strokeWidth={2.4} aria-hidden="true" />
          <span>メンバーを追加</span>
        </button>
      )}
    </div>
  );
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.json()) as ApiError;
    if (!json.success && json.error?.message) return json.error.message;
  } catch {
    // ignore; fall through to status fallback
  }
  return `${fallback} (${res.status})`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}
