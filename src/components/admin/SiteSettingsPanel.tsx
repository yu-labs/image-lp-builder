/**
 * SiteSettingsPanel
 *
 * Form for the site-wide tracking tag IDs (Google Tag Manager,
 * GA4, Microsoft Clarity, Meta Pixel) plus a free-form custom HTML
 * block injected into <head>. Saves are batched on a single
 * "保存" click rather than per-field blur, so the user can review
 * the whole form before committing.
 */

import { useEffect, useState } from 'react';
import { showAdminToast } from '../../lib/admin-toast';
import { notifySiteSettingsStatusChanged } from '../../lib/site-settings-events';
import {
  AdminActionRow,
  AdminCallout,
  AdminStatusPill,
  AdminToggleSwitch,
  EDITOR_HELP_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_SUB_PANEL_CLASS,
  EditorSectionHeader,
} from './LpEditorPrimitives';

interface TagsForm {
  gtmId: string;
  ga4Id: string;
  clarityId: string;
  metaPixelId: string;
  customHead: string;
}

interface SiteSettingsResponse {
  maintenanceMode: boolean;
  updatedAt: string;
}

type ApiError = { success: false; error: { code: string; message: string } };
type SiteSettingsVariant = 'all' | 'maintenance' | 'tracking' | 'customHead';
type TrackingFieldKey = 'gtmId' | 'ga4Id' | 'clarityId' | 'metaPixelId';

interface Props {
  variant?: SiteSettingsVariant;
  trackingField?: TrackingFieldKey;
  hideHeading?: boolean;
}

const TRACKING_FIELDS: Record<
  TrackingFieldKey,
  { label: string; help: string; placeholder: string; intro: string }
> = {
  gtmId: {
    label: 'Google Tag Manager(GTM-XXXXXXX)',
    help: '入れておくと、GA4 / Meta Pixel / その他全部GTM経由で管理できます',
    placeholder: 'GTM-XXXXXXX',
    intro: '複数の計測タグをまとめて管理するためのIDを設定します。',
  },
  ga4Id: {
    label: 'Google Analytics 4(G-XXXXXXX)',
    help: 'GTMを使わない場合の直接設定',
    placeholder: 'G-XXXXXXX',
    intro: 'LPへのアクセス数や流入元を見るためのIDを設定します。',
  },
  clarityId: {
    label: 'Microsoft Clarity ID',
    help: '無料のヒートマップ・操作録画ツール',
    placeholder: 'abcdefghij',
    intro: '訪問者のスクロールやクリックの様子を見るためのIDを設定します。',
  },
  metaPixelId: {
    label: 'Meta Pixel ID（Facebook / Instagram広告）',
    help: '数字のみのID',
    placeholder: '000000000000000',
    intro: 'Facebook / Instagram広告の成果計測に使うIDを設定します。',
  },
};

const EMPTY: TagsForm = {
  gtmId: '',
  ga4Id: '',
  clarityId: '',
  metaPixelId: '',
  customHead: '',
};

const TRACKING_PATTERNS: Record<
  TrackingFieldKey,
  { normalize: (value: string) => string; pattern: RegExp; message: string }
> = {
  gtmId: {
    normalize: (value) => value.toUpperCase(),
    pattern: /^GTM-[A-Z0-9]+$/,
    message: 'GTM IDは GTM-XXXXXXX の形式で入力してください',
  },
  ga4Id: {
    normalize: (value) => value.toUpperCase(),
    pattern: /^G-[A-Z0-9]+$/,
    message: 'GA4 IDは G-XXXXXXX の形式で入力してください',
  },
  clarityId: {
    normalize: (value) => value,
    pattern: /^[A-Za-z0-9_-]{6,64}$/,
    message: 'Clarity IDは英数字のプロジェクトIDを入力してください',
  },
  metaPixelId: {
    normalize: (value) => value,
    pattern: /^\d{5,30}$/,
    message: 'Meta Pixel IDは半角数字で入力してください',
  },
};

const CUSTOM_HEAD_TAG_RE =
  /<(script|noscript|style|link|meta)\b[\s\S]*?>/i;
const DISALLOWED_CUSTOM_HEAD_TAG_RE = /<(img|iframe)\b[\s\S]*?>/i;
const CUSTOM_HEAD_CLOSING_TAGS = ['script', 'noscript', 'style'];

