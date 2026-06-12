/**
 * AddCtaMenu
 *
 * Replaces the "+ ボタンを追加" button. When clicked, shows a popover
 * with five preset templates (color + shape + link defaults). Picking
 * one inserts a new CTA configured to that preset.
 *
 * Each preset is a sensible starting point; the user can still edit
 * everything afterwards in the property form.
 */

import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Cta } from '../../lib/content';
import {
  getButtonClipboard,
  type ButtonClipboardEntry,
} from '../../lib/clipboard';
import {
  resolveCtaTemplate,
  CTA_ICON_DEFINITIONS,
} from '../../lib/cta-template';
import {
  EDITOR_HELP_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_SECONDARY_BUTTON_CLASS,
} from './LpEditorPrimitives';

export interface CtaPreset {
  id: string;
  label: string;
  description: string;
  build: () => Omit<Cta, 'id'>;
}

/**
 * Presets are organized by *function* (what the button does), not by
 * color. Each preset already wires up an appropriate link type and
 * sensible defaults so the user only fills in the destination
 * (URL / phone / email). Color and shape can still be tweaked after.
 */
export const CTA_PRESETS: CtaPreset[] = [
  {
    id: 'line-friend',
    label: 'LINE登録',
    description: 'LINE友だち追加URLを入力',
    build: () => ({
      text: 'LINE登録する',
      buttonMode: 'text',
      position: { x: 20, y: 75 },
      size: { width: 60, height: 13 },
      style: {
        backgroundColor: '#0fa848',
        textColor: '#ffffff',
        borderRadius: 10,
        template: 'line',
        fontSize: 32,
        iconLeft: 'line',
        iconPosition: 'left',
        iconCircle: false,
      },
      destination_kind: 'line',
      // URL は空にする — プリセットから追加した時に旧 URL が
      // 残ってると気付かず保存して「リンク先がデフォルトのまま」
      // という事故が起きる。空にして必ず入力させる方向で。
      link: { type: 'custom_url', url: '' },
    }),
  },
  {
    id: 'tel',
    label: '電話',
    description: '電話番号を入力',
    build: () => ({
      text: '0120-12-3456',
      buttonMode: 'text',
      position: { x: 20, y: 80 },
      size: { width: 60, height: 13 },
      style: {
        backgroundColor: '#ee4e1e',
        textColor: '#ffffff',
        borderRadius: 9999,
        template: 'phone',
        fontSize: 34,
      },
      link: { type: 'tel', number: '' },
    }),
  },
  {
    id: 'mailto',
    label: 'メール',
    description: 'メールアドレスを入力',
    build: () => ({
      text: 'メールで問い合わせる',
      buttonMode: 'text',
      position: { x: 20, y: 80 },
      size: { width: 60, height: 13 },
      style: {
        backgroundColor: '#1e88e5',
        textColor: '#ffffff',
        borderRadius: 10,
        template: 'mail',
        fontSize: 32,
      },
      link: { type: 'mailto', email: '' },
    }),
  },
  {
    id: 'apply',
    label: '申込',
    description: '申込フォームURLを入力',
    build: () => ({
      text: '無料セミナーに申し込む',
      buttonMode: 'text',
      position: { x: 15, y: 80 },
      size: { width: 70, height: 13 },
      style: {
        backgroundColor: '#7e3ff2',
        textColor: '#ffffff',
        borderRadius: 0,
        template: 'apply',
        fontSize: 32,
      },
      link: { type: 'custom_url', url: '' },
    }),
  },
  {
    id: 'simple',
    label: 'シンプル',
    description: 'URLを入力',
    build: () => ({
      text: '詳しく見る',
      buttonMode: 'text',
      position: { x: 20, y: 80 },
      size: { width: 60, height: 13 },
      style: {
        backgroundColor: '#334155',
        textColor: '#ffffff',
        borderRadius: 10,
        template: 'simple',
        fontSize: 32,
      },
      link: { type: 'custom_url', url: '' },
    }),
  },
];

interface Props {
  disabled: boolean;
  disabledReason?: string;
  onPick: (cta: Omit<Cta, 'id'>) => void;
  label?: string;
  variant?: 'primary' | 'outline';
  alignMenu?: 'left' | 'right';
  menuPosition?: 'below' | 'above';
  size?: 'normal' | 'large';
}

