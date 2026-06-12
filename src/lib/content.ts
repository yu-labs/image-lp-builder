/**
 * Page content types
 *
 * The `content` column on the `page_versions` table stores the full
 * LP layout as JSON. These types describe the shape of that JSON.
 *
 * `version` is bumped whenever the schema changes in a non-backward-compatible
 * way. A migration helper is responsible for upgrading older content to the
 * latest version on read.
 */

import { validateUrlScheme } from './url';

export const CONTENT_VERSION = 1 as const;

export type PageContent = {
  version: typeof CONTENT_VERSION;
  sections: Section[];
  /**
   * Soft-deleted sections kept around for one-click restore. Holds
   * the full section payload (image + CTAs + position) plus the
   * archive timestamp. Permanently dropped from here when the user
   * hits "完全削除" in the editor; the R2 image is deleted in the
   * same step.
   */
  archived_sections?: ArchivedSection[];
  meta?: PageMeta;
  promotions?: Promotions;
};

export type ArchivedSection = Section & {
  /** ISO 8601 datetime when the section was moved to the archive. */
  archived_at: string;
};

/**
 * Conversion-boost elements layered on top of the LP. Each field is
 * optional; absent = not configured. Each carries its own `enabled`
 * flag so the user can toggle a feature off without losing settings.
 *
 * - countdown:   sticky bar with a live countdown to a deadline
 * - scarcity:    sticky bar with a "X seats left" message
 * - floatingCta: persistent button that follows the viewport
 */
export type Promotions = {
  countdown?: Countdown;
  scarcity?: Scarcity;
  floatingCta?: FloatingCta;
};

export type StickyPosition = 'top' | 'bottom';
export type FloatingCtaPosition = StickyPosition | 'bottom-right';

/**
 * Countdown type:
 *   - absolute:               same end time for everyone (`deadline`).
 *   - per_visitor:            "X hours since this visitor first arrived"
 *                             (`durationHours`, set per-cookie).
 *   - sync_with_unpublish:    deadline tracks the LP's `unpublish_at`
 *                             so the timer stops at the same moment
 *                             the LP itself stops being viewable.
 */
export type CountdownType = 'absolute' | 'per_visitor' | 'sync_with_unpublish';

export type Countdown = {
  enabled: boolean;
  /**
   * Which timing mode this countdown uses. Optional for backward
   * compatibility with rows saved before this field existed — absent
   * = 'absolute'.
   */
  type?: CountdownType;
  /** ISO 8601 datetime — used when `type` is 'absolute' (default). */
  deadline?: string;
  /**
   * Hours of countdown counted from the visitor's first arrival.
   * Used when `type` is 'per_visitor'. 1–8760 (1 year max).
   */
  durationHours?: number;
  /** Text shown next to the timer (e.g. "募集終了まで"). */
  label?: string;
  /**
   * What to display when the deadline has passed. If empty/undefined,
   * the bar is hidden after expiry.
   */
  expiredText?: string;
  position: StickyPosition;
  /** Background color (hex). Defaults to a neutral red on the renderer. */
  backgroundColor?: string;
  /** Text color (hex). Defaults to white. */
  textColor?: string;
};

export type Scarcity = {
  enabled: boolean;
  /** Free-form message, e.g. "残り 3 席" or "あと 2 名様". */
  text: string;
  position: StickyPosition;
  backgroundColor?: string;
  textColor?: string;
  /** Font size in px. Optional for backward compatibility. */
  fontSize?: number;
};

/**
 * The floating CTA reuses the same link/style schema as in-section
 * CTAs but is rendered once per page in a fixed corner.
 */
export type FloatingCta = {
  enabled: boolean;
  buttonMode?: 'text' | 'image';
  text: string;
  link: CtaLink;
  backgroundColor?: string;
  textColor?: string;
  /** Text button font size in px. Optional for backward compatibility. */
  fontSize?: number;
  /** Last text-button label, kept when switching to image mode. */
  textButtonText?: string;
  /** Alt text used only for image button mode. */
  imageAltText?: string;
  borderRadius?: number;
  position: FloatingCtaPosition;
  /**
   * Show the floating CTA only after the visitor has scrolled this
   * percentage of the page (0-100). 0 = always visible.
   */
  showAfterScrollPercent?: number;
  /**
   * Hide the floating CTA near the bottom of the page so it does not
   * overlap a closing offer/button section.
   */
  hideNearPageEnd?: boolean;
  /**
   * Optional uploaded image used in place of the styled text button.
   * Same convention as in-section CTA images: aspect ratio is
   * preserved (`object-fit: contain`) and `text` becomes alt text.
   */
  image?: FloatingCtaImage;
  /** Pixel width override for the floating image (defaults to 180). */
  imageWidth?: number;
};

