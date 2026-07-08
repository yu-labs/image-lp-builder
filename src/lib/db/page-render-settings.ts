/**
 * Publication-time render settings (max_width / background_color /
 * frame_style), frozen into a publication's `meta` JSON at
 * publish/republish time so a live page's look never shifts out from
 * under visitors while the operator is mid-edit on the draft.
 *
 * Deliberately structural (not `Page`-typed): both pages.ts and
 * publications.ts need these helpers, and pages.ts already depends on
 * publications.ts (pageQueries calls publicationsQueries.findById), so
 * this module stays dependency-free to avoid a pages <-> publications
 * import cycle.
 */

interface PageRenderSettingsSource {
  max_width: number;
  background_color: string | null;
  frame_style: 'line' | 'shadow' | 'none' | null;
}

export type PageRenderSettings = {
  maxWidth: number;
  backgroundColor: string | null;
  frameStyle: 'line' | 'shadow' | null;
};

export const PUBLICATION_RENDER_SETTINGS_KEY = 'renderSettings';

export function pageRenderSettings(
  page: PageRenderSettingsSource
): PageRenderSettings {
  return {
    maxWidth: page.max_width,
    backgroundColor: page.background_color ?? null,
    frameStyle:
      page.frame_style === 'line' || page.frame_style === 'shadow'
        ? page.frame_style
        : null,
  };
}

export function parsePublicationMeta(
  metaRaw: string | null | undefined
): Record<string, unknown> {
  if (!metaRaw) return {};
  try {
    const parsed: unknown = JSON.parse(metaRaw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readPublicationRenderSettings(
  metaRaw: string | null | undefined
): PageRenderSettings | null {
  const meta = parsePublicationMeta(metaRaw);
  const raw = meta[PUBLICATION_RENDER_SETTINGS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const maxWidth = obj.maxWidth;
  if (typeof maxWidth !== 'number' || !Number.isFinite(maxWidth)) return null;
  const backgroundColor =
    typeof obj.backgroundColor === 'string' ? obj.backgroundColor : null;
  const frameStyle =
    obj.frameStyle === 'line' || obj.frameStyle === 'shadow'
      ? obj.frameStyle
      : null;
  return { maxWidth, backgroundColor, frameStyle };
}

export function publicationMetaWithRenderSettings(
  metaRaw: string | null | undefined,
  page: PageRenderSettingsSource
): string {
  return JSON.stringify({
    ...parsePublicationMeta(metaRaw),
    [PUBLICATION_RENDER_SETTINGS_KEY]: pageRenderSettings(page),
  });
}

export function applyPublishedRenderSettings<T extends PageRenderSettingsSource>(
  page: T,
  publicationMeta: string | null | undefined
): T {
  const settings = readPublicationRenderSettings(publicationMeta);
  if (!settings) return page;
  return {
    ...page,
    max_width: settings.maxWidth,
    background_color: settings.backgroundColor,
    frame_style: settings.frameStyle,
  };
}

export function sameRenderSettings(
  a: PageRenderSettings,
  b: PageRenderSettings
): boolean {
  return (
    a.maxWidth === b.maxWidth &&
    a.backgroundColor === b.backgroundColor &&
    a.frameStyle === b.frameStyle
  );
}
