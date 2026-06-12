import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { CURRENT_VERSION } from '../../../lib/version';

export const prerender = false;

const ALLOWED_EVENT_TYPES = new Set([
  'provider_link_impression',
  'provider_link_click',
  'managed_admin_cta_impression',
  'managed_admin_cta_click',
]);
const FORWARD_TIMEOUT_MS = 1500;

function isValidHttpsUrl(url: string | null | undefined): url is string {
  if (!url || !url.startsWith('https://')) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function normalizeOccurredAt(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date().toISOString();
}

export const POST: APIRoute = async ({ request }) => {
  const typedEnv = env as Env;
  const instanceId = typedEnv.MANAGED_PROVIDER_INSTANCE_ID;
  const endpoint = typedEnv.MANAGED_PROVIDER_USAGE_ENDPOINT;

  if (!instanceId || !isValidHttpsUrl(endpoint)) {
    return new Response(null, { status: 204 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  if (typeof body !== 'object' || body === null) {
    return new Response(null, { status: 204 });
  }

  const { event_type, occurred_at } = body as Record<string, unknown>;

  if (typeof event_type !== 'string' || !ALLOWED_EVENT_TYPES.has(event_type)) {
    return new Response(null, { status: 204 });
  }

  const payload = {
    instance_id: instanceId,
    app_version: CURRENT_VERSION,
    event_type,
    occurred_at: normalizeOccurredAt(occurred_at),
  };

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
  } catch {
    // Usage forwarding is non-critical; admin UI must not fail on forwarding errors.
  }

  return new Response(null, { status: 204 });
};
