import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { showAdminToast } from '../../lib/admin-toast';

interface Props {
  lpId: string;
  title: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

const TITLE_MAX = 80;
const INPUT_CLASS =
  'rounded-xl border border-[#d7deea] bg-white px-3 py-2 text-lg font-extrabold text-[#3f4352] outline-none transition focus:border-[#9bb4d6] focus:ring-2 focus:ring-[#d8e3f2]';
const PRIMARY_BUTTON_CLASS =
  'rounded-full bg-[#567baf] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(86,123,175,0.16)] transition hover:bg-[#4c6f9f] disabled:opacity-50';
const SECONDARY_BUTTON_CLASS =
  'rounded-full bg-[#f2f4f8] px-4 py-2 text-sm font-extrabold text-[#596173] transition hover:bg-[#e9edf4] disabled:opacity-50';

export default function LpTitleControl({ lpId, title: initialTitle }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(title);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(title);
    setEditing(false);
  }

  async function save() {
    const next = draft.trim();
    if (next.length === 0) {
      showAdminToast({ tone: 'danger', message: 'LP名を入力してください' });
      return;
    }
    if (next.length > TITLE_MAX) {
      showAdminToast({
        tone: 'danger',
        message: `LP名は${TITLE_MAX}文字以下で入力してください`,
      });
      return;
    }
    if (next === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '更新失敗'));
      setTitle(next);
      setEditing(false);
      showAdminToast({ message: 'LP名を変更しました。' });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            maxLength={TITLE_MAX}
            className={`${INPUT_CLASS} w-full min-w-[180px] max-w-[28rem] sm:w-[24rem] md:w-[28rem]`}
          />
          <div className="flex w-full gap-2 sm:w-auto">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={`${PRIMARY_BUTTON_CLASS} flex-1 sm:flex-none`}
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className={`${SECONDARY_BUTTON_CLASS} flex-1 sm:flex-none`}
            >
              キャンセル
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lp-title-control group mt-1 flex min-w-0 flex-wrap items-center gap-2">
      <h1>{title}</h1>
      <button
        type="button"
        onClick={startEdit}
        className="inline-flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-xs font-extrabold text-[#567baf] transition hover:text-[#476895]"
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
        編集
      </button>
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
