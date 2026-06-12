/**
 * Visual decoration rules for the five built-in CTA templates.
 *
 * Both the public renderer (LPRenderer.astro) and the editor preview
 * (CtaEditor.tsx CtaHandle) pull from this single source so the two
 * stay in lockstep — change a template's gradient or icon here and
 * both surfaces update.
 *
 * Two-layer model:
 *   1. **Template baseline** — each template (LINE / phone / mail /
 *      apply / simple) declares a set of default decoration values
 *      via TEMPLATE_BASELINES. Picking a preset gets you this look
 *      without storing any override on the CTA.
 *   2. **User overrides** — optional fields on CtaStyle (gradient,
 *      iconLeft, iconPosition, iconCircle, shadow, outline*) that
 *      win over the baseline when set. Undefined = "use template
 *      default". This keeps existing data working (template-only
 *      CTAs) and lets the property form expose every knob without
 *      schema churn down the road.
 *
 * resolveCtaTemplate() merges (1) and (2) into a final
 * CtaTemplateDecoration the renderer consumes.
 */

import {
  faArrowRight,
  faCheck,
  faEnvelope,
  faPhone,
  faPlay,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import {
  faFacebookF,
  faInstagram,
  faLine,
  faXTwitter,
  faYoutube,
} from '@fortawesome/free-brands-svg-icons';
import type {
  Cta,
  CtaIconLeft,
  CtaIconPosition,
  CtaStyle,
  CtaTemplate,
} from './content';

export interface CtaTemplateDecoration {
  /** Full `background` CSS value, ready to drop into inline style. */
  background: string;
  /** Outline color and width when the template renders a visible
   *  outline frame around the button. */
  borderColor?: string;
  borderWidth?: number;
  /** Outer drop shadow declaration. */
  boxShadow?: string;
  /** Built-in icon — the renderer maps this to a FontAwesome SVG. */
  iconLeft?: Exclude<CtaIconLeft, 'none'>;
  /** Icon placement. */
  iconPosition: CtaIconPosition;
  /** Icon size in px before responsive scaling. */
  iconSize: number;
  /** White circular chip behind the icon. Value is the icon color. */
  iconCircleColor?: string;
  /** When true, the renderer keeps the icon area visually balanced
   *  by treating padding as symmetric. */
  symmetricPadding?: boolean;
}

/**
 * Per-template defaults. Every template provides a value for every
 * decoration switch, even when it's "off" — that way the property
 * form can show the user "what this template gives you by default"
 * and the resolver has a complete fallback when no override is set.
 *
 * `fill` is the baseline "background style": solid color vs. linear
 * gradient. `gradientAngle` is the baseline angle (0 = bottom→top
 * for LINE / 電話, 90 = left→right for 申込). `gradientLightenAmount`
 * is how much to lift the base color when the user hasn't picked an
 * explicit end color — so a stronger value gives 申込 its colourful
 * end, a milder one gives LINE / 電話 their subtle highlight.
 *
 * Drop shadow is decomposed into four primitives (Y / blur / color /
 * opacity) so the property form can expose each independently. The
 * optional `shadowInsetCss` is the template's "lit from above" inset
 * highlight — non-editable, attaches automatically when shadow is on
 * and clears when shadow is off (LINE / 電話 baseline only).
 */
export interface TemplateBaseline {
  fill: 'solid' | 'gradient';
  gradientAngle: number;
  gradientLightenAmount: number;
  iconLeft: CtaIconLeft;
  iconPosition: CtaIconPosition;
  iconSize: number;
  iconCircle: boolean;
  shadow: boolean;
  shadowY: number;
  shadowBlur: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowInsetCss?: string;
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
  symmetricPadding: boolean;
}

const LINE_INSET = 'inset 0 1px 1px rgba(255,255,255,0.6)';
const PHONE_INSET = 'inset 0 1px 1px rgba(255,255,255,0.5)';

export const TEMPLATE_BASELINES: Record<CtaTemplate, TemplateBaseline> = {
  line: {
    fill: 'gradient',
    gradientAngle: 0,
    gradientLightenAmount: 0.18,
    iconLeft: 'arrow-right',
    iconPosition: 'right',
    iconSize: 22,
    iconCircle: true,
    shadow: true,
    shadowY: 5,
    shadowBlur: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowInsetCss: LINE_INSET,
    outline: false,
    outlineColor: '#ffffff',
    outlineWidth: 2,
    symmetricPadding: false,
  },
  phone: {
    fill: 'gradient',
    gradientAngle: 0,
    gradientLightenAmount: 0.18,
    iconLeft: 'phone',
    iconPosition: 'left',
    iconSize: 22,
    iconCircle: false,
    shadow: true,
    shadowY: 5,
    shadowBlur: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowInsetCss: PHONE_INSET,
    outline: false,
    outlineColor: '#ffffff',
    outlineWidth: 2,
    symmetricPadding: true,
  },
  mail: {
    fill: 'solid',
    gradientAngle: 0,
    gradientLightenAmount: 0.18,
    iconLeft: 'mail',
    iconPosition: 'left',
    iconSize: 22,
    iconCircle: false,
    // Beefier drop shadow stands in for the old thick-bottom-border
    // depth: bigger Y offset + zero blur gives a clean "raised
    // platform" feel without the colored band that didn't blend well.
    shadow: true,
    shadowY: 6,
    shadowBlur: 0,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    outline: false,
    outlineColor: '#ffffff',
    outlineWidth: 2,
    symmetricPadding: true,
  },
  apply: {
    fill: 'gradient',
    gradientAngle: 90,
    gradientLightenAmount: 0.5,
    iconLeft: 'arrow-play',
    iconPosition: 'left',
    iconSize: 22,
    iconCircle: false,
    shadow: true,
    shadowY: 5,
    shadowBlur: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    outline: true,
    outlineColor: '#ffffff',
    outlineWidth: 2,
    symmetricPadding: true,
  },
  simple: {
    fill: 'solid',
    gradientAngle: 0,
    gradientLightenAmount: 0.18,
    iconLeft: 'none',
    iconPosition: 'left',
    iconSize: 22,
    iconCircle: false,
    shadow: false,
    shadowY: 5,
    shadowBlur: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    outline: false,
    outlineColor: '#ffffff',
    outlineWidth: 2,
    symmetricPadding: false,
  },
};

/** Public helper — template-or-undefined to its baseline. `simple`
 *  is the safe fallback for unknown / undefined templates. */
export function getTemplateBaseline(
  tpl: CtaTemplate | undefined,
): TemplateBaseline {
  return TEMPLATE_BASELINES[tpl ?? 'simple'];
}

/**
 * Effective decoration values for a style (user override > template
 * baseline). Exposed for the property form so the UI can show the
 * currently-effective state of each toggle without re-implementing
 * the merge rule.
 */
export interface EffectiveDecoration {
  fill: 'solid' | 'gradient';
  /** Resolved gradient end color (= auto-lightened backgroundColor
   *  when no override). Always a concrete color string. The start
   *  color is always backgroundColor — no separate field. */
  gradientEndColor: string;
  /** Gradient angle in degrees, 0 = bottom→top. */
  gradientAngle: number;
  iconLeft: CtaIconLeft;
  iconPosition: CtaIconPosition;
  iconSize: number;
  iconCircle: boolean;
  shadow: boolean;
  shadowY: number;
  shadowBlur: number;
  shadowColor: string;
  shadowOpacity: number;
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
}

export function getEffectiveDecoration(style: CtaStyle): EffectiveDecoration {
  const base = style.backgroundColor;
  const baseline = getTemplateBaseline(style.template);
  return {
    fill: style.fill ?? baseline.fill,
    gradientEndColor:
      style.gradientEndColor ?? lighten(base, baseline.gradientLightenAmount),
    gradientAngle: style.gradientAngle ?? baseline.gradientAngle,
    iconLeft: style.iconLeft ?? baseline.iconLeft,
    iconPosition: style.iconPosition ?? baseline.iconPosition,
    iconSize: style.iconSize ?? baseline.iconSize,
    iconCircle: style.iconCircle ?? style.arrowChip ?? baseline.iconCircle,
    shadow: style.shadow ?? baseline.shadow,
    shadowY: style.shadowY ?? baseline.shadowY,
    shadowBlur: style.shadowBlur ?? baseline.shadowBlur,
    shadowColor: style.shadowColor ?? baseline.shadowColor,
    shadowOpacity: style.shadowOpacity ?? baseline.shadowOpacity,
    outline: style.outline ?? baseline.outline,
    outlineColor: style.outlineColor ?? baseline.outlineColor,
    outlineWidth: style.outlineWidth ?? baseline.outlineWidth,
  };
}

/**
 * Resolve the decoration set for a CTA. Returns a falsy-ish default
 * when nothing decorates the button — callers can treat that as
 * "flat, use the base style as-is".
 */
export function resolveCtaTemplate(cta: Cta): CtaTemplateDecoration {
  const s = cta.style;
  const base = s.backgroundColor;
  const baseline = getTemplateBaseline(s.template);
  const eff = getEffectiveDecoration(s);

  const background =
    eff.fill === 'gradient'
      ? `linear-gradient(${eff.gradientAngle}deg, ${base}, ${eff.gradientEndColor})`
      : base;

  // Compose `box-shadow` from the user-editable primitives. When the
  // template has a signature inset highlight (LINE / 電話), prepend
  // it so flipping shadow off cleanly removes the whole stack.
  const dropShadow = `0 ${eff.shadowY}px ${eff.shadowBlur}px ${hexToRgba(eff.shadowColor, eff.shadowOpacity)}`;
  const shadowCss = baseline.shadowInsetCss
    ? `${baseline.shadowInsetCss}, ${dropShadow}`
    : dropShadow;

  return {
    background,
    boxShadow: eff.shadow ? shadowCss : undefined,
    iconLeft: eff.iconLeft !== 'none' ? eff.iconLeft : undefined,
    iconPosition: eff.iconPosition,
    iconSize: eff.iconSize,
    iconCircleColor:
      eff.iconLeft !== 'none' && eff.iconCircle ? base : undefined,
    borderColor: eff.outline ? eff.outlineColor : undefined,
    borderWidth: eff.outline ? eff.outlineWidth : undefined,
    symmetricPadding: baseline.symmetricPadding,
  };
}

/**
 * Best-effort hex/short-hex/rgb mixer. Falls back to the input
 * string when it can't parse, so the templates degrade to flat fill
 * instead of breaking.
 */
function lighten(input: string, amount: number): string {
  const rgb = parseColor(input);
  if (!rgb) return input;
  const [r, g, b] = rgb;
  return rgbHex(
    Math.round(r + (255 - r) * amount),
    Math.round(g + (255 - g) * amount),
    Math.round(b + (255 - b) * amount),
  );
}

function parseColor(input: string): [number, number, number] | null {
  const s = input.trim();
  // #rgb / #rrggbb
  const hex = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  // rgb(...) / rgba(...)
  const rgb = s.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1]!.split(',').map((p) => Number(p.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [parts[0]!, parts[1]!, parts[2]!] as [number, number, number];
    }
  }
  return null;
}

function rgbHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Combine a hex color and an alpha 0–1 into a CSS `rgba(...)`
 *  string. Falls back to the input + comma + alpha if the hex can't
 *  be parsed, so callers never see `NaN` in the rendered CSS. */
function hexToRgba(hex: string, alpha: number): string {
  const rgb = parseColor(hex);
  const a = Math.max(0, Math.min(1, alpha));
  if (!rgb) return `rgba(0,0,0,${a})`;
  const [r, g, b] = rgb;
  return `rgba(${r},${g},${b},${a})`;
}

export interface CtaIconSvg {
  width: number;
  height: number;
  path: string;
}

function solidIcon(def: IconDefinition): CtaIconSvg {
  const [width, height, , , pathData] = def.icon;
  return {
    width,
    height,
    path: Array.isArray(pathData) ? pathData.join(' ') : pathData,
  };
}

export const CTA_ICON_DEFINITIONS: Record<
  Exclude<CtaIconLeft, 'none'>,
  IconDefinition
> = {
  phone: faPhone,
  mail: faEnvelope,
  'arrow-play': faPlay,
  'arrow-right': faArrowRight,
  check: faCheck,
  line: faLine,
  instagram: faInstagram,
  'x-twitter': faXTwitter,
  facebook: faFacebookF,
  youtube: faYoutube,
};