export type FloatingCtaImage = {
  url: string;
  width: number;
  height: number;
};

/**
 * Per-LP metadata that drives the public LP's <head>: page title,
 * description, OGP image (Twitter/Facebook share preview).
 *
 * All fields are optional. When omitted, sensible defaults are used
 * downstream:
 * - title: LP slug
 * - description: empty
 * - ogImage: first section image
 */
export type PageMeta = {
  title?: string;
  description?: string;
  ogImage?: string;
  // When true, the rendered LP carries
  // <meta name="robots" content="noindex,nofollow"> so search engines
  // drop it from results. Omitted remains indexable for existing LPs;
  // newly created LPs store true so campaign pages start closed to search.
  noindex?: boolean;
};

/**
 * A section is one row in the LP. Currently only image sections are
 * supported.
 */
export type Section = {
  id: string;
  type: 'image';
  image: SectionImage;
  ctas: Cta[];
  /** Human-readable label used by Connector analysis. */
  label?: string;
  /** Section role such as first_view / offer / faq. */
  role?: string;
  /** What this section is intended to do in the LP flow. */
  intent?: string;
  /** Visual description of the image for downstream analysis. */
  image_description?: string;
  /** Short summary of visible copy inside the raster image. */
  visible_copy_summary?: string;
  /** Operator notes for analysis/report generation. */
  notes_for_analysis?: string;
};

export type SectionImage = {
  url: string;
  width: number;
  height: number;
  alt?: string;
};

/**
 * A CTA is an HTML/CSS button rendered absolutely on top of a section
 * image. Position and size are stored as percentages of the section
 * dimensions so the layout stays correct on any screen width.
 */
export type Cta = {
  id: string;
  /**
   * Which visual layer is active. Omitted keeps backward compatibility:
   * image present = image button, otherwise text button.
   */
  buttonMode?: 'text' | 'image';
  text: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  style: CtaStyle;
  link: CtaLink;
  /** Human-readable label used by Connector analysis. */
  label?: string;
  /** CTA role such as primary_cv / secondary_cv / support. */
  role?: string;
  /**
   * Explicit destination category for analysis. When omitted, export
   * derives it from link.type.
   */
  destination_kind?: string;
  /** Operator notes for analysis/report generation. */
  analysis_note?: string;
  animation?: CtaAnimation;
  /**
   * Optional uploaded image to use as the CTA visual instead of the
   * styled text button. When set, the renderer draws the image inside
   * the CTA box (object-fit: contain so the original aspect ratio is
   * preserved); the `text` field falls back to alt text. Original
   * width/height are recorded so the editor can show a sensible
   * preview, but the on-screen size is still driven by `size`.
   */
  image?: CtaImage;
};

export type CtaImage = {
  url: string;
  width: number;
  height: number;
};

/**
 * Visual template the CTA inherits from. When set, the renderer
 * decorates the button with extra elements that the base CtaStyle
 * doesn't express on its own (gradient fill, left icon, arrow chip,
 * thick bottom border, white frame, etc). Per-template extras:
 *
 *   line   — vertical gradient + white circular arrow chip on the right
 *   phone  — vertical gradient pill shape + phone icon on the left
 *            + optional second line (subText) under the main label
 *   mail   — solid fill + thick darker bottom border + mail icon left
 *   apply  — horizontal gradient + white outline + square corners
 *            + play icon left
 *   simple — flat solid fill (no decoration; same as no template)
 *
 * `simple` and `undefined` behave the same so legacy CTAs keep
 * working with the flat single-color rendering.
 */
export type CtaTemplate = 'line' | 'phone' | 'mail' | 'apply' | 'simple';

export const CTA_TEMPLATES: ReadonlyArray<CtaTemplate> = [
  'line',
  'phone',
  'mail',
  'apply',
  'simple',
];

/**
 * Built-in CTA icon glyphs. `none` is the explicit "user turned the
 * icon off" sentinel — distinct from `undefined`, which means "let the
 * template decide". Without this distinction, a user who removed the
 * phone icon from a phone-template button would see it pop back the
 * next time anything else re-saved the style.
 */