function normalizeTrackingValue(key: TrackingFieldKey, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return TRACKING_PATTERNS[key].normalize(trimmed);
}

function validateTrackingValue(key: TrackingFieldKey, value: string): string | null {
  const normalized = normalizeTrackingValue(key, value);
  if (!normalized) return null;
  return TRACKING_PATTERNS[key].pattern.test(normalized)
    ? null
    : TRACKING_PATTERNS[key].message;
}

function validateCustomHead(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (DISALLOWED_CUSTOM_HEAD_TAG_RE.test(trimmed)) {
    return 'カスタムHTMLは<head>内に出力されるため、<img> や <iframe> は使えません';
  }
  if (!CUSTOM_HEAD_TAG_RE.test(trimmed)) {
    return 'カスタムHTMLは <script>、<meta>、<link> など<head>用のHTMLタグを入力してください';
  }
  for (const tag of CUSTOM_HEAD_CLOSING_TAGS) {
    const openCount = trimmed.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))?.length ?? 0;
    const closeCount = trimmed.match(new RegExp(`</${tag}>`, 'gi'))?.length ?? 0;
    if (openCount !== closeCount) {
      return `<${tag}> タグは閉じタグ </${tag}> まで入力してください`;
    }
  }
  return null;
}

function toTagsForm(data: {
  gtmId: string | null;
  ga4Id: string | null;
  clarityId: string | null;
  metaPixelId: string | null;
  customHead: string | null;
}): TagsForm {
  return {
    gtmId: data.gtmId ?? '',
    ga4Id: data.ga4Id ?? '',
    clarityId: data.clarityId ?? '',
    metaPixelId: data.metaPixelId ?? '',
    customHead: data.customHead ?? '',
  };
}