/** FontAwesome SVG data used by the public LP and editor preview. */
export const CTA_ICON_SVGS: Record<
  Exclude<CtaIconLeft, 'none'>,
  CtaIconSvg
> = {
  phone: solidIcon(CTA_ICON_DEFINITIONS.phone),
  mail: solidIcon(CTA_ICON_DEFINITIONS.mail),
  'arrow-play': solidIcon(CTA_ICON_DEFINITIONS['arrow-play']),
  'arrow-right': solidIcon(CTA_ICON_DEFINITIONS['arrow-right']),
  check: solidIcon(CTA_ICON_DEFINITIONS.check),
  line: solidIcon(CTA_ICON_DEFINITIONS.line),
  instagram: solidIcon(CTA_ICON_DEFINITIONS.instagram),
  'x-twitter': solidIcon(CTA_ICON_DEFINITIONS['x-twitter']),
  facebook: solidIcon(CTA_ICON_DEFINITIONS.facebook),
  youtube: solidIcon(CTA_ICON_DEFINITIONS.youtube),
};

/** True when the user's style explicitly opts into a template. */
export function hasTemplate(style: CtaStyle): boolean {
  return !!style.template && style.template !== 'simple';
}

/** All built-in templates exposed for the picker UI. */
export const CTA_TEMPLATE_OPTIONS: ReadonlyArray<{
  id: CtaTemplate;
  label: string;
}> = [
  { id: 'line', label: '角丸グラデーション' },
  { id: 'phone', label: '全角丸グラデーション' },
  { id: 'mail', label: '下影フラット' },
  { id: 'apply', label: '白枠グラデーション' },
  { id: 'simple', label: '単色フラット' },
];

/** Labels for the icon-left picker in the property form. */
export const CTA_ICON_LEFT_OPTIONS: ReadonlyArray<{
  id: CtaIconLeft;
  label: string;
}> = [
  { id: 'none', label: 'なし' },
  { id: 'arrow-right', label: '矢印' },
  { id: 'check', label: 'チェック' },
  { id: 'phone', label: '電話' },
  { id: 'mail', label: 'メール' },
  { id: 'arrow-play', label: '再生' },
  { id: 'line', label: 'LINE' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'x-twitter', label: 'X' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube' },
];

/**
 * Key list of all decoration override fields on CtaStyle. The
 * property form uses this to wipe overrides en-masse when the
 * operator switches template — "give me the new template's look"
 * needs all explicit overrides to fall away.
 */
export const CTA_DECORATION_OVERRIDE_KEYS = [
  'fill',
  'gradientEndColor',
  'gradientAngle',
  'iconLeft',
  'iconPosition',
  'iconSize',
  'iconCircle',
  'arrowChip',
  'shadow',
  'shadowY',
  'shadowBlur',
  'shadowColor',
  'shadowOpacity',
  'outline',
  'outlineColor',
  'outlineWidth',
] as const satisfies ReadonlyArray<keyof CtaStyle>;
