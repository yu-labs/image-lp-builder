
import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type {
  CtaLink,
  FloatingCta,
  FloatingCtaImage,
  FloatingCtaPosition,
  PageContent,
  Promotions,
  Scarcity,
  StickyPosition,
} from '../../lib/content';
import { uploadImage } from '../../lib/upload';
import { notifyLpContentSaved } from '../../lib/lp-events';
import { showAdminToast } from '../../lib/admin-toast';
import AdminSelect from './AdminSelect';
import CollapseToggleIcon from './CollapseToggleIcon';
import ColorField from './ColorField';
import ImageUploadDropBox from './ImageUploadDropBox';
import {
  AdminToggleSwitch,
  EDITOR_FIELD_ROW_CLASS,
  EDITOR_HELP_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_SUB_PANEL_CLASS,
  EDITOR_TIGHT_STACK_CLASS,
  EditorSliderNumberField,
} from './LpEditorPrimitives';

interface MyLinkOption {
  id: string;
  label: string;
  url: string;
}

type MyLinksResponse =
  | { success: true; data: { myLinks: MyLinkOption[] } }
  | { success: false };

interface Props {
  lpId: string;
  initialPromotions: Promotions;
}

type ApiError = { success: false; error: { code: string; message: string } };
type FloatingLinkMode = CtaLink['type'] | 'my_link';
type ButtonMode = 'text' | 'image';

const SCARCITY_DEFAULTS: Scarcity = {
  enabled: false,
  text: '残り3席',
  position: 'top',
  backgroundColor: '#f59e0b',
  textColor: '#1f2937',
  fontSize: 14,
};

const FLOATING_CTA_DEFAULTS: FloatingCta = {
  enabled: false,
  buttonMode: 'text',
  text: '今すぐ申し込む',
  link: { type: 'custom_url', url: '' },
  backgroundColor: '#0ea5e9',
  textColor: '#ffffff',
  fontSize: 16,
  borderRadius: 9999,
  position: 'bottom',
  showAfterScrollPercent: 0,
  hideNearPageEnd: true,
};

const DEFAULT_FLOATING_IMAGE_WIDTH = 180;
const MIN_FLOATING_IMAGE_WIDTH = 72;
const MAX_FLOATING_IMAGE_WIDTH = 320;

const PANEL_CLASS = 'overflow-visible';
const PANEL_HEADER_CLASS =
  'w-full flex items-center justify-between gap-3 rounded-2xl py-2 text-left transition hover:bg-[#f8fafc]';
const PANEL_TITLE_CLASS = 'text-sm font-extrabold text-[#3f4352]';
const PANEL_DESC_CLASS =
  'mt-1 text-xs font-semibold leading-relaxed text-[#8b91a1]';
const PANEL_BODY_CLASS = 'mt-4 grid gap-4';
const SECTION_CARD_CLASS = `${EDITOR_SUB_PANEL_CLASS} ${EDITOR_TIGHT_STACK_CLASS}`;
const LABEL_CLASS = EDITOR_LABEL_CLASS;
const HELP_CLASS = EDITOR_HELP_CLASS;
const FIELD_CLASS = EDITOR_INPUT_CLASS;

const FLOATING_LINK_MODE_LABELS: Record<FloatingLinkMode, string> = {
  my_link: 'よく使うリンク',
  custom_url: 'カスタムURL',
  line_friend: 'LINE友だち追加',
  tel: '電話番号',
  mailto: 'メールアドレス',
  webhook: 'Webhook（高度）',
};

const SELECTABLE_FLOATING_LINK_MODES: ReadonlyArray<FloatingLinkMode> = [
  'my_link',
  'custom_url',
  'line_friend',
  'tel',
  'mailto',
];

function stripLinkScheme(value: string, scheme: 'tel' | 'mailto'): string {
  return value.trim().replace(new RegExp(`^${scheme}:`, 'i'), '').trim();
}

