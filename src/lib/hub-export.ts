import {
  myLinkQueries,
  pageQueries,
  pageVersionsQueries,
  publicationsQueries,
  siteMetaQueries,
} from './db';
import {
  parseContent,
  type Cta,
  type CtaLink,
  type PageContent,
  type Section,
} from './content';
import { buildPublicUrl, resolvePublicHost } from './canonical';

export interface HubExportPayload {
  page: Record<string, unknown>;
  version: Record<string, unknown>;
  publication: Record<string, unknown>;
  sections: unknown[];
  ctas: unknown[];
  images: unknown[];
  public_url: string;
}

export type HubExportPayloadResult =
  | { ok: true; value: HubExportPayload }
  | { ok: false; message: string };

const SECTION_METADATA_KEYS = [
  'label',
  'role',
  'intent',
  'image_description',
  'visible_copy_summary',
  'notes_for_analysis',
] as const;

const CTA_METADATA_KEYS = [
  'label',
  'role',
  'destination_kind',
  'analysis_note',
] as const;

type ExportCta = Cta & {
  section_id: string;
  section_index: number;
  cta_index: number;
  destination_kind: string;
  destination_url?: string;
};

type ExportSection = Section & {
  section_index: number;
  ctas: ExportCta[];
};

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pickCleanStrings<T extends Record<string, unknown>>(
  source: T,
  keys: readonly string[]
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of keys) {
    const value = cleanString(source[key]);
    if (value) picked[key] = value;
  }
  return picked;
}

function dropBlankStringKeys(
  target: Record<string, unknown>,
  keys: readonly string[]
): void {
  for (const key of keys) {
    if (target[key] !== undefined && !cleanString(target[key])) {
      delete target[key];
    }
  }
}

function fallbackDestinationKind(link: CtaLink): string {
  switch (link.type) {
    case 'line_friend':
      return 'line';
    case 'custom_url':
      return 'url';
    case 'webhook':
      return 'webhook';
    case 'tel':
      return 'tel';
    case 'mailto':
      return 'mailto';
  }
}

function resolveUrlWithMyLink(
  link: { url: string; myLinkId?: string },
  myLinkUrls: Map<string, string>
): string | undefined {
  if (link.myLinkId) {
    const resolved = cleanString(myLinkUrls.get(link.myLinkId));
    if (resolved) return resolved;
  }
  return cleanString(link.url);
}

function resolveDestinationUrl(
  link: CtaLink,
  myLinkUrls: Map<string, string>
): string | undefined {
  switch (link.type) {
    case 'line_friend':
    case 'custom_url':
    case 'webhook':
      return resolveUrlWithMyLink(link, myLinkUrls);
    case 'tel': {
      const number = cleanString(link.number);
      return number ? `tel:${number}` : undefined;
    }
    case 'mailto': {
      const email = cleanString(link.email);
      return email ? `mailto:${email}` : undefined;
    }
  }
}

function buildExportCta(
  cta: Cta,
  section: Section,
  sectionIndex: number,
  ctaIndex: number,
  myLinkUrls: Map<string, string>
): ExportCta {
  const explicitKind = cleanString(cta.destination_kind);
  const destinationUrl = resolveDestinationUrl(cta.link, myLinkUrls);
  const exportCta: ExportCta = {
    ...cta,
    ...pickCleanStrings(cta as unknown as Record<string, unknown>, CTA_METADATA_KEYS),
    section_id: section.id,
    section_index: sectionIndex,
    cta_index: ctaIndex,
    destination_kind: explicitKind ?? fallbackDestinationKind(cta.link),
  };
  if (destinationUrl) exportCta.destination_url = destinationUrl;
  dropBlankStringKeys(exportCta as unknown as Record<string, unknown>, [
    ...CTA_METADATA_KEYS,
    'destination_url',
  ]);
  return exportCta;
}

export function buildExportSectionsForContent(
  content: PageContent,
  myLinkUrls: Map<string, string> = new Map()
): { sections: ExportSection[]; ctas: ExportCta[] } {
  const sourceSections = content.sections ?? [];
  const sections: ExportSection[] = sourceSections.map((section, sectionIndex) => {
    const ctas = (section.ctas ?? []).map((cta, ctaIndex) =>
      buildExportCta(cta, section, sectionIndex, ctaIndex, myLinkUrls)
    );
    const exportSection: ExportSection = {
      ...section,
      ...pickCleanStrings(
        section as unknown as Record<string, unknown>,
        SECTION_METADATA_KEYS
      ),
      section_index: sectionIndex,
      ctas,
    };
    dropBlankStringKeys(
      exportSection as unknown as Record<string, unknown>,
      SECTION_METADATA_KEYS
    );
    return exportSection;
  });
  const ctas = sections.flatMap((section) => section.ctas);
  return { sections, ctas };
}

