/**
 * Site-meta resolution
 *
 * Converts the raw site_meta row into the camelCase shape consumed
 * by PublicLayout. Apple-touch-icon URL lives in the `meta` JSON
 * blob since it has no dedicated column yet (forward-compatible
 * without migrations). Returns undefined when the row is empty so
 * callers can pass it straight through.
 */

import type { SiteMeta } from './db';

export interface ResolvedSiteMeta {
  faviconUrl?: string | null;
  appleTouchIconUrl?: string | null;
  ogpDefaultImageUrl?: string | null;
  termsOfServiceUrl?: string | null;
  privacyPolicyUrl?: string | null;
  commercialTransactionUrl?: string | null;
}

export type SiteMetaJson = Record<string, unknown> & {
  appleTouchIcon?: string;
  termsOfServiceUrl?: string;
  privacyPolicyUrl?: string;
  commercialTransactionUrl?: string;
  homePageId?: string;
};

export function readSiteMetaJson(metaRaw: string | null): SiteMetaJson {
  if (!metaRaw) return {};
  try {
    const parsed = JSON.parse(metaRaw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SiteMetaJson;
    }
  } catch {
    /* ignore corrupt meta */
  }
  return {};
}

export function readHomePageId(metaRaw: string | null): string | null {
  const value = readSiteMetaJson(metaRaw).homePageId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function siteMetaJsonWithHomePageId(
  metaRaw: string | null,
  homePageId: string | null
): string {
  const meta = readSiteMetaJson(metaRaw);
  if (homePageId && homePageId.trim()) {
    meta.homePageId = homePageId.trim();
  } else {
    delete meta.homePageId;
  }
  return JSON.stringify(meta);
}

export function resolveSiteMeta(
  row: SiteMeta | null
): ResolvedSiteMeta | undefined {
  if (!row) return undefined;

  const parsedMeta = readSiteMetaJson(row.meta);

  const result: ResolvedSiteMeta = {
    faviconUrl: row.favicon_url,
    appleTouchIconUrl: parsedMeta.appleTouchIcon ?? null,
    ogpDefaultImageUrl: row.ogp_default_image_url,
    termsOfServiceUrl: parsedMeta.termsOfServiceUrl ?? null,
    privacyPolicyUrl: parsedMeta.privacyPolicyUrl ?? null,
    commercialTransactionUrl: parsedMeta.commercialTransactionUrl ?? null,
  };

  const hasAny = Object.values(result).some((v) => v && v.length > 0);
  return hasAny ? result : undefined;
}