export type CtaIconLeft =
  | 'phone'
  | 'mail'
  | 'arrow-play'
  | 'arrow-right'
  | 'check'
  | 'line'
  | 'instagram'
  | 'x-twitter'
  | 'facebook'
  | 'youtube'
  | 'none';

export const CTA_ICONS_LEFT: ReadonlyArray<CtaIconLeft> = [
  'none',
  'arrow-right',
  'check',
  'phone',
  'mail',
  'arrow-play',
  'line',
  'instagram',
  'x-twitter',
  'facebook',
  'youtube',
];

export type CtaIconPosition = 'left' | 'right';

export const CTA_ICON_POSITIONS: ReadonlyArray<CtaIconPosition> = [
  'left',
  'right',
];

export type CtaStyle = {
  backgroundColor: string;
  textColor: string;
  borderRadius: number;
  fontSize?: number;
  /** Optional design template. See CtaTemplate doc above for the
   *  extras each template adds. The template stays on the record as
   *  the "preset this CTA started from" label even after the user
   *  tweaks individual decoration fields below. */
  template?: CtaTemplate;
  /**
   * Secondary line of text displayed ABOVE the main label — used for
   * a brief lead-in like "今だけ特典" or for the phone number above
   * "お電話はこちら". Template-agnostic so the operator can add a
   * subtext on any template.
   */
  subText?: string;
  /** Optional anchor font-size in px for `subText`. Same clamp/cqw
   *  scaling shape as `fontSize`; default anchor = 36 (≈ 1.3× of the
   *  28 px main-text default, preserving the old visual balance). */
  subTextFontSize?: number;
  /** Optional colour for `subText`. Falls back to textColor when unset. */
  subTextColor?: string;

  /*
   * Decoration override fields. Each is `undefined` to mean "use the
   * template's default" — so legacy CTAs that only have `template`
   * still render correctly. When the user toggles a decoration in
   * the editor, the explicit value lands here and overrides the
   * template default.
   *
   * Booleans are tri-state: undefined = template default,
   * true / false = explicit user choice.
   */

  /** Whether the background is a solid color or a gradient. undefined
   *  means "use the template default" (LINE / 電話 / 申込 = gradient,
   *  メール / シンプル = solid). In gradient mode, `backgroundColor`
   *  doubles as the gradient *start* color — there's no separate
   *  start field so the operator only edits one anchor. */
  fill?: 'solid' | 'gradient';
  /** Gradient end color override. undefined = auto-lighten
   *  backgroundColor (matches the template default). */
  gradientEndColor?: string;
  /** Gradient angle in degrees. 0 = bottom→top, 90 = left→right,
   *  180 = top→bottom, 270 = right→left. undefined = template
   *  default (vertical for LINE / 電話 / メール, horizontal for 申込). */
  gradientAngle?: number;

  /** Icon glyph or explicit `none` to remove the icon. */
  iconLeft?: CtaIconLeft;

  /** Icon placement. undefined = template default. */
  iconPosition?: CtaIconPosition;

  /** Icon size in px. undefined = template default. */
  iconSize?: number;

  /** White circular icon background. undefined = template default. */
  iconCircle?: boolean;

  /** Legacy right-side white circular arrow chip (LINE template default). */
  arrowChip?: boolean;

  /** Outer drop shadow toggle. */
  shadow?: boolean;
  /** Drop shadow vertical offset in px. undefined = template default. */
  shadowY?: number;
  /** Drop shadow blur radius in px. undefined = template default. */
  shadowBlur?: number;
  /** Drop shadow color (hex, no alpha — alpha is set separately via
   *  shadowOpacity so the operator's color picker stays simple). */
  shadowColor?: string;
  /** Drop shadow opacity, 0–1. undefined = template default. */
  shadowOpacity?: number;

  /** Full outline frame around the button (apply template default). */
  outline?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
};

/**
 * Looping CSS animations applied to the CTA on the public LP.
 * - none: no animation (default)
 * - pulse: gentle scale pulse, draws the eye
 * - shake: short horizontal shake
 * - bounce: vertical bounce
 * - glow: soft glow halo
 * - fade: legacy key; renders as a moving shine highlight
 */
export type CtaAnimation = 'none' | 'pulse' | 'shake' | 'bounce' | 'glow' | 'fade';

export const CTA_ANIMATIONS: ReadonlyArray<CtaAnimation> = [
  'none',
  'pulse',
  'shake',
  'bounce',
  'glow',
  'fade',
];

