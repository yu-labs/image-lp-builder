import { useState } from 'react';
import { showAdminToast } from '../../lib/admin-toast';
import { notifyLpContentSaved } from '../../lib/lp-events';
import CollapseToggleIcon from './CollapseToggleIcon';
import ColorField from './ColorField';
import {
  EDITOR_DIVIDER_CLASS,
  EDITOR_FIELD_ROW_CLASS,
  EditorField,
  EditorPanel,
} from './LpEditorPrimitives';

interface Props {
  lpId: string;
  initialMaxWidth: number;
  initialBackgroundColor: string | null;
  initialFrameStyle: 'line' | 'shadow' | 'none' | null;
}

type FrameStyle = 'none' | 'line' | 'shadow';
type ApiError = { success: false; error: { code: string; message: string } };

const PILL_CLASS =
  'rounded-full bg-[#eef4fb] px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#567baf]';
const OPTION_HEADER_BUTTON_CLASS =
  'flex w-full items-center justify-between gap-3 rounded-2xl py-2 text-left transition hover:bg-[#f8fafc]';
const OPTION_HEADER_TITLE_CLASS =
  'min-w-0 text-sm font-extrabold text-[#3f4352]';
const OPTION_HEADER_DESC_CLASS =
  'mt-1 text-xs font-semibold leading-relaxed text-[#8b91a1]';
const MIN_MAX_WIDTH = 320;
const MAX_MAX_WIDTH = 1920;

