import { useEffect, useState } from 'react';
import { notifySiteSettingsStatusChanged } from '../../lib/site-settings-events';
import {
  EDITOR_HELP_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EditorField,
  EditorSectionHeader,
  EditorSubPanel,
} from './LpEditorPrimitives';

interface LegalLinksForm {
  termsOfServiceUrl: string;
  privacyPolicyUrl: string;
  commercialTransactionUrl: string;
}

const EMPTY: LegalLinksForm = {
  termsOfServiceUrl: '',
  privacyPolicyUrl: '',
  commercialTransactionUrl: '',
};

export default function SiteLegalLinksPanel() {
  const [form, setForm] = useState<LegalLinksForm>(EMPTY);
  const [savedForm, setSavedForm] = useState<LegalLinksForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    tone: 'success' | 'danger';
  } | null>(null);
  const normalizedForm = normalizeForm(form);
  const hasChanges = !isSameForm(normalizedForm, savedForm);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/site-meta');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: {
          termsOfServiceUrl: string | null;
          privacyPolicyUrl: string | null;
          commercialTransactionUrl: string | null;
        };
      };
      const loadedForm = {
        termsOfServiceUrl: json.data.termsOfServiceUrl ?? '',
        privacyPolicyUrl: json.data.privacyPolicyUrl ?? '',
        commercialTransactionUrl: json.data.commercialTransactionUrl ?? '',
      };
      setForm(loadedForm);
      setSavedForm(normalizeForm(loadedForm));
    } catch (err) {
      setToast({
        tone: 'danger',
        message: `法務リンクを取得できませんでした。${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }

  function set<K extends keyof LegalLinksForm>(key: K, value: LegalLinksForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (saving || !hasChanges) return;
    const nextForm = normalizeForm(form);
    setSaving(true);
    try {
      const res = await fetch('/api/site-meta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          termsOfServiceUrl: toPayloadValue(nextForm.termsOfServiceUrl),
          privacyPolicyUrl: toPayloadValue(nextForm.privacyPolicyUrl),
          commercialTransactionUrl: toPayloadValue(
            nextForm.commercialTransactionUrl
          ),
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
      setForm(nextForm);
      setSavedForm(nextForm);
      setToast({
        tone: 'success',
        message: '法務リンクを保存しました。\n公開LPのfooterに反映されます。',
      });
      notifySiteSettingsStatusChanged();
    } catch (err) {
      setToast({
        tone: 'danger',
        message: `保存できませんでした。${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-[#8b91a1]">読み込み中...</p>;

  return (
    <EditorSubPanel className="space-y-4 bg-white/85">
      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-[180] -translate-x-1/2 -translate-y-1/2">
          <div
            role="status"
            aria-live="polite"
            className={`pointer-events-auto flex min-h-[4rem] w-[calc(100vw-32px)] max-w-[24rem] items-center justify-center whitespace-pre-line rounded-xl border px-5 py-4 text-center text-sm font-semibold leading-relaxed break-words shadow-xl sm:w-[24rem] sm:px-6 sm:py-5 sm:text-base ${
              toast.tone === 'danger'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
      <EditorSectionHeader
        title="法務リンク"
        description="公開LPの下部に表示する外部ページURLを設定します。"
      />
      <div className="grid gap-4">
        <EditorField label="利用規約URL">
          <input
            type="url"
            inputMode="url"
            value={form.termsOfServiceUrl}
            onChange={(e) => set('termsOfServiceUrl', e.target.value)}
            placeholder="https://example.com/terms"
            className={EDITOR_INPUT_CLASS}
          />
        </EditorField>
        <EditorField label="プライバシーポリシーURL">
          <input
            type="url"
            inputMode="url"
            value={form.privacyPolicyUrl}
            onChange={(e) => set('privacyPolicyUrl', e.target.value)}
            placeholder="https://example.com/privacy"
            className={EDITOR_INPUT_CLASS}
          />
        </EditorField>
        <EditorField label="特定商取引法URL">
          <input
            type="url"
            inputMode="url"
            value={form.commercialTransactionUrl}
            onChange={(e) => set('commercialTransactionUrl', e.target.value)}
            placeholder="https://example.com/tokushoho"
            className={EDITOR_INPUT_CLASS}
          />
        </EditorField>
      </div>
      <p className={EDITOR_HELP_CLASS}>
        内部LPのURL末尾ではなく、https:// から始まる外部URLだけを入力します。
      </p>
      <button
        type="button"
        onClick={save}
        disabled={!hasChanges || saving}
        aria-busy={saving}
        className={EDITOR_PRIMARY_BUTTON_CLASS}
      >
        保存
      </button>
    </EditorSubPanel>
  );
}

function normalizeForm(form: LegalLinksForm): LegalLinksForm {
  return {
    termsOfServiceUrl: form.termsOfServiceUrl.trim(),
    privacyPolicyUrl: form.privacyPolicyUrl.trim(),
    commercialTransactionUrl: form.commercialTransactionUrl.trim(),
  };
}

function isSameForm(a: LegalLinksForm, b: LegalLinksForm): boolean {
  return (
    a.termsOfServiceUrl === b.termsOfServiceUrl &&
    a.privacyPolicyUrl === b.privacyPolicyUrl &&
    a.commercialTransactionUrl === b.commercialTransactionUrl
  );
}

function toPayloadValue(value: string): string | null {
  return value ? value : null;
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
