/**
 * CtaDecorationPanel + CtaFillSection — the "見た目を整える" controls in
 * the CTA property form: fill/gradient/radius (CtaFillSection) and the
 * collapsible icon / shadow / outline options (CtaDecorationPanel).
 * Extracted from CtaEditor; driven by { style, onPatch } props.
 */

import { useState } from 'react';
import type { Cta, CtaIconLeft, CtaIconPosition } from '../../lib/content';
import {
  CTA_ICON_LEFT_OPTIONS,
  getEffectiveDecoration,
  getTemplateBaseline,
} from '../../lib/cta-template';
import AdminSelect from './AdminSelect';
import ColorField from './ColorField';
import CollapseToggleIcon from './CollapseToggleIcon';
import {
  AdminSegmentedControl,
  AdminToggleSwitch,
  EDITOR_HELP_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_SECONDARY_BUTTON_CLASS,
  EDITOR_SUB_PANEL_CLASS,
  EditorField,
} from './LpEditorPrimitives';
import {
  ColorPickerInline,
  CtaRangeNumberField,
  NumberPickerInline,
} from './CtaInlinePickers';

const CTA_ICON_POSITION_OPTIONS: Array<{
  value: CtaIconPosition;
  label: string;
}> = [
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
];

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
export function CtaDecorationPanel({ style, onPatch }: DecorationPanelProps) {
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
export function CtaFillSection({ style, onPatch }: FillSectionProps) {
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
