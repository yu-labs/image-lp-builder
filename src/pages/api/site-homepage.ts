/**
 * /api/site-homepage
 *
 * Site-wide root URL routing. The root path `/` is not a slug; the
 * operator can choose one currently-public LP to receive root traffic.
 * The selected page id lives in site_meta.meta so slug changes keep
 * working without another migration.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  pageQueries,
  siteMetaQueries,
  type Page,
  type PagePublicSummary,
} from '../../lib/db';
import { success, errors } from '../../lib/api';
import {
  readHomePageId,
  siteMetaJsonWithHomePageId,
} from '../../lib/site-meta';

export const prerender = false;

interface HomePageSummary {
  id: string;
  title: string | null;
  slug: string;
  status: 'published';
}

interface HomePagePayload {
  homePageId: string | null;
  homePage: HomePageSummary | null;
  homePageNeedsReview: boolean;
  publishedPages: HomePageSummary[];
}

function summarize(page: Page | PagePublicSummary): HomePageSummary {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    status: 'published',
  };
}

async function buildPayload(
  db: D1Database,
  workspaceId: string,
  homePageId: string | null
): Promise<HomePagePayload> {
  const [publishedPages, homePage] = await Promise.all([
    pageQueries.listLivePublishedSummaries(db, workspaceId),
    homePageId
      ? pageQueries.findLivePublishedById(db, workspaceId, homePageId)
      : Promise.resolve(null),
  ]);

  return {
    homePageId,
    homePage: homePage ? summarize(homePage) : null,
    homePageNeedsReview: Boolean(homePageId && !homePage),
    publishedPages: publishedPages.map(summarize),
  };
}

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  try {
    const siteMeta = await siteMetaQueries.get(env.DB, locals.workspace_id);
    const homePageId = readHomePageId(siteMeta?.meta ?? null);
    return success(
      await buildPayload(env.DB, locals.workspace_id, homePageId)
    );
  } catch (err) {
    console.error('GET /api/site-homepage failed:', err);
    return errors.internalError('Failed to read site homepage');
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Request body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Request body must be a JSON object');
  }

  const rawHomePageId = (body as { homePageId?: unknown }).homePageId;
  if (rawHomePageId !== null && typeof rawHomePageId !== 'string') {
    return errors.validationError('`homePageId` must be a string or null', {
      field: 'homePageId',
    });
  }

  const nextHomePageId =
    rawHomePageId === null ? null : rawHomePageId.trim() || null;

  if (nextHomePageId) {
    const selected = await pageQueries.findLivePublishedById(
      env.DB,
      locals.workspace_id,
      nextHomePageId
    );
    if (!selected) {
      return errors.validationError(
        'サイトトップには公開中のLPだけを選べます',
        { field: 'homePageId' }
      );
    }
  }

  try {
    const existing = await siteMetaQueries.get(env.DB, locals.workspace_id);
    const updated = await siteMetaQueries.upsert(env.DB, locals.workspace_id, {
      meta: siteMetaJsonWithHomePageId(existing?.meta ?? null, nextHomePageId),
    });
    return success(
      await buildPayload(
        env.DB,
        locals.workspace_id,
        readHomePageId(updated.meta)
      )
    );
  } catch (err) {
    console.error('PUT /api/site-homepage failed:', err);
    return errors.internalError('Failed to update site homepage');
  }
};