function displayMyLinkUrl(url: string): string {
  if (/^tel:/i.test(url)) return stripLinkScheme(url, 'tel');
  if (/^mailto:/i.test(url)) return stripLinkScheme(url, 'mailto');
  return url;
}

function clampFloatingImageWidth(value: number | undefined): number {
  const numeric =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : DEFAULT_FLOATING_IMAGE_WIDTH;
  return Math.max(
    MIN_FLOATING_IMAGE_WIDTH,
    Math.min(MAX_FLOATING_IMAGE_WIDTH, Math.round(numeric))
  );
}

export default function PromotionsPanel({
  lpId,
  initialPromotions,
}: Props) {
  const [promotions, setPromotions] = useState<Promotions>(initialPromotions);
  const promotionsRef = useRef<Promotions>(initialPromotions);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveSeqRef = useRef(0);
  const [collapsed, setCollapsed] = useState(true);
  const [, setSaving] = useState(false);
  const [myLinks, setMyLinks] = useState<MyLinkOption[]>([]);

  useEffect(() => {
    let cancelled = false;

    function loadMyLinks() {
      void fetch('/api/my-links')
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          const data = json as MyLinksResponse | null;
          if (cancelled || !data?.success) return;
          setMyLinks(data.data.myLinks);
        })
        .catch(() => {
          // MyLinks are an optional convenience here; silent fail is fine.
        });
    }

    loadMyLinks();
    window.addEventListener('focus', loadMyLinks);
    window.addEventListener('pageshow', loadMyLinks);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', loadMyLinks);
      window.removeEventListener('pageshow', loadMyLinks);
    };
  }, []);

  function persist(next: Promotions, previous: Promotions) {
    const seq = ++saveSeqRef.current;
    setSaving(true);
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(() => writePromotions(next))
      .catch((err) => {
        if (seq === saveSeqRef.current && promotionsRef.current === next) {
          promotionsRef.current = previous;
          setPromotions(previous);
        }
        showAdminToast({
          tone: 'danger',
          message: `保存できませんでした：${err instanceof Error ? err.message : String(err)}`,
        });
      })
      .finally(() => {
        if (seq === saveSeqRef.current) setSaving(false);
      });
  }

  async function writePromotions(next: Promotions) {
    try {
      const getRes = await fetch(`/api/lps/${lpId}`);
      if (!getRes.ok) throw new Error(await readApiError(getRes, 'LP取得失敗'));
      const getJson = (await getRes.json()) as {
        success: true;
        data: { content: PageContent };
      };

      const updatedContent: PageContent = {
        ...getJson.data.content,
        promotions: next,
      };
      const putRes = await fetch(`/api/lps/${lpId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: updatedContent }),
      });
      if (!putRes.ok) throw new Error(await readApiError(putRes, '保存失敗'));
      notifyLpContentSaved();
    } catch (err) {
      throw err;
    }
  }

  function updatePromotions(recipe: (current: Promotions) => Promotions) {
    const previous = promotionsRef.current;
    const next = recipe(previous);
    promotionsRef.current = next;
    setPromotions(next);
    persist(next, previous);
  }

  function updateScarcity(patch: Partial<Scarcity>) {
    updatePromotions((currentPromotions) => {
      const current = currentPromotions.scarcity ?? SCARCITY_DEFAULTS;
      return {
        ...currentPromotions,
        scarcity: { ...current, ...patch },
      };
    });
  }

  function updateFloatingCta(patch: Partial<FloatingCta>) {
    updatePromotions((currentPromotions) => {
      const current = currentPromotions.floatingCta ?? FLOATING_CTA_DEFAULTS;
      return {
        ...currentPromotions,
        floatingCta: { ...current, ...patch },
      };
    });
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
          <h2 className={PANEL_TITLE_CLASS}>固定パーツ</h2>
          <p className={PANEL_DESC_CLASS}>
            固定バー・ボタンのパーツを追加します。
          </p>
        </div>
        <CollapseToggleIcon open={!collapsed} />
      </button>

      {!collapsed && (
        <div className={PANEL_BODY_CLASS}>
          <ScarcityEditor
            value={promotions.scarcity ?? SCARCITY_DEFAULTS}
            onChange={updateScarcity}
          />
          <FloatingCtaEditor
            value={promotions.floatingCta ?? FLOATING_CTA_DEFAULTS}
            myLinks={myLinks}
            onChange={updateFloatingCta}
          />
        </div>
      )}
    </section>
  );
}

interface FloatingCtaEditorProps {
  value: FloatingCta;
  myLinks: MyLinkOption[];
  onChange: (patch: Partial<FloatingCta>) => void;
}

function getFloatingLinkMode(link: CtaLink): FloatingLinkMode {
  if ('myLinkId' in link && link.myLinkId) return 'my_link';
  return link.type;
}

function migrateFloatingLink(
  oldLink: CtaLink,
  mode: Exclude<FloatingLinkMode, 'my_link'>
): CtaLink {
  const oldUrl = 'url' in oldLink ? oldLink.url : '';
  const oldNumber = oldLink.type === 'tel' ? oldLink.number : '';
  const oldEmail = oldLink.type === 'mailto' ? oldLink.email : '';
  const oldTag = oldLink.type === 'webhook' ? oldLink.tag : '';
  const oldApiKey = oldLink.type === 'webhook' ? oldLink.apiKey : undefined;

  switch (mode) {
    case 'custom_url':
    case 'line_friend':
      return { type: mode, url: oldUrl };
    case 'tel':
      return { type: 'tel', number: oldNumber };
    case 'mailto':
      return { type: 'mailto', email: oldEmail };
    case 'webhook':
      return { type: 'webhook', url: oldUrl, tag: oldTag, apiKey: oldApiKey };
  }
}

function FloatingCtaEditor({
  value,
  myLinks,
  onChange,
}: FloatingCtaEditorProps) {
  const initialLinkMode = getFloatingLinkMode(value.link);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const textButtonLabel = value.textButtonText ?? value.text;
  const imageAltLabel = (value.imageAltText ?? value.text).replaceAll('｜', '');
  const [linkMode, setLinkMode] = useState<FloatingLinkMode>(initialLinkMode);
  const [buttonMode, setButtonMode] = useState<ButtonMode>(
    value.buttonMode ?? (value.image ? 'image' : 'text')
  );

  useEffect(() => {
    setButtonMode(value.buttonMode ?? (value.image ? 'image' : 'text'));
  }, [value.buttonMode, value.image]);

  function setLinkModeAndMaybeReset(mode: FloatingLinkMode) {
    setLinkMode(mode);
    if (mode === 'my_link') return;
    onChange({ link: migrateFloatingLink(value.link, mode) });
  }

  function setLink(link: CtaLink) {
    onChange({ link });
  }

  function changeButtonMode(mode: ButtonMode) {
    setButtonMode(mode);
    if (mode === 'image') {
      onChange({
        buttonMode: mode,
        textButtonText: textButtonLabel,
        imageAltText: imageAltLabel,
        imageWidth: value.imageWidth ?? DEFAULT_FLOATING_IMAGE_WIDTH,
      });
      return;
    }
    onChange({
      buttonMode: mode,
      text: textButtonLabel,
    });
  }

  function insertLineBreakMarker() {
    const input = textInputRef.current;
    const start = input?.selectionStart ?? textButtonLabel.length;
    const end = input?.selectionEnd ?? start;
    const next = `${textButtonLabel.slice(0, start)}｜${textButtonLabel.slice(end)}`;
    onChange({ text: next, textButtonText: next });
    window.setTimeout(() => {
      textInputRef.current?.focus();
      textInputRef.current?.setSelectionRange(start + 1, start + 1);
    }, 0);
  }

  const linkModes =
    value.link.type === 'webhook'
      ? ([...SELECTABLE_FLOATING_LINK_MODES, 'webhook'] as const)
      : SELECTABLE_FLOATING_LINK_MODES;
  const isBottomRight = value.position === 'bottom-right';
  const previewBorderRadius = value.borderRadius ?? 9999;
  const imageDisplayWidth = clampFloatingImageWidth(value.imageWidth);

  return (
    <div className={SECTION_CARD_CLASS}>
      <PromotionsItemHeader
        title="固定ボタン"
        description="画面上部・下部・右下に固定表示する、申込み・LINE・予約などのボタンで使えます。"
        checked={value.enabled}
        onChange={(enabled) =>
          onChange({
            enabled,
            ...(enabled && value.showAfterScrollPercent === 30
              ? { showAfterScrollPercent: 0 }
              : {}),
          })
        }
      />

      <div className="space-y-3">
        <div className="space-y-4 rounded-2xl bg-[#f8fafc]/82 px-3 py-4 ring-1 ring-[#e2e7f0] sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={LABEL_CLASS}>ボタンタイプ</span>
          </div>
          <ButtonModeTabs
            mode={buttonMode}
            onChange={changeButtonMode}
          />

          {buttonMode === 'image' ? (
            <div className="w-full space-y-3">
              {value.image && (
                <div className="flex flex-col gap-1">
                  <span className={LABEL_CLASS}>プレビュー</span>
                  <div className="flex items-center justify-start rounded-2xl bg-[#f8fafc] p-3">
                    <img
                      src={value.image.url}
                      alt={imageAltLabel || '固定ボタン'}
                      className="h-auto max-w-full object-contain"
                      style={{ width: `${imageDisplayWidth}px` }}
                    />
                  </div>
                </div>
              )}
              {value.image && (
                <EditorSliderNumberField
                  label="表示サイズ"
                  value={imageDisplayWidth}
                  min={MIN_FLOATING_IMAGE_WIDTH}
                  max={MAX_FLOATING_IMAGE_WIDTH}
                  step={4}
                  unit="px"
                  onChange={(imageWidth) => onChange({ imageWidth })}
                />
              )}
              <FloatingCtaImagePicker
                image={value.image}
                onImageChange={(image) => {
                  if (image) {
                    setButtonMode('image');
                    onChange({
                      image,
                      buttonMode: 'image',
                      imageWidth: value.imageWidth ?? DEFAULT_FLOATING_IMAGE_WIDTH,
                    });
                  } else {
                    onChange({ image });
                  }
                }}
              />
            </div>
          ) : (
            <div className="w-full space-y-3">
              {textButtonLabel && (
                <div className="flex flex-col gap-1">
                  <span className={LABEL_CLASS}>プレビュー</span>
                  <div className="flex items-center justify-start overflow-x-auto rounded-2xl bg-[#f8fafc] p-3">
                    <span
                      className={
                        isBottomRight
                          ? 'inline-flex max-w-full flex-col items-center justify-center break-words px-[0.9rem] py-[0.85rem] text-center text-sm font-bold leading-[1.2] shadow-md'
                          : 'inline-flex max-w-full flex-col items-center justify-center break-words px-6 py-[0.85rem] text-center text-sm font-bold leading-[1.2] shadow-md'
                      }
                      style={{
                        background: value.backgroundColor ?? '#0ea5e9',
                        color: value.textColor ?? '#ffffff',
                        fontSize: `${value.fontSize ?? 16}px`,
                        borderRadius: `${previewBorderRadius}px`,
                        overflowWrap: 'anywhere',
                        lineBreak: 'strict',
                      }}
                    >
                      {textButtonLabel.split('｜').map((line, index) =>
                        isBottomRight ? (
                          <span key={`${line}-${index}`}>{line}</span>
                        ) : (
                          <span key={`${line}-${index}`} className="block">
                            {line}
                          </span>
                        )
                      )}
                    </span>
                  </div>
                </div>
              )}
              <div className={EDITOR_FIELD_ROW_CLASS}>
                <label className="flex w-full min-w-0 flex-col gap-1 sm:w-[16rem] lg:w-[15rem]">
                  <span className={LABEL_CLASS}>ボタン文言</span>
                  <div className="flex min-w-0 gap-2">
                    <input
                      ref={textInputRef}
                      type="text"
                      value={textButtonLabel}
                      onChange={(e) =>
                        onChange({
                          text: e.target.value,
                          textButtonText: e.target.value,
                        })
                      }
                      placeholder="今すぐ申し込む"
                      maxLength={60}
                      className={`${FIELD_CLASS} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      onClick={insertLineBreakMarker}
                      className="shrink-0 rounded-xl bg-[#eef4fb] px-3 text-xs font-extrabold text-[#567baf] transition hover:bg-[#dfeaf7]"
                    >
                      改行
                    </button>
                  </div>
                  <span className={HELP_CLASS}>
                    改行したい位置にカーソルを置いて押します。
                  </span>
                </label>

                <div className="grid w-full min-w-0 gap-3 sm:w-auto sm:grid-cols-[max-content_max-content] sm:justify-start lg:gap-x-5">
                  <label className="flex min-w-0 flex-col gap-1 sm:w-max">
                    <span className={LABEL_CLASS}>背景色</span>
                    <ColorField
                      value={value.backgroundColor ?? '#0ea5e9'}
                      onChange={(backgroundColor) => onChange({ backgroundColor })}
                      label="背景色"
                      textInputClassName="w-28"
                    />
                  </label>

                  <label className="flex min-w-0 flex-col gap-1 sm:w-max">
                    <span className={LABEL_CLASS}>文字色</span>
                    <ColorField
                      value={value.textColor ?? '#ffffff'}
                      onChange={(textColor) => onChange({ textColor })}
                      label="文字色"
                      textInputClassName="w-28"
                    />
                  </label>
                </div>

                <EditorSliderNumberField
                  label="文字サイズ"
                  value={value.fontSize ?? 16}
                  min={10}
                  max={72}
                  unit="px"
                  onChange={(fontSize) => onChange({ fontSize })}
                />

                <EditorSliderNumberField
                  label="角丸"
                  value={value.borderRadius ?? 9999}
                  min={0}
                  max={120}
                  unit="px"
                  onChange={(borderRadius) => onChange({ borderRadius })}
                />
              </div>
            </div>
          )}

          {buttonMode === 'image' && (
            <label className="flex w-full max-w-md flex-col gap-1">
              <span className={LABEL_CLASS}>代替テキスト</span>
              <input
                type="text"
                value={imageAltLabel}
                onChange={(e) =>
                  onChange({
                    imageAltText: e.target.value.replaceAll('｜', ''),
                  })
                }
                placeholder="今すぐ申し込む"
                maxLength={60}
                className={FIELD_CLASS}
              />
              <span className={HELP_CLASS}>
                画像が表示されなかった時や、読み上げで使われるテキストです。
              </span>
            </label>
          )}
        </div>

        <div className="space-y-4 rounded-2xl bg-white/72 px-3 py-4 ring-1 ring-[#e2e7f0] sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={LABEL_CLASS}>リンク設定</span>
            <span className="rounded-full bg-[#eef4fb] px-2 py-0.5 text-[10px] font-extrabold text-[#567baf]">
              共通
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-[12rem_minmax(16rem,28rem)] lg:gap-x-5">
            <label className="flex min-w-0 flex-col gap-1">
              <span className={LABEL_CLASS}>リンク種別</span>
              <AdminSelect
                value={linkMode}
                onChange={(e) =>
                  setLinkModeAndMaybeReset(e.target.value as FloatingLinkMode)
                }
              >
                {linkModes.map((k) => (
                  <option key={k} value={k}>
                    {FLOATING_LINK_MODE_LABELS[k]}
                  </option>
                ))}
              </AdminSelect>
            </label>

            <LinkTargetField
              link={value.link}
              linkMode={linkMode}
              myLinks={myLinks}
              onSetLink={setLink}
            />
          </div>
        </div>

        <div className="space-y-4 rounded-2xl bg-white/72 px-3 py-4 ring-1 ring-[#e2e7f0] sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={LABEL_CLASS}>表示設定</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-[12rem_minmax(16rem,28rem)] lg:gap-x-5">
            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>表示位置</span>
              <AdminSelect
                value={value.position}
                onChange={(e) =>
                  onChange({ position: e.target.value as FloatingCtaPosition })
                }
              >
                <option value="bottom">下部</option>
                <option value="top">上部</option>
                <option value="bottom-right">右下</option>
              </AdminSelect>
            </label>

            <label className="flex min-w-0 flex-col gap-1">
              <span className={LABEL_CLASS}>
                出現タイミング：スクロール {value.showAfterScrollPercent ?? 0}% 経過後
              </span>
              <div className="flex min-h-[2.75rem] items-center">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={value.showAfterScrollPercent ?? 0}
                  onChange={(e) =>
                    onChange({ showAfterScrollPercent: Number(e.target.value) })
                  }
                  className="h-3 w-full cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#567baf] [&::-moz-range-thumb]:shadow-[0_8px_18px_rgba(86,123,175,0.25)] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#567baf] [&::-webkit-slider-thumb]:shadow-[0_8px_18px_rgba(86,123,175,0.25)]"
                  style={{
                    background: `linear-gradient(to right, #567baf 0%, #567baf ${value.showAfterScrollPercent ?? 0}%, #d8e3f2 ${value.showAfterScrollPercent ?? 0}%, #d8e3f2 100%)`,
                  }}
                />
              </div>
            </label>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-start sm:gap-4">
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-[#3f4352]">ページ下部で非表示</div>
              <p className={HELP_CLASS}>最後の申込みボタンに重なりにくくします。</p>
            </div>
            <AdminToggleSwitch
              checked={value.hideNearPageEnd !== false}
              onChange={(checked) => onChange({ hideNearPageEnd: checked })}
            />
          </div>
        </div>

      </div>

    </div>
  );
}

