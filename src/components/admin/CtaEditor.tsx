/**
 * CtaEditor
 *
 * Modal that overlays a section's image with each CTA as a draggable
 * and resizable rectangle (react-rnd). Position is persisted against
 * the section box. Width and height are persisted against the section
 * width, matching LPRenderer so button proportions stay stable across
 * different image ratios.
 *
 * Snapping:
 * - Targets: container center (X / Y), other CTAs' edges and centers
 * - Threshold: SNAP_THRESHOLD pixels
 * - Live guide lines (blue dashed) appear during drag when a snap
 *   target is within range; positions snap on drop.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Copy, X } from 'lucide-react';
import { Rnd } from 'react-rnd';
import type {
  Cta,
  CtaImage,
  CtaLink,
  CtaAnimation,
  CtaIconLeft,
  CtaIconPosition,
  CtaTemplate,
  Section,
} from '../../lib/content';
import { CTA_ANIMATIONS } from '../../lib/content';
import {
  CTA_TEMPLATE_OPTIONS,
  CTA_ICON_LEFT_OPTIONS,
  CTA_DECORATION_OVERRIDE_KEYS,
  CTA_ICON_SVGS,
  getEffectiveDecoration,
  getTemplateBaseline,
  resolveCtaTemplate,
} from '../../lib/cta-template';
import { showAdminToast } from '../../lib/admin-toast';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { setButtonClipboard } from '../../lib/clipboard';
import { uploadImage } from '../../lib/upload';
import AddCtaMenu, {
  CTA_PRESETS,
  PresetChip,
  type AddCtaMenuHandle,
} from './CtaPresets';
import {
  collectCtaSaveErrors,
  getCtaButtonMode,
  getCtaTextPresetSelection,
  initialCtaPosition,
  migrateCtaLink,
  serializeCtas,
  type CtaButtonMode,
  type CtaTextPresetSelection,
  type MyLink,
  type SaveErrorGroup,
} from './cta-editor-helpers';
import { CTA_MODAL_INPUT_CLASS } from './cta-editor-styles';
import CtaLinkForm from './CtaLinkForm';
import CollapseToggleIcon from './CollapseToggleIcon';
import { randomUUID } from '../../lib/uuid';
import AdminSelect from './AdminSelect';
import ColorField from './ColorField';
import ImageUploadDropBox from './ImageUploadDropBox';
import {
  AdminToggleSwitch,
  AdminSegmentedControl,
  EDITOR_DANGER_BUTTON_CLASS,
  EDITOR_HELP_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_SECONDARY_BUTTON_CLASS,
  EDITOR_SUB_PANEL_CLASS,
  EDITOR_TIGHT_STACK_CLASS,
  EditorField,
} from './LpEditorPrimitives';
type MyLinksResponse =
  | { success: true; data: { myLinks: MyLink[] } }
  | { success: false };

const CTA_BUTTON_MODE_OPTIONS: Array<{ value: CtaButtonMode; label: string }> = [
  { value: 'text', label: '通常ボタン' },
  { value: 'image', label: '画像ボタン' },
];

const CTA_ICON_POSITION_OPTIONS: Array<{
  value: CtaIconPosition;
  label: string;
}> = [
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
];

const ANIMATION_LABELS: Record<CtaAnimation, string> = {
  none: 'なし',
  pulse: '拡大して戻る',
  shake: 'シェイク（左右に揺れ）',
  bounce: 'バウンス（上下にはねる）',
  glow: 'グロー（ふわっと光る）',
  fade: '光が流れる',
};

interface Props {
  section: Section;
  busy: boolean;
  onClose: () => void;
  onSave: (ctas: Cta[]) => Promise<void>;
}

interface Guides {
  verticalAt?: number; // x in px (vertical guide line)
  horizontalAt?: number; // y in px (horizontal guide line)
}

const SNAP_THRESHOLD = 8;
const MAX_CTAS = 2;
const TEXT_CTA_MIN_HEIGHT_PX = 48;
const TEXT_CTA_VERTICAL_PADDING_PX = 14;
const CTA_METADATA_KIND_PLACEHOLDER =
  '未指定ならリンク種別から自動分類（line / url / webhook / tel / mailto）';

export default function CtaEditor({ section, busy, onClose, onSave }: Props) {
  const [ctas, setCtas] = useState<Cta[]>(section.ctas);
  const [saving, setSaving] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<Guides>({});
  const [selectedId, setSelectedId] = useState<string | null>(
    section.ctas[0]?.id ?? null,
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [myLinks, setMyLinks] = useState<MyLink[]>([]);
  const [saveErrors, setSaveErrors] = useState<SaveErrorGroup[]>([]);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Empty-state's center "+追加" button delegates to the header's
  // menu so the popover always anchors near the top of the modal
  // and never gets clipped by the modal's bottom edge.
  const headerAddMenuRef = useRef<AddCtaMenuHandle>(null);
  const initialCtasJsonRef = useRef(serializeCtas(section.ctas));
  const hasUnsavedChanges = serializeCtas(ctas) !== initialCtasJsonRef.current;

  const requestClose = useCallback(async () => {
    if (saving) return;
    if (hasUnsavedChanges) {
      const continueEditing = await confirmAdminAction({
        title: '未保存の変更があります',
        message: '保存せずに閉じると、ボタンの追加・削除・編集は反映されません。',
        confirmLabel: '編集を続ける',
        cancelLabel: '保存せず閉じる',
        tone: 'warning',
      });
      if (continueEditing) return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose, saving]);

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
          // Silent fail — MyLinks UI is just an extra convenience here
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

  const selected = ctas.find((c) => c.id === selectedId) ?? null;

  // Auto-open the property panel when a CTA gets selected (or freshly
  // added). Leaves panelOpen alone when nothing changes, so the user
  // can still manually close it and have it stay closed.
  useEffect(() => {
    if (selectedId !== null) setPanelOpen(true);
  }, [selectedId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) {
        void requestClose();
      }
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [requestClose, saving]);

  function updateCta(id: string, patch: Partial<Cta>) {
    setSaveFailure(null);
    setCtas((cur) => {
      const next = cur.map((c) => (c.id === id ? { ...c, ...patch } : c));
      setSaveErrors((current) =>
        current.length > 0 ? collectCtaSaveErrors(next) : current,
      );
      return next;
    });
  }

  function addCtaFromTemplate(template: Omit<Cta, 'id'>) {
    if (ctas.length >= MAX_CTAS) return;
    const newCta: Cta = {
      id: randomUUID(),
      ...template,
      position: initialCtaPosition(template, ctas.length),
    };
    setCtas((cur) => [...cur, newCta]);
    setSelectedId(newCta.id);
    setSaveErrors([]);
    setSaveFailure(null);
  }

  function removeCta(id: string) {
    setSaveFailure(null);
    setCtas((cur) => {
      const next = cur.filter((c) => c.id !== id);
      // shift selection to the previous CTA if the deleted one was selected
      if (selectedId === id) {
        const idx = cur.findIndex((c) => c.id === id);
        const fallback = next[idx - 1] ?? next[0] ?? null;
        setSelectedId(fallback?.id ?? null);
      }
      setSaveErrors((errors) => errors.filter((group) => group.ctaId !== id));
      return next;
    });
  }

  async function confirmRemoveCta(id: string) {
    const cta = ctas.find((item) => item.id === id);
    const confirmed = await confirmAdminAction({
      title: '変更を保存すると削除が確定します',
      message: cta?.text ? `対象: ${cta.text}` : undefined,
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (!confirmed) return;
    removeCta(id);
    showAdminToast({
      tone: 'danger',
      message: 'ボタンを削除しました。変更を保存しないと反映されません。',
    });
  }

  function focusLinkSettings(ctaId: string) {
    setSelectedId(ctaId);
    setPanelOpen(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const section = document.querySelector<HTMLElement>(
          '[data-cta-link-settings="true"]',
        );
        section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const focusTarget = section?.querySelector<HTMLElement>(
          'input:not([type="hidden"]), select, textarea, button',
        );
        focusTarget?.focus({ preventScroll: true });
      });
    });
  }

  async function handleSave() {
    // Frontend pre-check so the operator gets a Japanese, plain-language
    // error before the API rejects the whole content. Same shape of
    // rules as src/lib/content.ts's validateCtaLink, just user-facing copy.
    const errors = collectCtaSaveErrors(ctas);
    if (errors.length > 0) {
      setSaveErrors(errors);
      setSaveFailure(null);
      focusLinkSettings(errors[0].ctaId);
      return;
    }
    setSaveErrors([]);
    setSaveFailure(null);

    setSaving(true);
    try {
      await onSave(ctas);
      onClose();
      showAdminToast({ message: 'ボタン設定を保存しました。' });
    } catch (err) {
      setSaveFailure(
        `保存できませんでした。${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="admin-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[#1f2230]/72 p-0 pb-10 backdrop-blur-sm sm:p-4"
      onClick={() => {
        void requestClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="ボタン配置"
    >
      <div
        className="admin-modal-panel flex h-full w-full max-w-[1400px] flex-col overflow-hidden bg-white shadow-[0_28px_80px_rgba(31,34,48,0.28)] sm:h-[95vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="relative border-b border-[#e2e7f0] px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
          <button
            type="button"
            onClick={() => {
              void requestClose();
            }}
            disabled={saving}
            aria-label="閉じる"
            className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full text-[#8b91a1] transition hover:bg-[#eef4fb] hover:text-[#567baf] disabled:opacity-50"
          >
            <X size={20} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <div className="hidden min-w-0 pr-10 sm:block sm:pr-0">
            <h2 className="text-base font-extrabold text-[#3f4352]">
              ボタン配置
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold leading-relaxed text-[#8b91a1]">
                ドラッグで移動、角を引っ張ってリサイズ・中央や他のボタンに自動吸着
              </p>
              {hasUnsavedChanges && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-700">
                  未保存
                </span>
              )}
            </div>
          </div>
          <div className="mr-12 flex shrink-0 flex-wrap items-center gap-2 sm:mr-12 sm:mt-0">
            {hasUnsavedChanges && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-700 sm:hidden">
                未保存
              </span>
            )}
            <AddCtaMenu
              ref={headerAddMenuRef}
              disabled={saving || ctas.length >= MAX_CTAS}
              disabledReason={
                ctas.length >= MAX_CTAS
                  ? `1セクションあたり最大${MAX_CTAS}個までです`
                  : undefined
              }
              onPick={addCtaFromTemplate}
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || busy}
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full bg-[#2f9a5f] px-5 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(47,154,95,0.16)] transition hover:bg-[#277f4f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中...' : '変更を保存'}
            </button>
          </div>
        </header>

        {(saveErrors.length > 0 || saveFailure) && (
          <div className="border-b border-[#f0c6c6] bg-[#fff6f6] px-5 py-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff] text-[#c73737] shadow-sm ring-1 ring-[#f0c6c6]">
                <AlertTriangle size={17} strokeWidth={2.5} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-[#a51414]">
                  {saveErrors.length > 0
                    ? '保存できません。未設定のボタンがあります。'
                    : '保存できませんでした。'}
                </p>
                {saveFailure && (
                  <p className="mt-1 text-xs font-semibold leading-relaxed text-[#b83232]">
                    {saveFailure}
                  </p>
                )}
                {saveErrors.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {saveErrors.map((group) => (
                      <button
                        key={group.ctaId}
                        type="button"
                        onClick={() => {
                          focusLinkSettings(group.ctaId);
                        }}
                        className="group inline-flex max-w-full items-center justify-between gap-3 rounded-xl border border-[#f0c6c6] bg-white px-3 py-2 text-left shadow-sm transition hover:border-[#df8f8f] hover:bg-[#fffafa] active:scale-[0.99]"
                      >
                        <span className="min-w-0">
                          <span className="block text-xs font-extrabold text-[#8f1d1d]">
                            {group.title}を確認
                          </span>
                          <span className="mt-1 block text-xs font-semibold leading-relaxed text-[#b83232]">
                            {group.messages.join('。')}
                          </span>
                        </span>
                        <ArrowRight
                          size={16}
                          strokeWidth={2.5}
                          className="shrink-0 text-[#b83232] transition group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Left column: section image with draggable CTAs. Wider on
              desktop now that the property form lives next to it. */}
          <div
            className={`min-h-0 flex-1 overflow-auto bg-[#eef2f7] p-4 lg:max-h-none ${panelOpen ? 'max-h-[32vh] shrink-0' : ''}`}
          >
            <div
              ref={containerRef}
              className="relative mx-auto bg-white shadow-[0_18px_48px_rgba(31,34,48,0.12)] ring-1 ring-[#e2e7f0]"
              style={{
                aspectRatio: `${section.image.width} / ${section.image.height}`,
                maxWidth: '600px',
                width: '100%',
              }}
            >
              <img
                src={section.image.url}
                alt={section.image.alt ?? ''}
                className="absolute inset-0 w-full h-full object-cover select-none"
                draggable={false}
              />
              {containerSize.width > 0 &&
                ctas.map((cta) => (
                  <CtaHandle
                    key={cta.id}
                    cta={cta}
                    others={ctas.filter((c) => c.id !== cta.id)}
                    containerSize={containerSize}
                    isSelected={cta.id === selectedId}
                    onChange={(patch) => updateCta(cta.id, patch)}
                    onGuides={setGuides}
                    onSelect={() => setSelectedId(cta.id)}
                  />
                ))}
              {guides.verticalAt !== undefined && (
                <div
                  className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed border-[#567baf]"
                  style={{ left: guides.verticalAt }}
                />
              )}
              {guides.horizontalAt !== undefined && (
                <div
                  className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-[#567baf]"
                  style={{ top: guides.horizontalAt }}
                />
              )}
              {ctas.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center">
                  <span className="rounded-full bg-white/92 px-5 py-3 text-sm font-extrabold text-[#687083] shadow-[0_10px_28px_rgba(31,34,48,0.16)] ring-1 ring-white/80 backdrop-blur-sm">
                    このセクションにはボタンがありません
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right column on desktop, bottom panel on mobile.
              Property form stays visible while the user drags / styles
              the button on the left so colour/text changes are
              immediately visible without scrolling. */}
          <div
            className={`flex min-h-0 flex-col overflow-hidden border-t border-[#e2e7f0] bg-white lg:w-[390px] lg:flex-1 lg:shrink-0 lg:border-l lg:border-t-0 ${panelOpen ? 'flex-1' : ''}`}
          >
            {/* Mobile-only collapsible header (hidden on lg+). */}
            <div className="flex items-center gap-3 border-b border-[#e2e7f0] px-5 lg:hidden">
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 text-left transition hover:bg-[#f8fafc]"
                aria-expanded={panelOpen}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {selected ? (
                    <>
                      <span className="text-[11px] font-extrabold leading-none text-[#8b91a1]">
                        選択中のボタン
                      </span>
                      <PresetChip cta={selected} size="compact" />
                    </>
                  ) : (
                    <span className="font-semibold text-[#8b91a1]">
                      ボタンを選択すると編集できます
                    </span>
                  )}
                </span>
                <CollapseToggleIcon open={panelOpen} />
              </button>
              {selected && (
                <div className="flex shrink-0 items-center gap-2">
                  <CopyButton cta={selected} compact />
                  <button
                    type="button"
                    onClick={() => {
                      void confirmRemoveCta(selected.id);
                    }}
                    className={`${EDITOR_DANGER_BUTTON_CLASS} h-9 px-3 py-1.5 text-xs`}
                  >
                    削除
                  </button>
                </div>
              )}
            </div>

            {/* Desktop-only sticky header (hidden on mobile, where the
                collapsible header above replaces it). */}
            <div className="hidden shrink-0 items-center justify-between gap-3 border-b border-[#e2e7f0] px-5 py-4 lg:flex">
              <span className="flex min-w-0 items-center gap-2 text-sm font-extrabold text-[#3f4352]">
                {selected ? (
                  <>
                    <span className="shrink-0 whitespace-nowrap">選択中のボタン</span>
                    <PresetChip cta={selected} size="compact" />
                  </>
                ) : (
                  <span className="font-semibold text-[#8b91a1]">
                    ボタンを選択
                  </span>
                )}
              </span>
              {selected && (
                <div className="flex shrink-0 items-center gap-2">
                  <CopyButton cta={selected} compact />
                  <button
                    type="button"
                    onClick={() => {
                      void confirmRemoveCta(selected.id);
                    }}
                    className={`${EDITOR_DANGER_BUTTON_CLASS} h-9 px-3 py-1.5 text-xs`}
                  >
                    削除
                  </button>
                </div>
              )}
            </div>

            <div
              className={`flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 ${
                panelOpen ? '' : 'hidden lg:block'
              }`}
            >
              {selected ? (
                <div className="pt-4">
                  {/*
                      Key on the selected CTA so CtaPropertyForm and
                      its CtaLinkForm subtree remount whenever the
                      operator switches between buttons. Otherwise
                      per-type drafts inside CtaLinkForm bleed across
                      buttons.
                    */}
                  <CtaPropertyForm
                    key={selected.id}
                    cta={selected}
                    onChange={(patch) => updateCta(selected.id, patch)}
                    myLinks={myLinks}
                  />
                </div>
              ) : (
                <div className="flex min-h-[30vh] flex-col items-center justify-center gap-5 py-6 lg:h-full">
                  <button
                    type="button"
                    onClick={() => headerAddMenuRef.current?.open()}
                    disabled={saving || ctas.length >= MAX_CTAS}
                    title={
                      ctas.length >= MAX_CTAS
                        ? `1セクションあたり最大${MAX_CTAS}個までです`
                        : undefined
                    }
                    className={`${EDITOR_PRIMARY_BUTTON_CLASS} w-full max-w-xs px-6 py-4 text-base`}
                  >
                    + ボタンを追加
                  </button>
                  <p className="text-center text-sm font-semibold text-[#8b91a1]">
                    {ctas.length === 0
                      ? 'まずはボタンを追加してください'
                      : '左の画像でボタンをクリックして選択すると、ここで詳細を編集できます'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PropertyFormProps {
  cta: Cta;
  onChange: (patch: Partial<Cta>) => void;
  myLinks: MyLink[];
}

function CtaPropertyForm({
  cta,
  onChange,
  myLinks,
}: PropertyFormProps) {
  function patchStyle(stylePatch: Partial<Cta['style']>) {
    onChange({ style: { ...cta.style, ...stylePatch } });
  }

  /**
   * Switching template should reset *all* decoration overrides so the
   * new template's baseline takes effect visually — otherwise an
   * earlier toggle (e.g. "shadow off" on LINE) keeps suppressing the
   * new template's signature. Text / link / colors / radius are kept
   * because they're the operator's content, not the template's
   * visual identity.
   */
  function changeTemplate(next: CtaTemplate) {
    const cleared: Partial<Cta['style']> = {};
    for (const k of CTA_DECORATION_OVERRIDE_KEYS) {
      (cleared as Record<string, undefined>)[k] = undefined;
    }
    onChange({
      style: { ...cta.style, ...cleared, template: next },
    });
  }

  const buttonMode = getCtaButtonMode(cta);

  function changeButtonMode(mode: CtaButtonMode) {
    onChange({
      buttonMode: mode,
      size: fitCtaSizeToMode(mode, cta),
    });
  }

  function changePreset(selection: CtaTextPresetSelection) {
    const preset = CTA_PRESETS.find((item) => item.id === selection);
    if (!preset) return;
    const template = preset.build();
    onChange({
      buttonMode: 'text',
      text: template.text,
      image: undefined,
      size: {
        ...cta.size,
        height: template.size.height,
      },
      style: { ...template.style },
      link: migrateCtaLink(cta.link, template.link),
      destination_kind: template.destination_kind,
    });
  }

  return (
    <div className={`${EDITOR_TIGHT_STACK_CLASS} text-sm`}>
      <div className={`${EDITOR_SUB_PANEL_CLASS} space-y-3`}>
        <div>
          <span className={EDITOR_LABEL_CLASS}>表示タイプ</span>
          <p className={`${EDITOR_HELP_CLASS} mt-1`}>
            通常ボタンと画像ボタンを切り替えます。位置と幅は残し、高さは切り替え先に合わせます。
          </p>
        </div>
        <AdminSegmentedControl
          value={buttonMode}
          options={CTA_BUTTON_MODE_OPTIONS}
          onChange={changeButtonMode}
        />
      </div>

      {buttonMode === 'text' && (
        <CtaPresetPanel
          value={getCtaTextPresetSelection(cta)}
          onChange={changePreset}
        />
      )}

      {buttonMode === 'image' ? (
        <CtaImageButtonSettings
          cta={cta}
          onChange={onChange}
        />
      ) : (
        <CtaTextButtonSettings
          cta={cta}
          onChange={onChange}
          patchStyle={patchStyle}
          changeTemplate={changeTemplate}
        />
      )}

      <div
        className={`${EDITOR_SUB_PANEL_CLASS} ${EDITOR_TIGHT_STACK_CLASS}`}
        data-cta-link-settings="true"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={EDITOR_LABEL_CLASS}>リンク設定</span>
          <span className="rounded-full bg-[#eef4fb] px-2 py-0.5 text-[10px] font-extrabold text-[#567baf]">
            共通
          </span>
        </div>
        <CtaLinkForm
          link={cta.link}
          onChange={(link) => onChange({ link })}
          myLinks={myLinks}
        />
      </div>

      <div className={`${EDITOR_SUB_PANEL_CLASS} ${EDITOR_TIGHT_STACK_CLASS}`}>
        <EditorField label="アニメーション">
          <AdminSelect
            value={cta.animation ?? 'none'}
            onChange={(e) => {
              const v = e.target.value as CtaAnimation;
              onChange({ animation: v === 'none' ? undefined : v });
            }}
          >
            {CTA_ANIMATIONS.map((a) => (
              <option key={a} value={a}>
                {ANIMATION_LABELS[a]}
              </option>
            ))}
          </AdminSelect>
        </EditorField>
      </div>

      <CtaAnalysisMetadataSettings cta={cta} onChange={onChange} />
    </div>
  );
}

function cleanOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function CtaAnalysisMetadataSettings({
  cta,
  onChange,
}: {
  cta: Cta;
  onChange: (patch: Partial<Cta>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`${EDITOR_SUB_PANEL_CLASS} p-0`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-[#eef4fb]"
        aria-expanded={open}
      >
        <span className={EDITOR_LABEL_CLASS}>分析メモ</span>
        <CollapseToggleIcon open={open} className="h-8 w-8" />
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-4 px-4 pb-4 pt-1 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={EDITOR_LABEL_CLASS}>CTAラベル</span>
            <input
              type="text"
              value={cta.label ?? ''}
              onChange={(e) =>
                onChange({ label: cleanOptionalText(e.target.value) })
              }
              maxLength={120}
              className={CTA_MODAL_INPUT_CLASS}
              placeholder="例：上部LINE CTA"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={EDITOR_LABEL_CLASS}>役割</span>
            <input
              type="text"
              value={cta.role ?? ''}
              onChange={(e) =>
                onChange({ role: cleanOptionalText(e.target.value) })
              }
              maxLength={120}
              className={CTA_MODAL_INPUT_CLASS}
              placeholder="例：primary_cv"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <span className={EDITOR_LABEL_CLASS}>CTA分類</span>
            <input
              type="text"
              value={cta.destination_kind ?? ''}
              onChange={(e) =>
                onChange({
                  destination_kind: cleanOptionalText(e.target.value),
                })
              }
              maxLength={80}
              className={CTA_MODAL_INPUT_CLASS}
              placeholder={CTA_METADATA_KIND_PLACEHOLDER}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <span className={EDITOR_LABEL_CLASS}>分析メモ</span>
            <textarea
              value={cta.analysis_note ?? ''}
              onChange={(e) =>
                onChange({ analysis_note: cleanOptionalText(e.target.value) })
              }
              maxLength={500}
              className={`${CTA_MODAL_INPUT_CLASS} min-h-20 resize-y`}
              placeholder="Connector分析で補足したいこと"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function CtaTextButtonSettings({
  cta,
  onChange,
  patchStyle,
  changeTemplate,
}: {
  cta: Cta;
  onChange: (patch: Partial<Cta>) => void;
  patchStyle: (patch: Partial<Cta['style']>) => void;
  changeTemplate: (next: CtaTemplate) => void;
}) {
  return (
    <div className={`${EDITOR_SUB_PANEL_CLASS} ${EDITOR_TIGHT_STACK_CLASS}`}>
      <div>
        <span className={EDITOR_LABEL_CLASS}>通常ボタン設定</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-3 sm:col-span-2">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10.5rem,12rem)] sm:items-end">
            <label className="flex min-w-0 flex-col gap-1.5 sm:self-start">
              <span className={EDITOR_LABEL_CLASS}>メイン文言</span>
              <input
                type="text"
                value={cta.text}
                onChange={(e) => onChange({ text: e.target.value })}
                maxLength={60}
                className={CTA_MODAL_INPUT_CLASS}
              />
            </label>
            <EditorField label="文字色" className="sm:self-start">
              <ColorField
                value={cta.style.textColor}
                onChange={(textColor) => patchStyle({ textColor })}
                label="メイン文字色"
                textInputClassName="min-w-0 flex-1"
              />
            </EditorField>
          </div>
          <CtaRangeNumberField
            label="フォントサイズ"
            value={cta.style.fontSize ?? 28}
            onChange={(fontSize) => patchStyle({ fontSize })}
            min={8}
            max={120}
            unit="px"
          />
        </div>

        <div className="grid gap-3 sm:col-span-2">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10.5rem,12rem)] sm:items-end">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={EDITOR_LABEL_CLASS}>サブテキスト（任意）</span>
              <input
                type="text"
                value={cta.style.subText ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  patchStyle({ subText: v === '' ? undefined : v });
                }}
                maxLength={40}
                className={CTA_MODAL_INPUT_CLASS}
              />
              <span className={EDITOR_HELP_CLASS}>メイン文言の上に表示されます</span>
            </label>
            <EditorField label="文字色">
              <ColorField
                value={cta.style.subTextColor ?? cta.style.textColor}
                onChange={(subTextColor) => patchStyle({ subTextColor })}
                label="サブ文字色"
                textInputClassName="min-w-0 flex-1"
              />
            </EditorField>
          </div>
          <CtaRangeNumberField
            label="フォントサイズ"
            value={cta.style.subTextFontSize ?? 18}
            onChange={(subTextFontSize) => patchStyle({ subTextFontSize })}
            min={8}
            max={120}
            unit="px"
          />
        </div>

        <EditorField
          label="デザインプリセット"
          className="sm:col-span-2"
        >
          <AdminSelect
            value={cta.style.template ?? 'simple'}
            onChange={(e) => changeTemplate(e.target.value as CtaTemplate)}
          >
            {CTA_TEMPLATE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </AdminSelect>
          <span className={EDITOR_HELP_CLASS}>
            デザインだけを切り替えます。リンク先は変わりません。
          </span>
        </EditorField>

        <div className="sm:col-span-2">
          <CtaFillSection style={cta.style} onPatch={(p) => patchStyle(p)} />
        </div>

        <div className="sm:col-span-2">
          <CtaDecorationPanel
            style={cta.style}
            onPatch={(patch) => patchStyle(patch)}
          />
        </div>
      </div>
    </div>
  );
}

function CtaImageButtonSettings({
  cta,
  onChange,
}: {
  cta: Cta;
  onChange: (patch: Partial<Cta>) => void;
}) {
  function handleImageChange(img: CtaImage | undefined) {
    const patch: Partial<Cta> = { image: img, buttonMode: 'image' };
    if (img && img.width > 0 && img.height > 0) {
      patch.size = fitCtaSizeToImage(cta.size, img);
    }
    onChange(patch);
  }

  return (
    <div className={`${EDITOR_SUB_PANEL_CLASS} ${EDITOR_TIGHT_STACK_CLASS}`}>
      <div>
        <span className={EDITOR_LABEL_CLASS}>画像ボタン設定</span>
        <p className={`${EDITOR_HELP_CLASS} mt-1`}>
          Canva等で作った画像をボタンとして使う場合だけアップロードします。
        </p>
      </div>

      <CtaImagePicker
        image={cta.image}
        onChange={handleImageChange}
      />

      <EditorField label="画像が表示されなかった時のテキスト">
        <input
          type="text"
          value={cta.text}
          onChange={(e) => onChange({ text: e.target.value })}
          maxLength={60}
          className={CTA_MODAL_INPUT_CLASS}
        />
        <span className={EDITOR_HELP_CLASS}>
          読み上げや画像読み込み失敗時に使われます。
        </span>
      </EditorField>
    </div>
  );
}

function fitCtaSizeToImage(
  size: Cta['size'],
  image: CtaImage,
): Cta['size'] {
  const imageAspect = image.height / image.width;
  const width = Math.max(4, Math.min(95, size.width || 60));
  const height = Math.max(3, Math.min(60, width * imageAspect));
  return { width, height };
}

function fitCtaSizeToMode(
  mode: CtaButtonMode,
  cta: Cta,
): Cta['size'] {
  if (mode === 'image') {
    return cta.image
      ? fitCtaSizeToImage(cta.size, cta.image)
      : { ...cta.size, height: 10 };
  }
  return {
    ...cta.size,
    height: cta.style.subText ? 15 : 13,
  };
}

function CtaPresetPanel({
  value,
  onChange,
}: {
  value: CtaTextPresetSelection;
  onChange: (value: CtaTextPresetSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentPreset = CTA_PRESETS.find((preset) => preset.id === value);
  return (
    <div className={`${EDITOR_SUB_PANEL_CLASS} bg-[#f8fafc]/82 p-0`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-[#eef4fb]"
        aria-expanded={open}
      >
        <span className={EDITOR_LABEL_CLASS}>プリセットを変更する</span>
        <CollapseToggleIcon open={open} className="h-8 w-8" />
      </button>
      {!open && (
        <div className="px-3 pb-3">
          <div className="flex items-center gap-3 rounded-xl bg-white px-3 py-3 ring-1 ring-[#e2e7f0]">
            {currentPreset && <PresetChip cta={currentPreset.build()} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-extrabold text-[#3f4352]">
                {currentPreset?.label ?? 'シンプル'}
              </span>
              <span className={`${EDITOR_HELP_CLASS} block truncate`}>
                選択中
              </span>
            </span>
          </div>
        </div>
      )}
      {open && (
        <div className="space-y-1 px-3 pb-3">
          {CTA_PRESETS.map((preset) => (
            <PresetChoiceButton
              key={preset.id}
              active={value === preset.id}
              chip={<PresetChip cta={preset.build()} />}
              label={preset.label}
              description={preset.description}
              onClick={() => onChange(preset.id as CtaTextPresetSelection)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PresetChoiceButton({
  active,
  chip,
  label,
  description,
  onClick,
}: {
  active: boolean;
  chip: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
        active
          ? 'bg-[#eef4fb] ring-2 ring-[#9bb4d6]'
          : 'hover:bg-white'
      }`}
    >
      {chip}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold text-[#3f4352]">
          {label}
        </span>
        <span className={`${EDITOR_HELP_CLASS} block truncate`}>
          {description}
        </span>
      </span>
    </button>
  );
}

interface DecorationPanelProps {
  style: Cta['style'];
  onPatch: (patch: Partial<Cta['style']>) => void;
}

/**
 * Collapsible "装飾を細かく調整" block. Each row reads the *effective*
 * value via getEffectiveDecoration (so the user sees what the
 * template baseline produces today) and writes back an *explicit
 * override* on the style. The template's baseline still wins when an
 * override field is `undefined`, so wiping the override returns the
 * row to the baseline value.
 */
function CtaDecorationPanel({ style, onPatch }: DecorationPanelProps) {
  const eff = getEffectiveDecoration(style);
  const [open, setOpen] = useState(false);
  const iconEnabled = eff.iconLeft !== 'none';
  const fallbackIcon = getTemplateBaseline(style.template).iconLeft;
  const nextIcon = fallbackIcon === 'none' ? 'arrow-right' : fallbackIcon;

  return (
    <div className={`${EDITOR_SUB_PANEL_CLASS} p-0`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-xs font-extrabold text-[#3f4352] transition hover:bg-[#eef4fb]"
        aria-expanded={open}
      >
        <span>装飾を細かく調整（アイコン・影・枠線 等）</span>
        <CollapseToggleIcon open={open} className="h-8 w-8" />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 pt-1">
          <DecorationCard
            title="アイコン"
            description="ボタン文言の左右に入る記号です。"
            checked={iconEnabled}
            onChange={(checked) =>
              onPatch({ iconLeft: checked ? nextIcon : 'none' })
            }
          >
            {iconEnabled && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <EditorField label="種類">
                    <AdminSelect
                      value={eff.iconLeft}
                      onChange={(e) =>
                        onPatch({ iconLeft: e.target.value as CtaIconLeft })
                      }
                    >
                      {CTA_ICON_LEFT_OPTIONS.filter((opt) => opt.id !== 'none').map(
                        (opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        )
                      )}
                    </AdminSelect>
                  </EditorField>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className={EDITOR_LABEL_CLASS}>位置</span>
                    <AdminSegmentedControl
                      value={eff.iconPosition}
                      options={CTA_ICON_POSITION_OPTIONS}
                      onChange={(iconPosition) => onPatch({ iconPosition })}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[auto_minmax(12rem,1fr)] sm:items-end">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className={EDITOR_LABEL_CLASS}>丸背景</span>
                    <AdminToggleSwitch
                      checked={eff.iconCircle}
                      onChange={(iconCircle) => onPatch({ iconCircle })}
                      onLabel="ON"
                      offLabel="OFF"
                    />
                  </div>
                  <NumberPickerInline
                    label="サイズ"
                    value={eff.iconSize}
                    onChange={(iconSize) => onPatch({ iconSize })}
                    min={8}
                    max={64}
                  />
                </div>
              </div>
            )}
          </DecorationCard>

          <DecorationCard
            title="ドロップシャドウ"
            description="ボタンを背景から浮かせる影です。"
            checked={eff.shadow}
            onChange={(shadow) => onPatch({ shadow })}
          >
            {eff.shadow && (
              <div className="space-y-3">
                <ColorPickerInline
                  label="色"
                  value={eff.shadowColor}
                  isOverride={style.shadowColor !== undefined}
                  onChange={(v) => onPatch({ shadowColor: v })}
                  onReset={() => onPatch({ shadowColor: undefined })}
                />
                <div className="grid gap-3">
                  <NumberPickerInline
                    label="ぼかし"
                    value={eff.shadowBlur}
                    onChange={(v) => onPatch({ shadowBlur: v })}
                    min={0}
                    max={80}
                  />
                  <NumberPickerInline
                    label="縦位置"
                    value={eff.shadowY}
                    onChange={(v) => onPatch({ shadowY: v })}
                    min={-40}
                    max={40}
                  />
                  <NumberPickerInline
                    label="濃さ"
                    value={Math.round(eff.shadowOpacity * 100)}
                    onChange={(v) => onPatch({ shadowOpacity: v / 100 })}
                    min={0}
                    max={100}
                    unit="%"
                  />
                </div>
              </div>
            )}
          </DecorationCard>

          <DecorationCard
            title="周囲の枠線"
            description="ボタンの外側に線を付けます。"
            checked={eff.outline}
            onChange={(outline) => onPatch({ outline })}
          >
            {eff.outline && (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)] sm:items-end">
                <ColorPickerInline
                  label="色"
                  value={eff.outlineColor}
                  isOverride={style.outlineColor !== undefined}
                  onChange={(v) => onPatch({ outlineColor: v })}
                  onReset={() => onPatch({ outlineColor: undefined })}
                />
                <NumberPickerInline
                  label="太さ"
                  value={eff.outlineWidth}
                  onChange={(v) => onPatch({ outlineWidth: v })}
                  min={1}
                  max={20}
                />
              </div>
            )}
          </DecorationCard>
        </div>
      )}
    </div>
  );
}

function DecorationCard({
  title,
  description,
  checked,
  onChange,
  children,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-white/72 px-3 py-3 ring-1 ring-[#e2e7f0]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-xs font-extrabold text-[#3f4352]">
            {title}
          </span>
          <span className={EDITOR_HELP_CLASS}>{description}</span>
        </div>
        <AdminToggleSwitch
          checked={checked}
          onChange={onChange}
          onLabel="ON"
          offLabel="OFF"
        />
      </div>
      {children}
    </div>
  );
}

interface FillSectionProps {
  style: Cta['style'];
  onPatch: (patch: Partial<Cta['style']>) => void;
}

/**
 * Visual block — keeps fill, text colour and corner radius together.
 * Operator picks between 単色 and グラデーション; the conditional
 * sub-fields surface what each mode actually needs (one color vs.
 * start/end colors + angle). The "開始色" anchor in gradient mode
 * is the same backgroundColor as the solid mode, so flipping
 * between modes never loses the operator's primary brand color.
 */
function CtaFillSection({ style, onPatch }: FillSectionProps) {
  const eff = getEffectiveDecoration(style);
  const angleShown = style.gradientAngle ?? eff.gradientAngle;
  return (
    <div className={`${EDITOR_SUB_PANEL_CLASS} space-y-4`}>
      <div>
        <span className={EDITOR_LABEL_CLASS}>背景・形</span>
      </div>
      <EditorField label="塗りつぶし">
        <AdminSelect
          value={eff.fill}
          onChange={(e) =>
            onPatch({ fill: e.target.value as 'solid' | 'gradient' })
          }
        >
          <option value="solid">単色</option>
          <option value="gradient">グラデーション</option>
        </AdminSelect>
      </EditorField>

      {/*
        div / span structure instead of <label> wrappers — clicking
        the label text "背景色" / "開始色" should NOT open the color
        picker, only clicking the swatch or focusing the hex input
        should. With <label> the implicit `for` association made any
        click inside the label open the picker (operator complained
        the hit area was the whole row).
      */}
      {eff.fill === 'solid' ? (
        <EditorField label="背景色">
          <ColorField
            value={style.backgroundColor}
            onChange={(backgroundColor) => onPatch({ backgroundColor })}
            label="背景色"
            textInputClassName="w-full"
          />
        </EditorField>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <EditorField label="開始色">
              <ColorField
                value={style.backgroundColor}
                onChange={(backgroundColor) => onPatch({ backgroundColor })}
                label="開始色"
                textInputClassName="min-w-0 flex-1"
              />
            </EditorField>

            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={EDITOR_LABEL_CLASS}>
                終了色
                {style.gradientEndColor === undefined && (
                  <span className="ml-2 text-[10px] text-[#8b91a1]">
                    （自動算出中）
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={eff.gradientEndColor}
                  onChange={(e) => onPatch({ gradientEndColor: e.target.value })}
                  className="color-input h-10 w-11 shrink-0 rounded-xl border border-[#d7deea] bg-white p-1"
                />
                <input
                  type="text"
                  value={eff.gradientEndColor}
                  onChange={(e) => onPatch({ gradientEndColor: e.target.value })}
                  className={`${EDITOR_INPUT_CLASS} min-w-0 flex-1 font-mono text-xs`}
                />
                {style.gradientEndColor !== undefined && (
                  <button
                    type="button"
                    onClick={() => onPatch({ gradientEndColor: undefined })}
                    title="背景色から自動算出に戻す"
                    className={`${EDITOR_SECONDARY_BUTTON_CLASS} min-h-9 whitespace-nowrap px-3 py-1 text-xs`}
                  >
                    自動
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-end gap-2">
              <CtaRangeNumberField
                label="角度（0=↑ / 90=→ / 180=↓ / 270=←）"
                value={angleShown}
                onChange={(gradientAngle) => onPatch({ gradientAngle })}
                min={0}
                max={359}
                unit="deg"
                normalizeValue={(n) => ((Math.round(n) % 360) + 360) % 360}
                className="min-w-[12rem] flex-1"
              />
              <div className="flex gap-1">
                {[
                  { v: 0, lbl: '↑' },
                  { v: 90, lbl: '→' },
                  { v: 180, lbl: '↓' },
                  { v: 270, lbl: '←' },
                ].map((q) => (
                  <button
                    key={q.v}
                    type="button"
                    onClick={() => onPatch({ gradientAngle: q.v })}
                    title={`${q.v}deg`}
                    className={`min-h-9 rounded-full border px-3 py-1 text-xs font-extrabold transition ${
                      angleShown === q.v
                        ? 'border-[#9bb4d6] bg-[#eef4fb] text-[#567baf]'
                        : 'border-[#d7deea] bg-white text-[#596173] hover:bg-[#f8fafc]'
                    }`}
                  >
                    {q.lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        <CtaRangeNumberField
          label="角丸"
          value={style.borderRadius}
          onChange={(borderRadius) => onPatch({ borderRadius })}
          min={0}
          max={100}
          unit="px"
        />
      </div>
    </div>
  );
}

interface ColorPickerInlineProps {
  label: string;
  value: string;
  isOverride: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
}

function ColorPickerInline({
  label,
  value,
  isOverride,
  onChange,
  onReset,
}: ColorPickerInlineProps) {
  // Plain span wrapper — no <label> implicit `for` association.
  // Reasoning: with <label>, clicking the label text or any padding
  // inside it opens the color picker (because <input type=color> is
  // the first focusable child). The operator wanted the click area
  // limited to the swatch / hex input themselves.
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-xs">
      {label && <span className="font-semibold text-[#687082]">{label}</span>}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="color-input h-[2.75rem] w-11 shrink-0 cursor-pointer rounded-xl border border-[#d7deea] bg-white p-1"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${EDITOR_INPUT_CLASS} h-[2.75rem] w-28 min-w-0 px-2 py-1 font-mono text-xs`}
      />
      {isOverride && (
        <button
          type="button"
          onClick={onReset}
          title="プリセット既定に戻す"
          className={`${EDITOR_SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[10px]`}
        >
          既定
        </button>
      )}
    </span>
  );
}

interface NumberPickerInlineProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unit?: string;
  normalizeValue?: (v: number) => number;
}

interface NumericTextInputProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  className?: string;
  normalizeValue?: (v: number) => number;
}

function NumericTextInput({
  value,
  onChange,
  min,
  max,
  className,
  normalizeValue,
}: NumericTextInputProps) {
  const safeValue = normalizeNumber(value, min, max, normalizeValue);
  const [inputValue, setInputValue] = useState(String(safeValue));

  useEffect(() => {
    setInputValue(String(safeValue));
  }, [safeValue]);

  function clean(raw: string) {
    const sign = min < 0 && raw.trimStart().startsWith('-') ? '-' : '';
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (sign && digits === '') return '-';
    return `${sign}${digits}`;
  }

  function commit(raw: string) {
    const cleaned = clean(raw);
    if (cleaned === '' || cleaned === '-') {
      setInputValue(String(safeValue));
      onChange(safeValue);
      return;
    }
    const next = normalizeNumber(Number(cleaned), min, max, normalizeValue);
    setInputValue(String(next));
    onChange(next);
  }

  function handleInput(raw: string) {
    const cleaned = clean(raw);
    setInputValue(cleaned);
    if (cleaned === '' || cleaned === '-') return;
    const next = Number(cleaned);
    if (!Number.isFinite(next)) return;
    if (next >= min && next <= max) {
      onChange(normalizeNumber(next, min, max, normalizeValue));
    }
  }

  return (
    <input
      type="text"
      inputMode={min < 0 ? 'text' : 'numeric'}
      pattern={min < 0 ? '-?[0-9]*' : '[0-9]*'}
      value={inputValue}
      onChange={(e) => handleInput(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      className={className}
    />
  );
}

function normalizeNumber(
  value: number,
  min: number,
  max: number,
  normalizeValue?: (v: number) => number,
) {
  const base = Number.isFinite(value) ? value : min;
  const normalized = normalizeValue ? normalizeValue(base) : base;
  return Math.max(min, Math.min(max, normalized));
}

interface CtaRangeNumberFieldProps extends NumericTextInputProps {
  label: string;
  unit?: string;
  step?: number;
}

const CTA_RANGE_INPUT_CLASS =
  'h-3 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#567baf] [&::-moz-range-thumb]:shadow-[0_8px_18px_rgba(86,123,175,0.25)] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#567baf] [&::-webkit-slider-thumb]:shadow-[0_8px_18px_rgba(86,123,175,0.25)]';

function CtaRangeNumberField({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  step = 1,
  className,
  normalizeValue,
}: CtaRangeNumberFieldProps) {
  const safeValue = normalizeNumber(value, min, max, normalizeValue);
  const percent = max > min ? ((safeValue - min) / (max - min)) * 100 : 0;

  return (
    <label className={['flex min-w-0 flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {label && <span className={EDITOR_LABEL_CLASS}>{label}</span>}
      <span className="flex min-h-[2.75rem] w-full max-w-[22rem] items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          onChange={(e) =>
            onChange(normalizeNumber(Number(e.target.value), min, max, normalizeValue))
          }
          className={CTA_RANGE_INPUT_CLASS}
          style={{
            background: `linear-gradient(to right, #567baf 0%, #567baf ${percent}%, #d8e3f2 ${percent}%, #d8e3f2 100%)`,
          }}
        />
        <span className="flex shrink-0 items-center gap-1">
          <NumericTextInput
            value={safeValue}
            onChange={onChange}
            min={min}
            max={max}
            normalizeValue={normalizeValue}
            className={`${EDITOR_INPUT_CLASS} h-[2.75rem] w-[4.5rem] px-2 py-1 text-center text-xs`}
          />
          {unit && (
            <span className="text-xs font-extrabold text-[#8b91a1]">{unit}</span>
          )}
        </span>
      </span>
    </label>
  );
}

function NumberPickerInline({
  label,
  value,
  onChange,
  min,
  max,
  unit = 'px',
  normalizeValue,
}: NumberPickerInlineProps) {
  // span wrapper to keep the click area tight to the input itself
  // (label-text and the trailing "px" are deliberately non-interactive).
  return (
    <span className="inline-flex min-w-[12rem] max-w-full text-xs">
      <CtaRangeNumberField
        label={label}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        unit={unit}
        normalizeValue={normalizeValue}
      />
    </span>
  );
}

interface CtaImagePickerProps {
  image: CtaImage | undefined;
  onChange: (image: CtaImage | undefined) => void;
}

function CtaImagePicker({ image, onChange }: CtaImagePickerProps) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadImage(file);
      onChange({
        url: uploaded.url,
        width: uploaded.width,
        height: uploaded.height,
      });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setUploading(false);
    }
  }

  function onFiles(files: File[]) {
    const file = files.find((f) => f.type.startsWith('image/'));
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={EDITOR_LABEL_CLASS}>ボタン画像</span>
          <p className={`${EDITOR_HELP_CLASS} mt-1`}>
            画像を選ぶと、その画像をボタンとして表示します。
          </p>
        </div>
        {image && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className={`${EDITOR_DANGER_BUTTON_CLASS} min-h-10 shrink-0 px-3 py-1.5 text-xs`}
          >
            画像を外す
          </button>
        )}
      </div>

      {image && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div
            className="flex max-w-full items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-[#e2e7f0]"
            style={{
              width: `${Math.min(Math.max(image.width, 120), 260)}px`,
              aspectRatio:
                image.width > 0 && image.height > 0
                  ? `${image.width} / ${image.height}`
                  : '16 / 9',
            }}
          >
            <img
              src={image.url}
              alt="ボタン画像プレビュー"
              className="h-full w-full object-contain"
            />
          </div>
          <p className={`${EDITOR_HELP_CLASS} min-w-0 flex-1`}>
            この画像がLP上のボタンとして表示されます。
          </p>
        </div>
      )}

      <ImageUploadDropBox
        accept="image/png,image/jpeg,image/webp"
        busy={uploading}
        buttonLabel={image ? '画像を変更' : '画像を選択'}
        compact
        description="PNG / JPEG / WebP"
        onFiles={onFiles}
        progress="アップロード中..."
        title={image ? '別の画像に差し替え' : '画像をドラッグ&ドロップ'}
      />
    </div>
  );
}


function CtaPreviewBox({
  cta,
  isSelected = false,
  interactive = false,
  showAnimation = false,
  onNaturalHeightChange,
}: {
  cta: Cta;
  isSelected?: boolean;
  interactive?: boolean;
  showAnimation?: boolean;
  onNaturalHeightChange?: (height: number) => void;
}) {
  const buttonMode = getCtaButtonMode(cta);
  const hasImage = buttonMode === 'image' && !!cta.image;
  const imageMissing = buttonMode === 'image' && !cta.image;
  const deco = buttonMode === 'text' ? resolveCtaTemplate(cta) : null;
  const iconSvg = deco?.iconLeft ? CTA_ICON_SVGS[deco.iconLeft] : undefined;
  const iconOnRight = iconSvg && deco?.iconPosition === 'right';
  const iconOffset = iconSvg
    ? ctaPreviewIconOffset(cta, deco?.iconCircleColor, deco?.iconSize)
    : undefined;
  const iconPad = iconSvg
    ? ctaPreviewIconPadding(cta, deco?.iconCircleColor, deco?.iconSize)
    : undefined;
  const subText = buttonMode === 'text' ? cta.style.subText : undefined;
  const textContentRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!onNaturalHeightChange || buttonMode !== 'text' || imageMissing) {
      return;
    }
    const node = textContentRef.current;
    if (!node) return;

    let frame = 0;
    const report = () => {
      const nextHeight =
        Math.ceil(node.getBoundingClientRect().height) +
        TEXT_CTA_VERTICAL_PADDING_PX;
      onNaturalHeightChange(nextHeight);
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(report);
    };

    schedule();
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(node);
    window.addEventListener('resize', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [
    buttonMode,
    cta.style.fontSize,
    cta.style.subTextFontSize,
    cta.style.template,
    cta.text,
    imageMissing,
    onNaturalHeightChange,
    subText,
  ]);

  const boxStyle: React.CSSProperties = {
    backgroundColor: hasImage ? 'transparent' : imageMissing ? '#f8fafc' : undefined,
    background: hasImage
      ? undefined
      : imageMissing
        ? '#f8fafc'
        : (deco?.background ?? cta.style.backgroundColor),
    color: imageMissing ? '#8b91a1' : cta.style.textColor,
    borderRadius: hasImage ? 0 : imageMissing ? 12 : `${cta.style.borderRadius}px`,
    padding: hasImage ? 0 : undefined,
    paddingTop:
      hasImage || imageMissing ? undefined : TEXT_CTA_VERTICAL_PADDING_PX / 2,
    paddingBottom:
      hasImage || imageMissing ? undefined : TEXT_CTA_VERTICAL_PADDING_PX / 2,
    paddingLeft: iconSvg && !iconOnRight ? iconPad : undefined,
    paddingRight: iconSvg && iconOnRight ? iconPad : undefined,
    border:
      imageMissing
        ? '2px dashed #c8d5e8'
        : !hasImage && deco?.borderColor
          ? `${deco.borderWidth ?? 1}px solid ${deco.borderColor}`
          : undefined,
    boxShadow:
      !hasImage && !imageMissing && deco?.boxShadow ? deco.boxShadow : undefined,
    containerType: 'inline-size',
  };

  return (
    <div
      className={`relative h-full w-full flex items-center justify-center overflow-hidden px-2 text-center font-bold leading-tight ${
        interactive ? 'cursor-move' : ''
      } ${isSelected ? 'ring-2 ring-blue-500' : interactive ? 'ring-1 ring-blue-300/70' : ''} ${
        showAnimation && cta.animation && cta.animation !== 'none'
          ? `cta-anim-${cta.animation}`
          : ''
      }`}
      style={boxStyle}
    >
      {hasImage ? (
        <img
          src={cta.image!.url}
          alt={cta.text}
          className="h-full w-full object-contain pointer-events-none"
        />
      ) : imageMissing ? (
        <span
          style={{
            display: 'block',
            fontSize: ctaPreviewFontSize(cta),
            lineHeight: 1.2,
          }}
        >
          画像未設定
        </span>
      ) : (
        <>
          {iconSvg && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: iconOnRight ? undefined : iconOffset,
                right: iconOnRight ? iconOffset : undefined,
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: deco?.iconCircleColor ? '1.55em' : '1.15em',
                height: deco?.iconCircleColor ? '1.55em' : '1.15em',
                borderRadius: deco?.iconCircleColor ? 9999 : undefined,
                background: deco?.iconCircleColor ? '#ffffff' : undefined,
                color: deco?.iconCircleColor ?? 'currentColor',
                fontSize: ctaPreviewIconSize(cta, deco?.iconSize),
                lineHeight: 0,
              }}
            >
              <svg
                viewBox={`0 0 ${iconSvg.width} ${iconSvg.height}`}
                preserveAspectRatio="xMidYMid meet"
                fill="currentColor"
                style={{
                  display: 'block',
                  width: deco?.iconCircleColor ? '0.78em' : '1em',
                  height: deco?.iconCircleColor ? '0.78em' : '1em',
                }}
              >
                <path d={iconSvg.path} />
              </svg>
            </span>
          )}
          <span
            ref={textContentRef}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1.2,
              flex: '1 1 auto',
              minWidth: 0,
              width: '100%',
            }}
          >
            {subText && (
              <span
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  color: cta.style.subTextColor ?? cta.style.textColor,
                  fontSize: ctaSubTextPreviewFontSize(cta),
                  letterSpacing: '0.02em',
                  marginBottom: '0.35em',
                  whiteSpace: 'normal',
                  overflow: 'visible',
                  textOverflow: 'clip',
                  overflowWrap: 'anywhere',
                  lineBreak: 'strict',
                }}
              >
                {subText}
              </span>
            )}
            <span
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'center',
                color: cta.style.textColor,
                fontSize: ctaPreviewFontSize(cta),
                whiteSpace: 'normal',
                overflow: 'visible',
                textOverflow: 'clip',
                overflowWrap: 'anywhere',
                lineBreak: 'strict',
              }}
            >
              {cta.text || '（無題のボタン）'}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

interface HandleProps {
  cta: Cta;
  others: Cta[];
  containerSize: { width: number; height: number };
  isSelected: boolean;
  onChange: (patch: Partial<Cta>) => void;
  onGuides: (guides: Guides) => void;
  onSelect: () => void;
}

function CtaHandle({
  cta,
  others,
  containerSize,
  isSelected,
  onChange,
  onGuides,
  onSelect,
}: HandleProps) {
  const xPx = (cta.position.x / 100) * containerSize.width;
  const yPx = (cta.position.y / 100) * containerSize.height;
  const wPx = (cta.size.width / 100) * containerSize.width;
  const hPx = (cta.size.height / 100) * containerSize.width;
  const isTextMode = getCtaButtonMode(cta) === 'text';
  const [naturalHeightPx, setNaturalHeightPx] = useState(0);
  const handleNaturalHeightChange = useCallback((height: number) => {
    setNaturalHeightPx((current) =>
      Math.abs(current - height) > 1 ? height : current,
    );
  }, []);
  const minHeightPx =
    isTextMode ? TEXT_CTA_MIN_HEIGHT_PX : undefined;
  const baseHPx = isTextMode ? Math.max(hPx, minHeightPx ?? 0) : hPx;
  const renderedHPx = isTextMode
    ? Math.max(baseHPx, naturalHeightPx)
    : hPx;
  const renderedBottomPx = isTextMode
    ? Math.max(0, containerSize.height - yPx - baseHPx)
    : undefined;
  const renderedYPx = isTextMode
    ? containerSize.height - (renderedBottomPx ?? 0) - renderedHPx
    : yPx;
  const persistedTopFromRenderedTop = (renderedTop: number) =>
    renderedTop + renderedHPx - baseHPx;

  /**
   * Compute snap targets in pixels for X axis and Y axis given the
   * current candidate (left, top, width, height). Returns the snapped
   * left/top plus the guide line positions to draw.
   */
  function computeSnap(
    left: number,
    top: number,
    w: number,
    h: number,
  ): { left: number; top: number; guides: Guides } {
    const candidates = collectSnapTargets(others, containerSize);

    let snappedLeft = left;
    let snappedTop = top;
    const guides: Guides = {};

    // X axis: try left, center, right of the candidate against each target
    const myLeft = left;
    const myCenter = left + w / 2;
    const myRight = left + w;
    let bestX = SNAP_THRESHOLD + 1;
    let bestXGuide: number | undefined;
    let bestXAdjust = 0;
    for (const tx of candidates.x) {
      const dLeft = Math.abs(myLeft - tx);
      const dCenter = Math.abs(myCenter - tx);
      const dRight = Math.abs(myRight - tx);
      const dist = Math.min(dLeft, dCenter, dRight);
      if (dist < bestX) {
        bestX = dist;
        bestXGuide = tx;
        if (dist === dLeft) bestXAdjust = tx - myLeft;
        else if (dist === dCenter) bestXAdjust = tx - myCenter;
        else bestXAdjust = tx - myRight;
      }
    }
    if (bestX <= SNAP_THRESHOLD) {
      snappedLeft = left + bestXAdjust;
      guides.verticalAt = bestXGuide;
    }

    // Y axis: top, center, bottom
    const myTop = top;
    const myMid = top + h / 2;
    const myBottom = top + h;
    let bestY = SNAP_THRESHOLD + 1;
    let bestYGuide: number | undefined;
    let bestYAdjust = 0;
    for (const ty of candidates.y) {
      const dTop = Math.abs(myTop - ty);
      const dMid = Math.abs(myMid - ty);
      const dBottom = Math.abs(myBottom - ty);
      const dist = Math.min(dTop, dMid, dBottom);
      if (dist < bestY) {
        bestY = dist;
        bestYGuide = ty;
        if (dist === dTop) bestYAdjust = ty - myTop;
        else if (dist === dMid) bestYAdjust = ty - myMid;
        else bestYAdjust = ty - myBottom;
      }
    }
    if (bestY <= SNAP_THRESHOLD) {
      snappedTop = top + bestYAdjust;
      guides.horizontalAt = bestYGuide;
    }

    return { left: snappedLeft, top: snappedTop, guides };
  }

  return (
    <Rnd
      bounds="parent"
      position={{ x: xPx, y: renderedYPx }}
      size={{ width: wPx, height: renderedHPx }}
      minHeight={minHeightPx}
      onDrag={(_e, d) => {
        const { guides } = computeSnap(d.x, d.y, wPx, renderedHPx);
        onGuides(guides);
      }}
      onDragStop={(_e, d) => {
        const snap = computeSnap(d.x, d.y, wPx, renderedHPx);
        onGuides({});
        onChange({
          position: {
            x: (snap.left / containerSize.width) * 100,
            y:
              (persistedTopFromRenderedTop(snap.top) / containerSize.height) *
              100,
          },
        });
      }}
      onResize={(_e, _dir, ref, _delta, pos) => {
        const w = ref.offsetWidth;
        const h = ref.offsetHeight;
        const { guides } = computeSnap(pos.x, pos.y, w, h);
        onGuides(guides);
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        const w = ref.offsetWidth;
        const h = ref.offsetHeight;
        const snap = computeSnap(pos.x, pos.y, w, h);
        onGuides({});
        onChange({
          size: {
            width: (w / containerSize.width) * 100,
            height: (h / containerSize.width) * 100,
          },
          position: {
            x: (snap.left / containerSize.width) * 100,
            y: (snap.top / containerSize.height) * 100,
          },
        });
      }}
      onMouseDown={onSelect}
    >
      <CtaPreviewBox
        cta={cta}
        isSelected={isSelected}
        interactive
        showAnimation
        onNaturalHeightChange={
          isTextMode ? handleNaturalHeightChange : undefined
        }
      />
    </Rnd>
  );
}

/**
 * Mirrors the public renderer's font-size formula so the WYSIWYG
 * preview matches the visitor view. Font scales in lockstep with
 * the CTA box (cqw based) — generous clamp bounds only catch the
 * extremes.
 */
function ctaPreviewFontSize(cta: Cta): string {
  return ctaPreviewFontStyle(cta.style.fontSize, 28);
}

/** Same scaling formula as `ctaPreviewFontSize`, but anchored at 18
 *  by default — subText is the supplementary lead-in above the main
 *  label so it stays smaller than the 28 px main-text default. */
function ctaSubTextPreviewFontSize(cta: Cta): string {
  return ctaPreviewFontStyle(cta.style.subTextFontSize, 18);
}

function ctaPreviewIconSize(cta: Cta, resolvedIconSize?: number): string {
  const size = cta.style.iconSize ?? resolvedIconSize ?? 18;
  return `${Math.max(8, Math.min(64, size))}px`;
}

function ctaPreviewIconPadding(
  cta: Cta,
  hasCircle: string | undefined,
  resolvedIconSize?: number,
): string {
  const size = Math.max(8, Math.min(64, cta.style.iconSize ?? resolvedIconSize ?? 18));
  const preferred = Math.round(size * (hasCircle ? 1.35 : 1.08) + 12);
  const min = Math.max(20, Math.round(size * 0.9 + 8));
  const fluid = Math.round(size * 0.9 + 6);
  return `clamp(${min}px, calc(${fluid}px + 1vw), ${preferred}px)`;
}

function ctaPreviewIconOffset(
  cta: Cta,
  hasCircle: string | undefined,
  resolvedIconSize?: number,
): string {
  const size = Math.max(8, Math.min(64, cta.style.iconSize ?? resolvedIconSize ?? 18));
  const radius = Math.max(0, cta.style.borderRadius ?? 0);
  const radiusBoost = Math.min(14, Math.round(radius * 0.16));
  const circleBoost = hasCircle ? 4 : 0;
  const min = Math.round(size * 0.45 + 8 + circleBoost);
  const max = min + radiusBoost + 10;
  return `clamp(${min}px, calc(${min}px + 0.8vw), ${max}px)`;
}

function ctaPreviewFontStyle(
  set: number | undefined,
  defaultAnchor: number,
): string {
  const anchor =
    typeof set === 'number' && set > 0 ? Math.max(8, set) : defaultAnchor;
  const cqw = +(anchor / 4).toFixed(2);
  const ceil = anchor * 3;
  return `clamp(8px, ${cqw}cqw, ${ceil}px)`;
}

function CopyButton({
  cta,
  compact = false,
}: {
  cta: Cta;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    // Strip the id; clipboard stores a fresh template that becomes
    // a new instance when pasted.
    const { id: _id, ...template } = cta;
    void _id;
    setButtonClipboard(template);
    setCopied(true);
    showAdminToast({
      message: 'コピーしました。「+ ボタンを追加」から使えます。',
    });
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleCopy();
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full text-xs font-extrabold transition ${
        compact ? 'min-h-11 px-2.5 py-1.5' : 'min-h-10 px-3 py-2'
      } ${
        copied
          ? 'bg-[#e8f7ef] text-[#147a45]'
          : 'bg-[#f2f4f8] text-[#596173] hover:bg-[#e9edf4]'
      }`}
      title="このボタンを他のセクションでも使えるようにします"
    >
      {copied ? (
        <>
          <Check size={14} strokeWidth={2.4} aria-hidden="true" />
          使える状態
        </>
      ) : (
        <>
          <Copy size={14} strokeWidth={2.4} aria-hidden="true" />
          <span className="leading-tight">
            他のセクション
            <br />
            でも使う
          </span>
        </>
      )}
    </button>
  );
}

function collectSnapTargets(
  others: Cta[],
  containerSize: { width: number; height: number },
): { x: number[]; y: number[] } {
  const x: number[] = [0, containerSize.width / 2, containerSize.width];
  const y: number[] = [0, containerSize.height / 2, containerSize.height];

  for (const other of others) {
    const ox = (other.position.x / 100) * containerSize.width;
    const oy = (other.position.y / 100) * containerSize.height;
    const ow = (other.size.width / 100) * containerSize.width;
    const oh = (other.size.height / 100) * containerSize.width;
    x.push(ox, ox + ow / 2, ox + ow);
    y.push(oy, oy + oh / 2, oy + oh);
  }

  return { x, y };
}