export interface AddCtaMenuHandle {
  /** Open the picker popover programmatically. Used by the editor's
   *  empty-state to delegate to the header's menu instance, so the
   *  popover always anchors near the top of the modal where there's
   *  enough room to display (the center "+追加" button was getting
   *  clipped by the modal's bottom edge). */
  open(): void;
}

const AddCtaMenu = forwardRef<AddCtaMenuHandle, Props>(function AddCtaMenu(
  {
    disabled,
    disabledReason,
    onPick,
    label = '+ ボタンを追加',
    variant = 'primary',
    alignMenu = 'right',
    menuPosition = 'below',
    size = 'normal',
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [clipboard, setClipboard] = useState<ButtonClipboardEntry | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      open() {
        if (!disabled) setOpen(true);
      },
    }),
    [disabled],
  );

  // Refresh the clipboard preview every time the menu opens, and
  // listen for changes from copies that happened in this tab.
  useEffect(() => {
    if (open) setClipboard(getButtonClipboard());
    function onChange() {
      setClipboard(getButtonClipboard());
    }
    window.addEventListener('button-clipboard:change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('button-clipboard:change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function pick(preset: CtaPreset) {
    onPick(preset.build());
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={disabled ? disabledReason : 'ボタンを追加'}
        className={
          variant === 'primary'
            ? `${EDITOR_PRIMARY_BUTTON_CLASS} ${size === 'large' ? 'w-full max-w-xs min-h-14 px-6 text-base' : 'px-5'}`
            : `${EDITOR_SECONDARY_BUTTON_CLASS} min-h-10 px-3 py-2 text-xs`
        }
      >
        {label}
      </button>
      {open && !disabled && (
        <Fragment>
          <div
            className="fixed inset-0 z-30 bg-[#1f2230]/20 sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`fixed inset-x-4 bottom-4 sm:inset-x-auto sm:bottom-auto sm:absolute ${alignMenu === 'right' ? 'sm:right-0' : 'sm:left-0'} ${menuPosition === 'above' ? 'sm:bottom-full sm:mb-2' : 'sm:top-full sm:mt-2'} z-40 max-h-[70vh] overflow-auto rounded-2xl border border-[#e2e7f0] bg-white p-2 shadow-[0_20px_54px_rgba(31,34,48,0.18)] sm:max-h-[60vh] sm:w-[420px]`}
          >
            {clipboard && (
              <>
                <p className="px-2 py-1 text-xs font-extrabold text-[#687082]">
                  保存したボタン
                </p>
                <ul className="space-y-1 mb-2">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(clipboard.template);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl bg-[#eef4fb] px-3 py-3 text-left transition hover:bg-[#e3edf8]"
                    >
                      <PresetChip cta={clipboard.template as Omit<Cta, 'id'>} />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm font-extrabold text-[#3f4352]">
                          同じボタンを使う
                        </span>
                        <span className={`${EDITOR_HELP_CLASS} block truncate`}>
                          このセクションに同じボタンを追加
                        </span>
                      </span>
                    </button>
                  </li>
                </ul>
                <div className="my-2 border-t border-[#e2e7f0]" />
              </>
            )}

            <p className="px-2 py-1 text-xs font-extrabold text-[#687082]">
              画像から作る
            </p>
            <ul className="space-y-1 mb-2">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onPick({
                      text: '画像ボタン',
                      buttonMode: 'image',
                      position: { x: 20, y: 75 },
                      size: { width: 60, height: 10 },
                      style: {
                        backgroundColor: '#334155',
                        textColor: '#ffffff',
                        borderRadius: 10,
                        template: 'simple',
                      },
                      link: { type: 'custom_url', url: '' },
                    });
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-[#f8fafc]"
                >
                  <span
                    className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-dashed border-[#c8d5e8] bg-white text-xs font-extrabold text-[#8b91a1]"
                    style={{ width: '160px', height: '28px' }}
                  >
                    画像
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm font-extrabold text-[#3f4352]">
                      画像ボタンを追加
                    </span>
                  </span>
                </button>
              </li>
            </ul>
            <div className="my-2 border-t border-[#e2e7f0]" />

            <p className="px-2 py-1 text-xs font-extrabold text-[#687082]">
              ボタンプリセット
            </p>
            <ul className="space-y-1">
              {CTA_PRESETS.map((preset) => {
                const cta = preset.build();
                return (
                  <li key={preset.id}>
                    <button
                      type="button"
                      onClick={() => pick(preset)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-[#f8fafc]"
                    >
                      <PresetChip cta={cta} />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm font-extrabold text-[#3f4352]">
                          {preset.label}
                        </span>
                        <span className={`${EDITOR_HELP_CLASS} block truncate`}>
                          {preset.description}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Fragment>
      )}
    </div>
  );
});

export default AddCtaMenu;

/**
 * Small thumbnail for a CTA preset/clipboard entry. Renders
 * the same template extras as the actual button so the picker shows
 * what each preset produces. Treats the input as the full
 * Omit<Cta,'id'> so resolveCtaTemplate's signature (which expects a
 * Cta) is satisfied by a thin cast — ids aren't used by decoration.
 */
export function PresetChip({
  cta,
  size = 'default',
}: {
  cta: Omit<Cta, 'id'>;
  size?: 'default' | 'compact';
}) {
  const compact = size === 'compact';
  const chipWidth = compact ? 124 : 188;
  const chipHeight = compact ? 32 : 42;
  const buttonMode = cta.buttonMode ?? (cta.image ? 'image' : 'text');
  if (buttonMode === 'image') {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#d7deea] bg-white font-extrabold text-[#8b91a1] ${compact ? 'text-[10px]' : 'text-xs'}`}
        style={{ width: `${chipWidth}px`, height: `${chipHeight}px` }}
      >
        {cta.image ? (
          <img
            src={cta.image.url}
            alt={cta.text || '保存した画像ボタン'}
            className="h-full w-full object-contain"
          />
        ) : (
          '画像未設定'
        )}
      </span>
    );
  }

  const fakeCta = cta as unknown as Cta;
  const deco = resolveCtaTemplate(fakeCta);
  const iconDef = deco.iconLeft ? CTA_ICON_DEFINITIONS[deco.iconLeft] : undefined;
  const iconOnRight = iconDef && deco.iconPosition === 'right';
  const iconSize = Math.max(
    compact ? 10 : 12,
    Math.min(compact ? 15 : 19, cta.style.iconSize ?? deco.iconSize),
  );
  const iconSlotSize = deco.iconCircleColor
    ? Math.round(iconSize * 1.55)
    : iconSize;
  const iconPad = iconDef
    ? `${Math.round(iconSize * (deco.iconCircleColor ? 1.85 : 1.55) + (compact ? 6 : 10))}px`
    : compact
      ? '8px'
      : '10px';
  return (
    <span
      className={`shrink-0 relative inline-flex items-center justify-center font-bold whitespace-nowrap overflow-hidden ${compact ? 'text-[10px]' : 'text-xs'}`}
      style={{
        background: deco.background,
        color: cta.style.textColor,
        borderRadius: `${cta.style.borderRadius}px`,
        border: deco.borderColor
          ? `${deco.borderWidth ?? 1}px solid ${deco.borderColor}`
          : undefined,
        boxShadow: deco.boxShadow,
        width: `${chipWidth}px`,
        height: `${chipHeight}px`,
        paddingLeft: iconDef ? iconPad : '10px',
        paddingRight: iconDef ? iconPad : '10px',
      }}
    >
      {iconDef && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: iconOnRight ? undefined : compact ? 6 : 8,
            right: iconOnRight ? (compact ? 6 : 8) : undefined,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: iconSlotSize,
            height: iconSlotSize,
            borderRadius: deco.iconCircleColor ? 9999 : undefined,
            background: deco.iconCircleColor ? '#ffffff' : undefined,
            color: deco.iconCircleColor ?? 'currentColor',
            fontSize: iconSize,
            lineHeight: 0,
          }}
        >
          <FontAwesomeIcon
            icon={iconDef}
            style={{
              display: 'block',
              width: deco.iconCircleColor ? '0.78em' : '1em',
              height: deco.iconCircleColor ? '0.78em' : '1em',
            }}
          />
        </span>
      )}
      <span
        style={{
          display: 'block',
          minWidth: 0,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.1,
          textAlign: 'center',
        }}
      >
        {cta.text}
      </span>
    </span>
  );
}