/**
 * `myLinkId` (optional, URL-based types only) makes the CTA reference
 * a MyLink record by id; the renderer resolves the actual URL at
 * render time. Editing the MyLink updates every CTA that references
 * it. When `myLinkId` is set, the inline `url` is kept as a fallback
 * (used if the MyLink was deleted) but the resolved value wins.
 */
export type CtaLink =
  | { type: 'line_friend'; url: string; myLinkId?: string }
  | { type: 'custom_url'; url: string; myLinkId?: string }
  | { type: 'webhook'; url: string; apiKey?: string; tag: string; myLinkId?: string }
  | { type: 'tel'; number: string }
  | { type: 'mailto'; email: string };

/**
 * Fallback empty LP content when stored JSON is missing or malformed.
 */
export function createEmptyContent(): PageContent {
  return {
    version: CONTENT_VERSION,
    sections: [],
  };
}

/**
 * Parse a JSON string from a `page_versions.content` column.
 *
 * Returns `createEmptyContent()` if the value is missing, malformed,
 * or not an object. We intentionally don't deep-validate every field
 * here — runtime validation belongs in API handlers that accept user
 * input. This parser only protects rendering code from crashing on
 * unexpected DB content.
 */
export function parseContent(raw: string | null | undefined): PageContent {
  if (!raw) return createEmptyContent();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as PageContent).sections)
    ) {
      return parsed as PageContent;
    }
  } catch {
    // fall through to empty
  }

  return createEmptyContent();
}

/**
 * Validate user-provided content (e.g. from PUT /api/lps/:id).
 *
 * Returns either the validated content or a list of error messages
 * with dotted paths so the client can surface them to the user.
 *
 * This is a *structural* check, not a semantic one. It guards against
 * obviously malformed input but does not, for example, verify that
 * image URLs point to actual images or that hex colors are well-formed.
 * Those checks belong in higher-level UI validation if needed.
 */
export type ValidationResult =
  | { ok: true; content: PageContent }
  | { ok: false; errors: string[] };

export function validateContentInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['コンテンツの形式が不正です(オブジェクトを指定してください)'] };
  }

  const obj = input as Record<string, unknown>;

  if (obj.version !== CONTENT_VERSION) {
    errors.push(`コンテンツのバージョンは ${CONTENT_VERSION} を指定してください`);
  }

  if (!Array.isArray(obj.sections)) {
    return {
      ok: false,
      errors: [...errors, 'セクション一覧の形式が不正です(配列を指定してください)'],
    };
  }

  obj.sections.forEach((section, i) => {
    validateSection(section, `セクション${i + 1}`, errors);
  });

  if (obj.archived_sections !== undefined) {
    if (!Array.isArray(obj.archived_sections)) {
      errors.push('削除済みセクションの形式が不正です(配列を指定してください)');
    } else {
      obj.archived_sections.forEach((entry, i) => {
        const label = `削除済みセクション${i + 1}`;
        validateSection(entry, label, errors);
        if (
          typeof entry !== 'object' ||
          entry === null ||
          typeof (entry as { archived_at?: unknown }).archived_at !== 'string'
        ) {
          errors.push(`${label}: 削除日時(ISO 形式の日時文字列)が必要です`);
        }
      });
    }
  }

  if (obj.meta !== undefined) {
    validateMeta(obj.meta, 'content.meta', errors);
  }

  if (obj.promotions !== undefined) {
    validatePromotions(obj.promotions, 'content.promotions', errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, content: input as PageContent };
}

const STICKY_POSITIONS: ReadonlyArray<StickyPosition> = ['top', 'bottom'];
const FLOATING_CTA_POSITIONS: ReadonlyArray<FloatingCtaPosition> = [
  'top',
  'bottom',
  'bottom-right',
];