export default function SiteSettingsPanel({
  variant = 'all',
  trackingField,
  hideHeading = false,
}: Props) {
  const [form, setForm] = useState<TagsForm>(EMPTY);
  const [original, setOriginal] = useState<TagsForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [maintenanceMode, setMaintenanceMode] = useState<boolean | null>(null);
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customHeadValidated, setCustomHeadValidated] = useState(false);
  const [validatedTrackingFields, setValidatedTrackingFields] = useState<
    Partial<Record<TrackingFieldKey, boolean>>
  >({});

  useEffect(() => {
    void load();
    void loadSiteSettings();
  }, []);

  async function loadSiteSettings() {
    try {
      const res = await fetch('/api/site-settings');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as { success: true; data: SiteSettingsResponse };
      setMaintenanceMode(json.data.maintenanceMode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      showAdminToast({ tone: 'danger', message: `サイト設定を取得できませんでした。${message}` });
    }
  }

  async function toggleMaintenance(next: boolean) {
    setSavingMaintenance(true);
    try {
      const res = await fetch('/api/site-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maintenanceMode: next }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
      setMaintenanceMode(next);
      notifySiteSettingsStatusChanged();
      showAdminToast({ message: next ? 'メンテナンス表示をONにしました。' : 'メンテナンス表示をOFFにしました。' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      showAdminToast({ tone: 'danger', message: `保存できませんでした。${message}` });
    } finally {
      setSavingMaintenance(false);
    }
  }

  async function load() {
    setErrorMessage(null);
    try {
      const res = await fetch('/api/tracking-tags');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: {
          gtmId: string | null;
          ga4Id: string | null;
          clarityId: string | null;
          metaPixelId: string | null;
          customHead: string | null;
        };
      };
      const fresh = toTagsForm(json.data);
      setForm(fresh);
      setOriginal(fresh);
      setValidatedTrackingFields({});
      setCustomHeadValidated(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      showAdminToast({ tone: 'danger', message: `計測設定を取得できませんでした。${message}` });
    } finally {
      setLoading(false);
    }
  }

  function set<K extends keyof TagsForm>(key: K, value: TagsForm[K]) {
    setErrorMessage(null);
    setForm((cur) => ({ ...cur, [key]: value }));
  }

  const showMaintenance = variant === 'all' || variant === 'maintenance';
  const showTracking = variant === 'all' || variant === 'tracking';
  const showCustomHead = variant === 'all' || variant === 'customHead';
  const visibleTrackingFields = trackingField
    ? [trackingField]
    : (Object.keys(TRACKING_FIELDS) as TrackingFieldKey[]);
  const visibleTrackingErrors = Object.fromEntries(
    visibleTrackingFields.map((key) => [key, validateTrackingValue(key, form[key])])
  ) as Partial<Record<TrackingFieldKey, string | null>>;
  const trackingKeysToSave = showTracking ? visibleTrackingFields : [];
  const hasVisibleTrackingError = trackingKeysToSave.some(
    (key) => validatedTrackingFields[key] && visibleTrackingErrors[key]
  );
  const trackingIntro = trackingField
    ? TRACKING_FIELDS[trackingField].intro
    : '広告やアクセス解析に使うIDを設定します。空欄なら出力されません。';
  const customHeadError = showCustomHead
    ? validateCustomHead(form.customHead)
    : null;
  const isDirty = JSON.stringify(form) !== JSON.stringify(original);

  async function save() {
    const firstTrackingError =
      trackingKeysToSave
        .map((key) => validateTrackingValue(key, form[key]))
        .find(Boolean) ?? null;
    if (firstTrackingError) {
      setValidatedTrackingFields((cur) => ({
        ...cur,
        ...Object.fromEntries(trackingKeysToSave.map((key) => [key, true])),
      }));
      setErrorMessage(firstTrackingError);
      showAdminToast({ tone: 'danger', message: firstTrackingError });
      return;
    }
    if (customHeadError) {
      setCustomHeadValidated(true);
      setErrorMessage(customHeadError);
      showAdminToast({ tone: 'danger', message: customHeadError });
      return;
    }
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const nextForm = { ...form };
      for (const key of trackingKeysToSave) {
        nextForm[key] = normalizeTrackingValue(key, form[key]);
      }
      setForm(nextForm);

      const body: Partial<Record<TrackingFieldKey, string | null> & Pick<TagsForm, 'customHead'>> = {};
      for (const key of trackingKeysToSave) {
        body[key] = nextForm[key] || null;
      }
      if (showCustomHead) {
        body.customHead = nextForm.customHead;
      }

      const res = await fetch('/api/tracking-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
      const json = (await res.json()) as {
        success: true;
        data: {
          gtmId: string | null;
          ga4Id: string | null;
          clarityId: string | null;
          metaPixelId: string | null;
          customHead: string | null;
        };
      };
      const fresh = toTagsForm(json.data);
      setForm(fresh);
      setOriginal(fresh);
      setErrorMessage(null);
      setValidatedTrackingFields({});
      setCustomHeadValidated(false);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2000);
      notifySiteSettingsStatusChanged();
      showAdminToast({ message: '設定を保存しました。' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      showAdminToast({ tone: 'danger', message: `保存できませんでした。${message}` });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className={EDITOR_HELP_CLASS}>読み込み中...</p>;
  }

  return (
    <div className="space-y-5">
      {errorMessage && (
        <AdminCallout tone="danger" className="font-bold">
          {errorMessage}
        </AdminCallout>
      )}

      {showMaintenance && (
      <section
        className={`${EDITOR_SUB_PANEL_CLASS} space-y-3 border ${
          maintenanceMode
            ? 'border-amber-200 bg-amber-50/90 ring-amber-100'
            : 'border-[#e2e7f0] bg-white/85'
        }`}
      >
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            {!hideHeading && (
              <EditorSectionHeader
                title="メンテナンス表示"
                titleAdornment={
                  maintenanceMode ? (
                    <AdminStatusPill tone="warning">ON</AdminStatusPill>
                  ) : undefined
                }
              />
            )}
            {hideHeading && maintenanceMode && (
              <AdminStatusPill tone="warning" className="mb-2">
                現在ON
              </AdminStatusPill>
            )}
            <p className={`${EDITOR_HELP_CLASS} ${hideHeading ? 'text-sm' : 'mt-1'}`}>
              ONにすると<strong className="font-bold text-[#3f4352]">すべての公開LP</strong>が「メンテナンス中」ページに置き換わります。<br />
              管理画面は引き続き使えます。
            </p>
          </div>
          <AdminToggleSwitch
            checked={maintenanceMode === true}
            disabled={maintenanceMode === null || savingMaintenance}
            onChange={toggleMaintenance}
            className="self-start bg-white/75 shadow-[0_8px_20px_rgba(31,34,48,0.06)] sm:self-auto"
          />
        </header>
      </section>
      )}

      {(showTracking || showCustomHead) && (
      <section className={`${EDITOR_SUB_PANEL_CLASS} space-y-5 border border-[#e2e7f0] bg-white/85`}>
        <header>
          {!hideHeading && (
            <EditorSectionHeader title={showTracking ? '計測タグ' : 'カスタムHTML'} />
          )}
          <p className={`${EDITOR_HELP_CLASS} ${hideHeading ? 'text-sm' : 'mt-1'}`}>
            {showTracking
              ? trackingIntro
              : 'HTMLタグを直接貼り付ける上級者向け設定です。必要な時だけ使ってください。'}
          </p>
        </header>

        {showTracking && (
          <>
            {visibleTrackingFields.map((key) => {
              const field = TRACKING_FIELDS[key];
              return (
                <Field
                  key={key}
                  id={`tracking-${key}`}
                  label={field.label}
                  help={field.help}
                  value={form[key]}
                  onChange={(v) => set(key, v)}
                  onBlur={() =>
                    setValidatedTrackingFields((cur) => ({ ...cur, [key]: true }))
                  }
                  placeholder={field.placeholder}
                  error={
                    validatedTrackingFields[key]
                      ? visibleTrackingErrors[key] ?? null
                      : null
                  }
                />
              );
            })}
          </>
        )}

        {showCustomHead && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="custom-head" className={EDITOR_LABEL_CLASS}>
            カスタムHTML（自由追加）
          </label>
          <textarea
            id="custom-head"
            value={form.customHead}
            onChange={(e) => {
              set('customHead', e.target.value);
              setCustomHeadValidated(false);
            }}
            onBlur={() => setCustomHeadValidated(true)}
            placeholder={'<!-- 任意の <script>, <meta>, <link> 等を貼り付け -->'}
            rows={6}
            maxLength={8000}
            aria-invalid={Boolean(customHeadValidated && customHeadError)}
            aria-describedby={
              customHeadValidated && customHeadError
                ? 'custom-head-error'
                : undefined
            }
            className={`${EDITOR_INPUT_CLASS} min-h-36 w-full font-mono`}
          />
          {customHeadValidated && customHeadError && (
            <span id="custom-head-error" className="text-xs font-bold leading-relaxed text-red-600">
              {customHeadError}
            </span>
          )}
          <AdminCallout tone="warning" className="mt-1 py-2 text-[11px]">
            ここに貼り付けるHTMLはそのまま全LPに出力されます。<br />信頼できるコードのみ貼ってください。
          </AdminCallout>
        </div>
        )}

        <AdminActionRow align="end" className="pt-1">
          {savedAt && (
            <AdminStatusPill tone="success">保存しました</AdminStatusPill>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!isDirty || saving || hasVisibleTrackingError || Boolean(customHeadValidated && customHeadError)}
            className={`${EDITOR_PRIMARY_BUTTON_CLASS} min-h-12 px-5 text-base sm:min-h-[2.75rem] sm:text-sm`}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </AdminActionRow>
      </section>
      )}

      {showTracking && !trackingField && (
      <AdminCallout tone="info" title="計測タグの使い分け">
        <ul className="list-disc space-y-1 pl-5 text-xs leading-[1.55]">
          <li>
            <strong>GTMだけ入れる</strong> → 一番ラク。<br />他のタグはGTM内で管理
          </li>
          <li>
            <strong>GA4単体</strong> → GTM使わずにGoogle Analyticsだけ
          </li>
          <li>
            <strong>Clarity</strong> → 訪問者の操作録画・ヒートマップ（無料）
          </li>
          <li>
            <strong>Meta Pixel</strong> → Facebook / Instagram広告のコンバージョン計測
          </li>
        </ul>
      </AdminCallout>
      )}
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  help?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string | null;
}

function Field({ id, label, help, value, onChange, onBlur, placeholder, error }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={EDITOR_LABEL_CLASS}>{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={100}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        className={`${EDITOR_INPUT_CLASS} w-full font-mono`}
      />
      {error && (
        <span id={`${id}-error`} className="text-xs font-bold leading-relaxed text-red-600">
          {error}
        </span>
      )}
      {help && (
        <span id={`${id}-help`} className={EDITOR_HELP_CLASS}>
          {help}
        </span>
      )}
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