export async function buildHubExportPayload(params: {
  db: D1Database;
  workspaceId: string;
  lpId: string;
  requestUrl: URL;
}): Promise<HubExportPayloadResult> {
  const page = await pageQueries.findById(
    params.db,
    params.workspaceId,
    params.lpId
  );
  if (!page) return { ok: false, message: `LP \`${params.lpId}\` not found` };

  if (
    page.status !== 'published' ||
    !page.published_version_id ||
    !page.latest_publication_id
  ) {
    return {
      ok: false,
      message: `LP \`${params.lpId}\` has no currently-published version to export`,
    };
  }

  const version = await pageVersionsQueries.findById(
    params.db,
    params.workspaceId,
    page.published_version_id
  );
  if (!version || version.status !== 'published_snapshot') {
    return {
      ok: false,
      message: `LP \`${params.lpId}\` published snapshot is missing or not finalized`,
    };
  }

  const publication = await publicationsQueries.findById(
    params.db,
    params.workspaceId,
    page.latest_publication_id
  );
  if (!publication || publication.status !== 'active') {
    return {
      ok: false,
      message: `LP \`${params.lpId}\` has no active publication`,
    };
  }

  const content = parseContent(version.content);
  const siteMetaRow = await siteMetaQueries.get(params.db, params.workspaceId);
  const publicHost = resolvePublicHost(params.requestUrl, siteMetaRow);
  const public_url = buildPublicUrl(publicHost, `/${page.slug}`);
  const myLinks = await myLinkQueries.list(params.db, params.workspaceId);
  const myLinkUrls = new Map(myLinks.map((link) => [link.id, link.url]));

  const { sections, ctas } = buildExportSectionsForContent(content, myLinkUrls);

  type ExportImage = {
    url: string;
    width: number | null;
    height: number | null;
    alt: string | null;
    public_url: string;
  };
  const imageMap = new Map<string, ExportImage>();
  const addImage = (
    url: string | undefined | null,
    width: number | null,
    height: number | null,
    alt: string | null
  ) => {
    if (!url || imageMap.has(url)) return;
    imageMap.set(url, { url, width, height, alt, public_url: url });
  };

  for (const section of sections) {
    if (section.image?.url) {
      addImage(
        section.image.url,
        section.image.width ?? null,
        section.image.height ?? null,
        section.image.alt ?? null
      );
    }
    for (const cta of section.ctas ?? []) {
      if (cta.image?.url) {
        addImage(
          cta.image.url,
          cta.image.width ?? null,
          cta.image.height ?? null,
          null
        );
      }
    }
  }

  const floating = content.promotions?.floatingCta;
  if (floating?.image?.url) {
    addImage(
      floating.image.url,
      floating.image.width ?? null,
      floating.image.height ?? null,
      null
    );
  }
  if (content.meta?.ogImage) {
    addImage(content.meta.ogImage, null, null, null);
  }

  return {
    ok: true,
    value: {
      page: {
        id: page.id,
        workspace_id: page.workspace_id,
        slug: page.slug,
        title: page.title,
        status: page.status,
        max_width: page.max_width,
        background_color: page.background_color,
        frame_style: page.frame_style,
        custom_domain: page.custom_domain,
        meta: page.meta,
        published_at: page.published_at,
        created_at: page.created_at,
        updated_at: page.updated_at,
      },
      version: {
        id: version.id,
        page_id: version.page_id,
        workspace_id: version.workspace_id,
        version_number: version.version_number,
        status: version.status,
        source: version.source,
        base_version_id: version.base_version_id,
        base_publication_id: version.base_publication_id,
        label: version.label,
        content_hash: version.content_hash,
        created_at: version.created_at,
        updated_at: version.updated_at,
      },
      publication: {
        id: publication.id,
        page_id: publication.page_id,
        workspace_id: publication.workspace_id,
        version_id: publication.version_id,
        status: publication.status,
        source: publication.source,
        label: publication.label,
        meta: publication.meta,
        published_at: publication.published_at,
        unpublished_at: publication.unpublished_at,
      },
      sections,
      ctas,
      images: Array.from(imageMap.values()),
      public_url,
    },
  };
}