// Validation patterns for CTA link.tel / link.mailto. Kept lenient on
// purpose: the goal is to block obviously-broken values (full-width
// digits, missing @) before they make it into a `tel:` / `mailto:`
// link, not to enforce RFC compliance.
const TEL_PATTERN = /^[+\d\s().-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECTION_METADATA_STRING_KEYS = [
  'label',
  'role',
  'intent',
  'image_description',
  'visible_copy_summary',
  'notes_for_analysis',
] as const;
const CTA_METADATA_STRING_KEYS = [
  'label',
  'role',
  'destination_kind',
  'analysis_note',
] as const;

function validatePromotions(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です(オブジェクトを指定してください)`);
    return;
  }
  const p = input as Record<string, unknown>;
  if (p.countdown !== undefined)
    validateCountdown(p.countdown, 'カウントダウン', errors);
  if (p.scarcity !== undefined)
    validateScarcity(p.scarcity, '残数バー', errors);
  if (p.floatingCta !== undefined)
    validateFloatingCta(p.floatingCta, 'フローティング CTA', errors);
}

const COUNTDOWN_TYPES: ReadonlyArray<CountdownType> = [
  'absolute',
  'per_visitor',
  'sync_with_unpublish',
];

function validateCountdown(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const c = input as Record<string, unknown>;
  if (typeof c.enabled !== 'boolean') {
    errors.push(`${path}: 有効/無効の設定が不正です`);
  }
  const type: CountdownType =
    typeof c.type === 'string' && COUNTDOWN_TYPES.includes(c.type as CountdownType)
      ? (c.type as CountdownType)
      : 'absolute';
  if (c.type !== undefined && !COUNTDOWN_TYPES.includes(c.type as CountdownType)) {
    errors.push(
      `${path}: 種類は ${COUNTDOWN_TYPES.join(' / ')} のいずれかを指定してください`
    );
  }
  if (type === 'absolute') {
    if (typeof c.deadline !== 'string' || c.deadline.length === 0) {
      errors.push(`${path}: 終了日時を指定してください`);
    } else if (Number.isNaN(new Date(c.deadline).getTime())) {
      errors.push(`${path}: 終了日時の形式が不正です`);
    }
  }
  if (type === 'per_visitor') {
    if (
      typeof c.durationHours !== 'number' ||
      !Number.isFinite(c.durationHours) ||
      c.durationHours <= 0 ||
      c.durationHours > 8760
    ) {
      errors.push(
        `${path}: カウントダウン時間は 1〜8760 時間(最長 1 年)の範囲で指定してください`
      );
    }
  }
  if (c.label !== undefined && typeof c.label !== 'string') {
    errors.push(`${path}: ラベルは文字列で指定してください`);
  }
  if (c.expiredText !== undefined && typeof c.expiredText !== 'string') {
    errors.push(`${path}: 終了後の表示テキストは文字列で指定してください`);
  }
  if (typeof c.position !== 'string' || !STICKY_POSITIONS.includes(c.position as StickyPosition)) {
    errors.push(`${path}: 表示位置は「上」または「下」を指定してください`);
  }
  validateOptionalColor(c.backgroundColor, `${path}: 背景色`, errors);
  validateOptionalColor(c.textColor, `${path}: 文字色`, errors);
}

function validateScarcity(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const s = input as Record<string, unknown>;
  if (typeof s.enabled !== 'boolean') {
    errors.push(`${path}: 有効/無効の設定が不正です`);
  }
  if (typeof s.text !== 'string' || s.text.length === 0) {
    errors.push(`${path}: 表示テキストを入力してください`);
  }
  if (typeof s.position !== 'string' || !STICKY_POSITIONS.includes(s.position as StickyPosition)) {
    errors.push(`${path}: 表示位置は「上」または「下」を指定してください`);
  }
  validateOptionalColor(s.backgroundColor, `${path}: 背景色`, errors);
  validateOptionalColor(s.textColor, `${path}: 文字色`, errors);
  if (s.fontSize !== undefined && (typeof s.fontSize !== 'number' || s.fontSize <= 0)) {
    errors.push(`${path}: フォントサイズは 1 以上の数値で指定してください`);
  }
}

function validateFloatingCta(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const f = input as Record<string, unknown>;
  if (typeof f.enabled !== 'boolean') {
    errors.push(`${path}: 有効/無効の設定が不正です`);
  }
  if (
    f.buttonMode !== undefined &&
    f.buttonMode !== 'text' &&
    f.buttonMode !== 'image'
  ) {
    errors.push(`${path}: ボタン形式は「通常」または「画像」を指定してください`);
  }
  if (
    f.enabled === true &&
    (typeof f.text !== 'string' || f.text.length === 0)
  ) {
    errors.push(`${path}: ボタンの文言を入力してください`);
  }
  if (f.textButtonText !== undefined && typeof f.textButtonText !== 'string') {
    errors.push(`${path}: 通常ボタン文言は文字列で指定してください`);
  }
  if (f.imageAltText !== undefined && typeof f.imageAltText !== 'string') {
    errors.push(`${path}: 画像の代替テキストは文字列で指定してください`);
  }
  if (
    typeof f.position !== 'string' ||
    !FLOATING_CTA_POSITIONS.includes(f.position as FloatingCtaPosition)
  ) {
    errors.push(`${path}: 表示位置は「上」「下」「右下」のいずれかを指定してください`);
  }
  validateOptionalColor(f.backgroundColor, `${path}: 背景色`, errors);
  validateOptionalColor(f.textColor, `${path}: 文字色`, errors);
  if (f.fontSize !== undefined && (typeof f.fontSize !== 'number' || f.fontSize <= 0)) {
    errors.push(`${path}: フォントサイズは 1 以上の数値で指定してください`);
  }
  if (
    f.borderRadius !== undefined &&
    (typeof f.borderRadius !== 'number' || f.borderRadius < 0)
  ) {
    errors.push(`${path}: 角丸は 0 以上の数値で指定してください`);
  }
  if (f.showAfterScrollPercent !== undefined) {
    if (
      typeof f.showAfterScrollPercent !== 'number' ||
      f.showAfterScrollPercent < 0 ||
      f.showAfterScrollPercent > 100
    ) {
      errors.push(
        `${path}: 表示タイミング(スクロール率)は 0〜100 の数値で指定してください`
      );
    }
  }
  if (
    f.hideNearPageEnd !== undefined &&
    typeof f.hideNearPageEnd !== 'boolean'
  ) {
    errors.push(`${path}: ページ下部で非表示の設定が不正です`);
  }
  if (f.enabled === true) {
    validateCtaLink(f.link, `${path}: リンク`, errors);
  }

  if (f.image !== undefined) {
    validateCtaImage(f.image, `${path}: 画像`, errors);
  }
  if (f.imageWidth !== undefined) {
    if (
      typeof f.imageWidth !== 'number' ||
      !Number.isFinite(f.imageWidth) ||
      f.imageWidth < 72 ||
      f.imageWidth > 320
    ) {
      errors.push(
        `${path}: 画像の幅は 72〜320 px の数値で指定してください`
      );
    }
  }
}

function validateOptionalColor(input: unknown, path: string, errors: string[]): void {
  if (input === undefined) return;
  if (typeof input !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(input)) {
    errors.push(`${path}: 16進数のカラーコード(例: #ffffff)で指定してください`);
  }
}

function validateMeta(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const m = input as Record<string, unknown>;
  const labels: Record<string, string> = {
    title: 'タイトル',
    description: '説明文',
    ogImage: 'OGP 画像',
  };
  for (const key of ['title', 'description', 'ogImage'] as const) {
    if (m[key] !== undefined && typeof m[key] !== 'string') {
      errors.push(`${path}: ${labels[key]} は文字列で指定してください`);
    }
  }
}

function validateSection(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const s = input as Record<string, unknown>;

  if (typeof s.id !== 'string' || s.id.length === 0) {
    errors.push(`${path}: ID が必要です`);
  }
  if (s.type !== 'image') {
    errors.push(`${path}: セクション種別は「image」のみ対応しています`);
  }

  validateImage(s.image, `${path}: 画像`, errors);
  validateOptionalStringFields(s, SECTION_METADATA_STRING_KEYS, path, errors);

  if (!Array.isArray(s.ctas)) {
    errors.push(`${path}: ボタン一覧の形式が不正です`);
  } else {
    s.ctas.forEach((cta, i) => {
      validateCta(cta, `${path} > ボタン${i + 1}`, errors);
    });
  }
}

function validateImage(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const img = input as Record<string, unknown>;

  if (typeof img.url !== 'string' || img.url.length === 0) {
    errors.push(`${path}: 画像 URL が必要です`);
  }
  if (typeof img.width !== 'number' || img.width <= 0) {
    errors.push(`${path}: 画像の幅(数値)が必要です`);
  }
  if (typeof img.height !== 'number' || img.height <= 0) {
    errors.push(`${path}: 画像の高さ(数値)が必要です`);
  }
  if (img.alt !== undefined && typeof img.alt !== 'string') {
    errors.push(`${path}: 代替テキスト(alt)は文字列で指定してください`);
  }
}

function validateCta(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const c = input as Record<string, unknown>;

  if (typeof c.id !== 'string' || c.id.length === 0) {
    errors.push(`${path}: ID が必要です`);
  }
  if (typeof c.text !== 'string') {
    errors.push(`${path}: 文言は文字列で指定してください`);
  }
  if (
    c.buttonMode !== undefined &&
    c.buttonMode !== 'text' &&
    c.buttonMode !== 'image'
  ) {
    errors.push(`${path}: ボタン表示タイプは text / image のいずれかを指定してください`);
  }

  validatePercentPair(c.position, `${path}: 位置`, ['x', 'y'], errors);
  validatePercentPair(c.size, `${path}: サイズ`, ['width', 'height'], errors);
  validateCtaStyle(c.style, `${path}: スタイル`, errors);
  validateCtaLink(c.link, `${path}: リンク`, errors);
  validateOptionalStringFields(c, CTA_METADATA_STRING_KEYS, path, errors);

  if (
    c.animation !== undefined &&
    !CTA_ANIMATIONS.includes(c.animation as CtaAnimation)
  ) {
    errors.push(
      `${path}: アニメーションは ${CTA_ANIMATIONS.join(' / ')} のいずれかを指定してください`
    );
  }

  if (c.image !== undefined) {
    validateCtaImage(c.image, `${path}: 画像`, errors);
  }
}

function validateOptionalStringFields(
  input: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  errors: string[]
): void {
  for (const key of keys) {
    if (input[key] !== undefined && typeof input[key] !== 'string') {
      errors.push(`${path}: ${key} は文字列で指定してください`);
    }
  }
}

function validateCtaImage(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const img = input as Record<string, unknown>;
  if (typeof img.url !== 'string' || img.url.length === 0) {
    errors.push(`${path}: 画像 URL が必要です`);
  }
  if (typeof img.width !== 'number' || img.width <= 0) {
    errors.push(`${path}: 画像の幅(数値)が必要です`);
  }
  if (typeof img.height !== 'number' || img.height <= 0) {
    errors.push(`${path}: 画像の高さ(数値)が必要です`);
  }
}

function validatePercentPair(
  input: unknown,
  path: string,
  keys: [string, string],
  errors: string[]
): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const labels: Record<string, string> = {
    x: '横',
    y: '縦',
    width: '幅',
    height: '高さ',
  };
  const obj = input as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      errors.push(`${path}: ${labels[key] ?? key} は 0〜100 の数値で指定してください`);
    }
  }
}

