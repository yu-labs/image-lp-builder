/**
 * LpMetaPanel
 *
 * Inline editor for the LP's <head> metadata: page title, description,
 * OGP image (Twitter / Facebook share preview).
 *
 * Saved by patching content.meta and PUTting the whole content back.
 * Optimistic-style: edits debounce on blur and only fire when the
 * value actually changed.
 *
 * Defaults applied at render time (in [slug].astro et al), not here:
 * - title falls back to LP slug
 * - description falls back to empty
 * - OGP image falls back to first section image
 */

import { useEffect, useState } from 'react';
import type { PageContent, PageMeta, Section } from '../../lib/content';
import { uploadOgpImage } from '../../lib/upload';
import { notifyLpContentSaved } from '../../lib/lp-events';
import { showAdminToast } from '../../lib/admin-toast';
import AdminImagePlaceholder from './AdminImagePlaceholder';
import CollapseToggleIcon from './CollapseToggleIcon';
import {
  AdminToggleRow,
  EDITOR_DANGER_BUTTON_CLASS,
  EDITOR_HELP_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
} from './LpEditorPrimitives';

interface Props {
  lpId: string;
  initialMeta: PageMeta;
  sections: Section[];
}

type ApiError = { success: false; error: { code: string; message: string } };

const PANEL_CLASS =
  'overflow-hidden rounded-2xl bg-white shadow-[0_10px_24px_rgba(31,34,48,0.045)]';
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
const LABEL_CLASS = EDITOR_LABEL_CLASS;
const HELP_CLASS = EDITOR_HELP_CLASS;
const INPUT_CLASS = EDITOR_INPUT_CLASS;
const PRIMARY_BUTTON_CLASS = EDITOR_PRIMARY_BUTTON_CLASS;
const DANGER_BUTTON_CLASS = EDITOR_DANGER_BUTTON_CLASS;