interface FloatingCtaImagePickerProps {
  image: FloatingCtaImage | undefined;
  onImageChange: (image: FloatingCtaImage | undefined) => void;
}

function ButtonModeTabs({
  mode,
  onChange,
}: {
  mode: ButtonMode;
  onChange: (mode: ButtonMode) => void;
}) {
  const tabs: Array<{ value: ButtonMode; label: string }> = [
    { value: 'text', label: '通常ボタン' },
    { value: 'image', label: '画像ボタン' },
  ];

  return (
    <div>
      <div className="inline-flex rounded-full bg-[#eef2f7] p-1">
        {tabs.map((tab) => {
          const active = mode === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange(tab.value)}
              className={`min-h-10 rounded-full px-4 text-sm font-extrabold transition ${
                active
                  ? 'bg-white text-[#567baf] shadow-[0_8px_18px_rgba(31,34,48,0.09)]'
                  : 'text-[#8b91a1] hover:text-[#596173]'
              }`}
              aria-pressed={active}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FloatingCtaImagePicker({
  image,
  onImageChange,
}: FloatingCtaImagePickerProps) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadImage(file);
      onImageChange({
        url: uploaded.url,
        width: uploaded.width,
        height: uploaded.height,
      });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `画像をアップロードできませんでした：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setUploading(false);
    }
  }

  function pickFiles(files: File[]) {
    if (uploading) return;
    const file = files[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="w-full max-w-md space-y-2">
      <ImageUploadDropBox
        accept="image/png,image/jpeg,image/webp"
        busy={uploading}
        buttonLabel={image ? '画像を変更' : '画像を選択'}
        compact
        description="PNG / JPG / WebP"
        onFiles={pickFiles}
        title="画像をドラッグ&ドロップ"
      />
    </div>
  );
}

interface LinkTargetFieldProps {
  link: CtaLink;
  linkMode: FloatingLinkMode;
  myLinks: MyLinkOption[];
  onSetLink: (link: CtaLink) => void;
}

function LinkTargetField({
  link,
  linkMode,
  myLinks,
  onSetLink,
}: LinkTargetFieldProps) {
  const myLinkId = 'myLinkId' in link ? link.myLinkId : undefined;
  const selectedMyLink = myLinkId
    ? myLinks.find((m) => m.id === myLinkId)
    : undefined;
  const hasDeletedMyLink = Boolean(myLinkId && !selectedMyLink);
  const currentUrl = 'url' in link ? link.url : '';

  function pickMyLink(id: string) {
    const selected = id ? myLinks.find((m) => m.id === id) : undefined;
    if (!selected) return;
    onSetLink({
      type: 'custom_url',
      myLinkId: selected.id,
      url: selected.url,
    });
  }

  if (linkMode === 'my_link') {
    return (
      <div className="space-y-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>よく使うリンク</span>
          <AdminSelect
            value={selectedMyLink?.id ?? ''}
            onChange={(e) => pickMyLink(e.target.value)}
            disabled={myLinks.length === 0}
          >
            <option value="">
              {myLinks.length === 0
                ? '登録済みリンクがありません'
                : 'リンクを選択してください'}
            </option>
            {myLinks.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </AdminSelect>
          {myLinks.length === 0 && (
            <span className={HELP_CLASS}>
              先に
              <a
                href="/admin/my-links"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-extrabold text-[#567baf] underline underline-offset-2"
              >
                よく使うリンク
                <ExternalLink size={12} strokeWidth={2.4} aria-hidden="true" />
              </a>
              でLINE・予約フォーム・電話・メールなどのリンク先を登録してください。
            </span>
          )}
          {hasDeletedMyLink && (
            <span className="mt-1 text-xs font-bold text-amber-700">
              選ばれていたリンクは削除済みです。リンク種別を外部URLに切り替えると、このリンク先を編集できます。
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>選択中のリンク</span>
          <input
            type="text"
            value={
              selectedMyLink
                ? displayMyLinkUrl(selectedMyLink.url)
                : hasDeletedMyLink
                  ? displayMyLinkUrl(currentUrl)
                  : ''
            }
            readOnly
            disabled
            placeholder="リンクを選ぶとリンク先が表示されます"
            className={`${FIELD_CLASS} font-mono`}
          />
          <span className={HELP_CLASS}>
            リンク先を変える場合は
            <a
              href="/admin/my-links"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-extrabold text-[#567baf] underline underline-offset-2"
            >
              よく使うリンク
              <ExternalLink size={12} strokeWidth={2.4} aria-hidden="true" />
            </a>
            を別タブで開いて編集します。
          </span>
        </label>
      </div>
    );
  }

  if (linkMode === 'tel') {
    const number = link.type === 'tel' ? link.number : '';
    return (
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>電話番号</span>
        <input
          type="text"
          value={number}
          onChange={(e) => onSetLink({ type: 'tel', number: e.target.value })}
          placeholder="090-1234-5678"
          className={FIELD_CLASS}
        />
      </label>
    );
  }

  if (linkMode === 'mailto') {
    const email = link.type === 'mailto' ? link.email : '';
    return (
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>メールアドレス</span>
        <input
          type="email"
          value={email}
          onChange={(e) => onSetLink({ type: 'mailto', email: e.target.value })}
          placeholder="contact@example.com"
          className={FIELD_CLASS}
        />
      </label>
    );
  }

  function changeUrl(url: string) {
    if (linkMode === 'custom_url' || linkMode === 'line_friend') {
      onSetLink({ type: linkMode, url });
      return;
    }
    if (linkMode === 'webhook') {
      onSetLink({
        type: 'webhook',
        url,
        tag: link.type === 'webhook' ? link.tag : '',
        apiKey: link.type === 'webhook' ? link.apiKey : undefined,
      });
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>URL</span>
        <input
          type="url"
          value={currentUrl}
          onChange={(e) => changeUrl(e.target.value)}
          placeholder={
            linkMode === 'line_friend'
              ? 'https://lin.ee/xxxxxxx'
              : 'https://example.com/contact'
          }
          className={`${FIELD_CLASS} font-mono`}
        />
      </label>
      {linkMode === 'webhook' && (
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>タグ</span>
          <input
            type="text"
            value={link.type === 'webhook' ? link.tag : ''}
            onChange={(e) =>
              onSetLink({
                type: 'webhook',
                url: currentUrl,
                tag: e.target.value,
                apiKey: link.type === 'webhook' ? link.apiKey : undefined,
              })
            }
            placeholder="floating_signup"
            className={FIELD_CLASS}
          />
          <span className="text-[11px] font-bold text-amber-700">
            ⚠ Webhookボタンは公開LPで押しても何も起きません（inert）
          </span>
        </label>
      )}
    </div>
  );
}

interface ScarcityEditorProps {
  value: Scarcity;
  onChange: (patch: Partial<Scarcity>) => void;
}

function ScarcityEditor({ value, onChange }: ScarcityEditorProps) {
  return (
    <div className={SECTION_CARD_CLASS}>
      <PromotionsItemHeader
        title="固定バー"
        description="注意事項や「残り3席」など、行動を促したい短い案内に使えます。"
        checked={value.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />

      <div className="space-y-3">
        {value.text && (
          <div className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>プレビュー</span>
            <div
              className="px-3 py-2 text-center text-sm font-bold"
              style={{
                background: value.backgroundColor ?? '#f59e0b',
                color: value.textColor ?? '#1f2937',
                fontSize: `${value.fontSize ?? 14}px`,
              }}
            >
              {value.text}
            </div>
          </div>
        )}

        <div className="grid w-full max-w-[min(100%,34rem)] grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
          <label className="flex min-w-0 flex-col gap-1">
            <span className={LABEL_CLASS}>表示テキスト</span>
            <input
              type="text"
              value={value.text}
              onChange={(e) => onChange({ text: e.target.value })}
              placeholder="残り3席"
              maxLength={100}
              className={FIELD_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>位置</span>
            <AdminSelect
              value={value.position}
              onChange={(e) =>
                onChange({ position: e.target.value as StickyPosition })
              }
              className="px-2 pr-8"
            >
              <option value="top">上部</option>
              <option value="bottom">下部</option>
            </AdminSelect>
          </label>
        </div>

        <div className={EDITOR_FIELD_ROW_CLASS}>
          <label className="flex w-max min-w-0 flex-col gap-1">
            <span className={LABEL_CLASS}>背景色</span>
            <ColorField
              value={value.backgroundColor ?? '#f59e0b'}
              onChange={(backgroundColor) => onChange({ backgroundColor })}
              label="背景色"
              textInputClassName="w-24"
            />
          </label>

          <label className="flex w-max min-w-0 flex-col gap-1">
            <span className={LABEL_CLASS}>文字色</span>
            <ColorField
              value={value.textColor ?? '#1f2937'}
              onChange={(textColor) => onChange({ textColor })}
              label="文字色"
              textInputClassName="w-24"
            />
          </label>

          <EditorSliderNumberField
            label="文字サイズ"
            value={value.fontSize ?? 14}
            min={10}
            max={72}
            unit="px"
            onChange={(fontSize) => onChange({ fontSize })}
          />
        </div>
      </div>

    </div>
  );
}

function PromotionsItemHeader({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <header className="space-y-1">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-sm font-extrabold text-[#3f4352]">{title}</h3>
        <ToggleSwitch checked={checked} onChange={onChange} />
      </div>
      <p className="text-xs font-semibold leading-relaxed text-[#8b91a1]">
        {description}
      </p>
    </header>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <AdminToggleSwitch checked={checked} onChange={onChange} />
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