function validateCtaStyle(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const s = input as Record<string, unknown>;
  if (typeof s.backgroundColor !== 'string') {
    errors.push(`${path}: 背景色を指定してください`);
  }
  if (typeof s.textColor !== 'string') {
    errors.push(`${path}: 文字色を指定してください`);
  }
  if (typeof s.borderRadius !== 'number' || s.borderRadius < 0) {
    errors.push(`${path}: 角丸は 0 以上の数値で指定してください`);
  }
  if (s.fontSize !== undefined && (typeof s.fontSize !== 'number' || s.fontSize <= 0)) {
    errors.push(`${path}: フォントサイズは 1 以上の数値で指定してください`);
  }
  if (
    s.subTextFontSize !== undefined &&
    (typeof s.subTextFontSize !== 'number' || s.subTextFontSize <= 0)
  ) {
    errors.push(`${path}: サブテキストのフォントサイズは 1 以上の数値で指定してください`);
  }
  if (s.subTextColor !== undefined && typeof s.subTextColor !== 'string') {
    errors.push(`${path}: サブテキストの文字色は文字列で指定してください`);
  }
  if (
    s.template !== undefined &&
    !(CTA_TEMPLATES as readonly string[]).includes(s.template as string)
  ) {
    errors.push(`${path}: テンプレートが不正です`);
  }
  if (s.subText !== undefined && typeof s.subText !== 'string') {
    errors.push(`${path}: サブテキストは文字列で指定してください`);
  }
  // Decoration overrides — all optional, all narrow types.
  for (const key of ['arrowChip', 'shadow', 'outline'] as const) {
    if (s[key] !== undefined && typeof s[key] !== 'boolean') {
      errors.push(`${path}: ${key} は true/false で指定してください`);
    }
  }
  for (const key of [
    'gradientEndColor',
    'outlineColor',
    'shadowColor',
  ] as const) {
    if (s[key] !== undefined && typeof s[key] !== 'string') {
      errors.push(`${path}: ${key} は文字列で指定してください`);
    }
  }
  for (const key of ['outlineWidth', 'shadowBlur'] as const) {
    if (s[key] !== undefined && (typeof s[key] !== 'number' || (s[key] as number) < 0)) {
      errors.push(`${path}: ${key} は 0 以上の数値で指定してください`);
    }
  }
  if (
    s.shadowY !== undefined &&
    (typeof s.shadowY !== 'number' || !Number.isFinite(s.shadowY))
  ) {
    errors.push(`${path}: shadowY は数値で指定してください`);
  }
  if (
    s.shadowOpacity !== undefined &&
    (typeof s.shadowOpacity !== 'number' ||
      s.shadowOpacity < 0 ||
      s.shadowOpacity > 1)
  ) {
    errors.push(`${path}: shadowOpacity は 0〜1 の数値で指定してください`);
  }
  if (
    s.gradientAngle !== undefined &&
    (typeof s.gradientAngle !== 'number' || !Number.isFinite(s.gradientAngle))
  ) {
    errors.push(`${path}: gradientAngle は数値で指定してください`);
  }
  if (s.fill !== undefined && s.fill !== 'solid' && s.fill !== 'gradient') {
    errors.push(`${path}: fill は solid または gradient で指定してください`);
  }
  if (
    s.iconLeft !== undefined &&
    !(CTA_ICONS_LEFT as readonly string[]).includes(s.iconLeft as string)
  ) {
    errors.push(`${path}: iconLeft が不正です`);
  }
  if (
    s.iconPosition !== undefined &&
    !(CTA_ICON_POSITIONS as readonly string[]).includes(s.iconPosition as string)
  ) {
    errors.push(`${path}: iconPosition が不正です`);
  }
  if (
    s.iconSize !== undefined &&
    (typeof s.iconSize !== 'number' || !Number.isFinite(s.iconSize) || s.iconSize < 8)
  ) {
    errors.push(`${path}: iconSize は 8 以上の数値で指定してください`);
  }
  if (s.iconCircle !== undefined && typeof s.iconCircle !== 'boolean') {
    errors.push(`${path}: iconCircle は true/false で指定してください`);
  }
}

