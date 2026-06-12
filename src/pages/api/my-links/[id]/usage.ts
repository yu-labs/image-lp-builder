/**
 * /api/my-links/:id/usage
 *
 * Counts active LP button references to a MyLink before deletion.
 * Deleting a MyLink does not break buttons because each CTA keeps its
 * inline URL fallback, but it does remove future bulk-update behavior.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { errors, success } from '../../../../lib/api';
import { pageQueries } from '../../../../lib/db';
import { parseContent, type CtaLink } from '../../../../lib/content';

export const prerender = false;

interface UsagePage {
  id: string;
  slug: string;
  status: string;
  count: number;
}

export const GET: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('MyLink id is required', { field: 'id' });
  }

  try {
    const totalPages = await pageQueries.countAll(env.DB, workspaceId);
    const pages = totalPages > 0
      ? await pageQueries.listAll(env.DB, workspaceId, { limit: totalPages })
      : [];

    const usagePages: UsagePage[] = [];
    let usageCount = 0;

    for (const page of pages) {
      const refs = new Set<string>();
      collectReferences(page.content, id, refs);
      if (page.live_content) collectReferences(page.live_content, id, refs);

      if (refs.size > 0) {
        usagePages.push({
          id: page.id,
          slug: page.slug,
          status: page.status,
          count: refs.size,
        });
        usageCount += refs.size;
      }
    }

    return success({
      usageCount,
      pages: usagePages,
    });
  } catch (err) {
    console.error(`GET /api/my-links/${id}/usage failed:`, err);
    return errors.internalError('Failed to count MyLink usage');
  }
};

function collectReferences(raw: string, myLinkId: string, refs: Set<string>) {
  const content = parseContent(raw);

  content.sections.forEach((section, sectionIndex) => {
    section.ctas.forEach((cta, ctaIndex) => {
      if (hasMyLink(cta.link, myLinkId)) {
        refs.add(`section:${section.id || sectionIndex}:cta:${cta.id || ctaIndex}`);
      }
    });
  });

  const floating = content.promotions?.floatingCta;
  if (floating?.enabled && hasMyLink(floating.link, myLinkId)) {
    refs.add('floating-cta');
  }
}

function hasMyLink(link: CtaLink | undefined, myLinkId: string): boolean {
  return Boolean(link && 'myLinkId' in link && link.myLinkId === myLinkId);
}
