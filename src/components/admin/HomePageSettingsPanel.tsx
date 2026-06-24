import { useEffect, useMemo, useState } from 'react';
import { showAdminToast } from '../../lib/admin-toast';
import { notifySiteSettingsStatusChanged } from '../../lib/site-settings-events';
import {
  AdminCallout,
  AdminStatusPill,
  EDITOR_HELP_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_SELECT_CLASS,
  EditorField,
  EditorSectionHeader,
  EditorSubPanel,
} from './LpEditorPrimitives';

interface PageOption {
  id: string;
  title: string | null;
  slug: string;
  status: 'published';
}

interface HomePageState {
  homePageId: string | null;
  homePage: PageOption | null;
  homePageNeedsReview: boolean;
  publishedPages: PageOption[];
}

const EMPTY_STATE: HomePageState = {
  homePageId: null,
  homePage: null,
  homePageNeedsReview: false,
  publishedPages: [],
};

export default function HomePageSettingsPanel() {
  const [state, setState] = useState<HomePageState>(EMPTY_STATE);
  const [selectedId, setSelectedId] = useState('');
  const [currentOrigin, setCurrentOrigin] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.origin
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') setCurrentOrigin(window.location.origin);
    void load();
  }, []);

  const selectedValue = selectedId || null;
  const hasChanges = selectedValue !== state.homePageId;
  const rootUrl = `${currentOrigin || ''}/`;
  const selectedPage = useMemo(
    () => state.publishedPages.find((page) => page.id === selectedId) ?? null,
    [selectedId, state.publishedPages]
  );
  const resolvedTarget = selectedPage ?? state.homePage;

  async function load() {
    setLoading(true);
    try {
      const homepageRes = await fetch('/api/site-homepage');
      if (!homepageRes.ok) throw new Error(await readApiError(homepageRes, '取得失敗'));
      const homepageJson = (await homepageRes.json()) as {
        success: true;
        data: HomePageState;
      };
      setState(homepageJson.data);
      const validSelected = homepageJson.data.publishedPages.some(
        (page) => page.id === homepageJson.data.homePageId
      );
      setSelectedId(validSelected && homepageJson.data.homePageId
        ? homepageJson.data.homePageId
        : '');
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `サイトトップ設定を取得できませんでした。${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (saving || !hasChanges) return;
    setSaving(true);
    try {
      const res = await fetch('/api/site-homepage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homePageId: selectedId || null }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
      const json = (await res.json()) as { success: true; data: HomePageState };
      setState(json.data);
      const validSelected = json.data.publishedPages.some(
        (page) => page.id === json.data.homePageId
      );
      setSelectedId(validSelected && json.data.homePageId ? json.data.homePageId : '');
      showAdminToast({ message: 'サイトトップ設定を保存しました。' });
      notifySiteSettingsStatusChanged();
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `保存できませんでした。${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-[#8b91a1]">読み込み中...</p>;

  return (
    <EditorSubPanel className="space-y-5 bg-white/85">
      <EditorSectionHeader
        title="サイトトップ"
        description="公開URLの / にアクセスされた時に開くLPを選びます。"
      />

      <div className="rounded-2xl bg-[#f8fafc] px-4 py-3 ring-1 ring-[#e2e7f0]">
        <p className="text-xs font-extrabold text-[#687082]">公開URL</p>
        <a
          href={rootUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block break-all font-mono text-sm font-bold text-[#567baf] underline decoration-[#b9c9df] underline-offset-4 transition hover:text-[#3f638f]"
        >
          {rootUrl}
        </a>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {resolvedTarget ? (
            <>
              <AdminStatusPill tone="success">設定済み</AdminStatusPill>
              <span className="text-xs font-bold text-[#596173]">
                /{resolvedTarget.slug} へ移動します
              </span>
            </>
          ) : state.homePageNeedsReview ? (
            <>
              <AdminStatusPill tone="warning">要確認</AdminStatusPill>
              <span className="text-xs font-bold text-amber-800">
                選択中のLPが公開されていません
              </span>
            </>
          ) : (
            <>
              <AdminStatusPill tone="neutral">未設定</AdminStatusPill>
              <span className="text-xs font-bold text-[#596173]">
                /admin へ移動します
              </span>
            </>
          )}
        </div>
      </div>

      {state.homePageNeedsReview && (
        <AdminCallout tone="warning">
          以前選んだLPが非公開・削除・終了済みになっています。別の公開中LPを選ぶか、未設定に戻してください。
        </AdminCallout>
      )}

      <EditorField
        label="サイトトップで開くLP"
        help="ここで選んだLPのURL末尾はそのまま残ります。/ は選択LPへ移動する入口です。"
      >
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={EDITOR_SELECT_CLASS}
          disabled={saving}
        >
          <option value="">未設定（/admin へ移動）</option>
          {state.publishedPages.map((page) => (
            <option key={page.id} value={page.id}>
              {(page.title?.trim() || page.slug)} /{page.slug}
            </option>
          ))}
        </select>
      </EditorField>

      {state.publishedPages.length === 0 && (
        <AdminCallout tone="info">
          公開中のLPがまだありません。LPを公開すると、ここでサイトトップで開くLPに選べます。
        </AdminCallout>
      )}

      <p className={EDITOR_HELP_CLASS}>
        管理画面はこれまで通り /admin です。公開LPは /URL末尾 のまま使えます。
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={save}
          disabled={!hasChanges || saving}
          aria-busy={saving}
          className={EDITOR_PRIMARY_BUTTON_CLASS}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </EditorSubPanel>
  );
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as {
      success: false;
      error: { message: string };
    };
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