function validateCtaLink(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push(`${path}: 形式が不正です`);
    return;
  }
  const link = input as Record<string, unknown>;

  switch (link.type) {
    case 'line_friend':
      if (typeof link.url !== 'string' || link.url.length === 0) {
        errors.push(`${path}: LINE 友だち追加 URL を入力してください`);
      } else {
        const schemeError = validateUrlScheme(link.url, { kind: 'absolute' });
        if (schemeError) errors.push(`${path}: ${schemeError}`);
      }
      break;
    case 'custom_url':
      if (typeof link.url !== 'string' || link.url.length === 0) {
        errors.push(`${path}: リンク先 URL を入力してください`);
      } else {
        const schemeError = validateUrlScheme(link.url, {
          kind: typeof link.myLinkId === 'string' ? 'relative-or-absolute' : 'absolute',
        });
        if (schemeError) errors.push(`${path}: ${schemeError}`);
      }
      break;
    case 'webhook':
      if (typeof link.url !== 'string' || link.url.length === 0) {
        errors.push(`${path}: Webhook URL を入力してください`);
      } else {
        const schemeError = validateUrlScheme(link.url, { kind: 'absolute' });
        if (schemeError) errors.push(`${path}: ${schemeError}`);
      }
      if (typeof link.tag !== 'string' || link.tag.length === 0) {
        errors.push(`${path}: Webhook のタグを入力してください`);
      }
      break;
    case 'tel':
      if (typeof link.number !== 'string' || link.number.length === 0) {
        errors.push(`${path}: 電話番号を入力してください`);
      } else if (!TEL_PATTERN.test(link.number)) {
        // Phone-number rules vary by country, but every dialer accepts
        // ASCII digits with optional `+`, hyphens, parentheses, and
        // spaces. Reject anything else (IME-inserted full-width digits
        // are the most common offender) so the resulting `tel:` URL
        // actually opens.
        errors.push(
          `${path}: 電話番号は半角数字と + ( ) - のみ使用できます`,
        );
      }
      break;
    case 'mailto':
      if (typeof link.email !== 'string' || link.email.length === 0) {
        errors.push(`${path}: メールアドレスを入力してください`);
      } else if (!EMAIL_PATTERN.test(link.email)) {
        // We're not aiming for full RFC 5322 compliance — just enough
        // to catch obvious typos before the visitor hits a broken
        // mailto link.
        errors.push(`${path}: メールアドレスの形式が不正です`);
      }
      break;
    default:
      errors.push(
        `${path}: リンク先の種類が不正です(LINE / URL / 電話 / メール / Webhook のいずれか)`
      );
  }
}