export default function LpAppearancePanel({
  lpId,
  initialMaxWidth,
  initialBackgroundColor,
  initialFrameStyle,
}: Props) {
  const DEFAULT_BG = '#ffffff';
  const [maxWidthInput, setMaxWidthInput] = useState(String(initialMaxWidth));
  const [savedMaxWidth, setSavedMaxWidth] = useState(initialMaxWidth);
  const [maxWidthError, setMaxWidthError] = useState<string | null>(null);
  const [savingMaxWidth, setSavingMaxWidth] = useState(false);
  const [bgColor, setBgColor] = useState(initialBackgroundColor ?? DEFAULT_BG);
  const [savedBg, setSavedBg] = useState(initialBackgroundColor);
  const [frameStyle, setFrameStyle] = useState<FrameStyle>(
    (initialFrameStyle as FrameStyle | null) ?? 'none'
  );
  const [decorOpen, setDecorOpen] = useState(false);

  async function patch(body: object, onDone: () => void): Promise<boolean> {
    try {
      const res = await fetch(`/api/lps/${lpId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiError(res, '更新失敗'));
      notifyLpContentSaved();
      return true;
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
      return false;
    } finally {
      onDone();
    }
  }

  async function commitMaxWidth() {
    const parsed = parseMaxWidth(maxWidthInput);
    if (parsed.value === null) {
      setMaxWidthError(parsed.error);
      return;
    }
    const next = parsed.value;
    setMaxWidthInput(String(next));
    setMaxWidthError(null);
    if (next === savedMaxWidth) return;
    setSavingMaxWidth(true);
    const ok = await patch({ maxWidth: next }, () => setSavingMaxWidth(false));
    if (ok) {
      setSavedMaxWidth(next);
    }
  }

  function handleMaxWidthChange(value: string) {
    const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    setMaxWidthInput(digits);
    if (maxWidthError) setMaxWidthError(null);
  }

  function resetMaxWidthInput() {
    setMaxWidthInput(String(savedMaxWidth));
    setMaxWidthError(null);
  }

  async function commitBgColor(next: string | null) {
    const normalized = next ? next.trim().toLowerCase() : null;
    if (normalized === savedBg) return;
    if (normalized && !/^#[0-9a-f]{6}$/.test(normalized)) return;
    await patch({ backgroundColor: normalized }, () => undefined);
    setSavedBg(normalized);
  }

  async function commitFrameStyle(next: FrameStyle) {
    setFrameStyle(next);
    await patch({ frameStyle: next === 'none' ? null : next }, () => undefined);
  }

  return (
    <EditorPanel>
      <div className={EDITOR_FIELD_ROW_CLASS}>
        <EditorField
          label={
            <>
            表示幅<span className="text-[11px] font-semibold text-[#8b91a1]">（推奨500〜750）</span>
            </>
          }
          className="w-max"
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex w-[7.5rem] overflow-hidden rounded-xl border border-[#d7deea] bg-white transition focus-within:border-[#9bb4d6] focus-within:ring-2 focus-within:ring-[#d8e3f2]">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={maxWidthInput}
                onChange={(e) => handleMaxWidthChange(e.target.value)}
                onBlur={commitMaxWidth}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                  if (e.key === 'Escape') {
                    resetMaxWidthInput();
                    e.currentTarget.blur();
                  }
                }}
                aria-invalid={Boolean(maxWidthError)}
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-[#3f4352] outline-none"
              />
              <span className="flex shrink-0 items-center border-l border-[#d7deea] bg-[#f6f8fb] px-3 text-xs font-extrabold text-[#8b91a1]">
                px
              </span>
            </div>
            {savingMaxWidth && (
              <span className="text-xs font-bold text-[#8b91a1]">保存中...</span>
            )}
          </div>
          {maxWidthError && (
            <span className="text-xs font-bold text-red-600">{maxWidthError}</span>
          )}
        </EditorField>

        <EditorField
          label={
            <>
            背景色<span className="text-[11px] font-semibold text-[#8b91a1]">（PC時のLPの余白）</span>
            </>
          }
          className="w-max"
        >
          <ColorField
            value={bgColor}
            onChange={setBgColor}
            onBlur={() => commitBgColor(bgColor)}
            label="背景色"
          />
        </EditorField>
      </div>

      <div className={EDITOR_DIVIDER_CLASS}>
        <button
          type="button"
          onClick={() => setDecorOpen((v) => !v)}
          className={OPTION_HEADER_BUTTON_CLASS}
          aria-expanded={decorOpen}
        >
          <span className="min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={OPTION_HEADER_TITLE_CLASS}>コンテンツ装飾</span>
              {frameStyle !== 'none' && (
                <span className={PILL_CLASS}>
                  {frameStyle === 'line' ? 'ライン' : 'ドロップシャドウ'}
                </span>
              )}
            </span>
            <span className={OPTION_HEADER_DESC_CLASS}>
              ラインや影をつけてLPを見やすくします。
            </span>
          </span>
          <CollapseToggleIcon open={decorOpen} />
        </button>
        {decorOpen && (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 text-sm">
              {(
                [
                  { value: 'none', label: 'なし' },
                  { value: 'line', label: 'ライン' },
                  { value: 'shadow', label: 'ドロップシャドウ' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={`inline-flex cursor-pointer items-center rounded-full px-4 py-2 text-sm font-extrabold transition ${
                    frameStyle === opt.value
                      ? 'bg-[#567baf] text-white shadow-[0_10px_22px_rgba(86,123,175,0.16)]'
                      : 'bg-[#f2f4f8] text-[#596173] hover:bg-[#e9edf4]'
                  }`}
                >
                  <input
                    type="radio"
                    name="frameStyle"
                    value={opt.value}
                    checked={frameStyle === opt.value}
                    onChange={() => void commitFrameStyle(opt.value)}
                    className="sr-only"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </EditorPanel>
  );
}

function parseMaxWidth(input: string):
  | { value: number; error: null }
  | { value: null; error: string } {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: '半角数字で入力してください' };
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value)) {
    return { value: null, error: '整数で入力してください' };
  }
  if (value < MIN_MAX_WIDTH || value > MAX_MAX_WIDTH) {
    return {
      value: null,
      error: `${MIN_MAX_WIDTH}〜${MAX_MAX_WIDTH}px の範囲で入力してください`,
    };
  }
  return { value, error: null };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