export default function LpMetaPanel({ lpId, initialMeta, sections }: Props) {
  const [meta, setMeta] = useState<PageMeta>(initialMeta);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [ogUploading, setOgUploading] = useState(false);

  async function commit(patch: Partial<PageMeta>, fieldKey: string) {
    const next = { ...meta, ...patch };
    // Skip empty values so we don't store "" on every blur
    const cleaned: PageMeta = {};
    if (next.title?.trim()) cleaned.title = next.title.trim();
    if (next.description?.trim()) cleaned.description = next.description.trim();
    if (next.ogImage?.trim()) cleaned.ogImage = next.ogImage.trim();
    // Only persist noindex when it's actively on. Omitted means
    // indexable, which keeps existing LPs' behavior stable after
    // the default for new LPs moved to noindex.
    if (next.noindex === true) cleaned.noindex = true;

    setMeta(cleaned);
    setSavingField(fieldKey);
    try {
      const getRes = await fetch(`/api/lps/${lpId}`);
      if (!getRes.ok) throw new Error(await readApiError(getRes, 'LP取得失敗'));
      const getJson = (await getRes.json()) as {
        success: true;
        data: { content: PageContent };
      };
      const updatedContent: PageContent = {
        ...getJson.data.content,
        meta: cleaned,
      };
      const putRes = await fetch(`/api/lps/${lpId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: updatedContent }),
      });
      if (!putRes.ok) throw new Error(await readApiError(putRes, 'LP更新失敗'));
      notifyLpContentSaved();
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSavingField(null);
    }
  }

  function maybeCommit(field: keyof PageMeta, value: string) {
    if ((meta[field] ?? '') === value) return;
    void commit({ [field]: value }, field);
  }

  const sectionImageOptions = sections
    .filter((s) => s.type === 'image' && s.image?.url)
    .map((s) => s.image);

  const isUsingFirstImage =
    !meta.ogImage && sectionImageOptions[0]?.url;
  const isConfigured = !!(
    meta.title?.trim() ||
    meta.description?.trim() ||
    meta.ogImage?.trim() ||
    meta.noindex === true
  );

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
            メタ情報（SEO・SNSシェア）
            <span
              className={`${STATUS_BADGE_CLASS} ${
                isConfigured ? STATUS_CONFIGURED_CLASS : STATUS_EMPTY_CLASS
              }`}
            >
              {isConfigured ? '設定済み' : '未設定'}
            </span>
          </h2>
          <p className={PANEL_DESC_CLASS}>
            タイトル・説明・OGP画像 — 設定しない場合はデフォルトが入ります
          </p>
        </div>
        <CollapseToggleIcon open={!collapsed} />
      </button>

      {!collapsed && (
        <div className={PANEL_BODY_CLASS}>
          <label className="flex flex-col gap-1">
            <span className={`${LABEL_CLASS} flex items-center gap-2`}>
              ページタイトル
              {savingField === 'title' && (
                <span className="text-xs text-[#8b91a1]">保存中...</span>
              )}
            </span>
            <input
              type="text"
              defaultValue={meta.title ?? ''}
              onBlur={(e) => maybeCommit('title', e.target.value)}
              placeholder="例：猫専門ペットホテル｜夜間見守り付きで安心"
              maxLength={120}
              className={INPUT_CLASS}
            />
            <span className={HELP_CLASS}>
              ブラウザのタブ・Google検索結果に出る。空ならLPのslugが使われます
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className={`${LABEL_CLASS} flex items-center gap-2`}>
              説明文（description）
              {savingField === 'description' && (
                <span className="text-xs text-[#8b91a1]">保存中...</span>
              )}
            </span>
            <textarea
              defaultValue={meta.description ?? ''}
              onBlur={(e) => maybeCommit('description', e.target.value)}
              placeholder="例：猫に慣れたスタッフが、食事・トイレ・体調の変化まで見守ります。旅行や出張前に空き状況をご確認ください。"
              maxLength={300}
              rows={2}
              className={`${INPUT_CLASS} min-h-28 resize-none sm:min-h-22`}
            />
            <span className={HELP_CLASS}>
              SNSシェア時の説明文（80〜120文字目安）
            </span>
          </label>

          <OgImageField
            currentUrl={meta.ogImage}
            isUsingFirstImage={!!isUsingFirstImage}
            saving={savingField === 'ogImage'}
            uploading={ogUploading}
            setUploading={setOgUploading}
            onSet={(url) => commit({ ogImage: url }, 'ogImage')}
            onClear={() => commit({ ogImage: undefined }, 'ogImage')}
          />

          <div className="border-t border-[#e2e7f0] pt-4">
            <AdminToggleRow
              title="検索エンジンに表示する"
              help={
                <>
                  広告専用LPやクローズドな配布先のLPはOFFを推奨。<br />
                  OFFにすると検索結果から徐々に消えます（数日〜数週間）
                </>
              }
              checked={meta.noindex !== true}
              onChange={(checked) => void commit({ noindex: !checked }, 'noindex')}
              className="bg-white/72"
            />
          </div>
        </div>
      )}
    </section>
  );
}

interface OgFieldProps {
  currentUrl: string | undefined;
  isUsingFirstImage: boolean;
  saving: boolean;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  onSet: (url: string) => void;
  onClear: () => void;
}

function OgImageField({
  currentUrl,
  isUsingFirstImage,
  saving,
  uploading,
  setUploading,
  onSet,
  onClear,
}: OgFieldProps) {
  const [dragOver, setDragOver] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewFailed(false);
  }, [currentUrl]);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const { url } = await uploadOgpImage(file);
      onSet(url);
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setUploading(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (uploading) return;
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
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className={`${LABEL_CLASS} flex items-center gap-2`}>
        OGP画像（SNSシェアのサムネ）
        {saving && <span className="text-xs text-[#8b91a1]">保存中...</span>}
        {uploading && (
          <span className="text-xs text-[#567baf]">アップロード中...</span>
        )}
      </span>

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative flex items-start gap-3 rounded-2xl border p-3 transition-colors ${
          dragOver
            ? 'border-[#9bb4d6] bg-[#eef4fb]'
            : currentUrl
              ? 'border-[#e2e7f0] bg-white'
              : 'border-dashed border-[#cbd5e1] bg-[#f8fafc]'
        }`}
      >
        {currentUrl && !previewFailed ? (
          <img
            src={currentUrl}
            alt="OGPプレビュー"
            className="h-20 w-28 shrink-0 rounded-xl bg-[#f3f1f7] object-cover"
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <AdminImagePlaceholder className="h-20 w-28" />
        )}
        <div className="flex-1 min-w-0 space-y-2">
          {currentUrl ? (
            <>
              <code className="block truncate font-mono text-[11px] text-[#8b91a1]">
                {currentUrl}
              </code>
              <div className="flex flex-wrap gap-2">
                <OgUploadButton
                  onSelected={handleFile}
                  label="画像を変更"
                  uploading={uploading}
                />
                <button
                  type="button"
                  onClick={onClear}
                  className={DANGER_BUTTON_CLASS}
                >
                  クリア
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[#687082]">
                {isUsingFirstImage
                  ? '未設定 — 最初のセクション画像が自動で使われます'
                  : '画像をドラッグ&ドロップ または ボタンから選択'}
              </p>
              <OgUploadButton
                onSelected={handleFile}
                label="画像をアップロード"
                uploading={uploading}
              />
            </div>
          )}
        </div>
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-[#567baf]/18">
            <span className="rounded-full bg-[#567baf] px-3 py-1.5 text-sm font-extrabold text-white shadow-lg">
              ドロップでOGP画像に設定
            </span>
          </div>
        )}
      </div>

      <span className={HELP_CLASS}>
        推奨1200×630。SNS互換性のためJPGで保存されます
      </span>
    </div>
  );
}

interface UploadButtonProps {
  onSelected: (file: File) => void;
  label: string;
  uploading: boolean;
}

function OgUploadButton({ onSelected, label, uploading }: UploadButtonProps) {
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onSelected(file);
  }

  return (
    <label
      className={
        uploading
          ? 'inline-flex cursor-not-allowed items-center rounded-full bg-[#f2f4f8] px-4 py-2 text-sm font-extrabold text-[#8b91a1]'
          : PRIMARY_BUTTON_CLASS
      }
    >
      {uploading ? 'アップロード中...' : label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={onChange}
        disabled={uploading}
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
