import { randomUUID } from '../uuid';

export function generateShortPath(length = 6): string {
  const uuid = randomUUID().replace(/-/g, '');
  // Base16 chars are URL-safe — keep first N hex chars
  return uuid.slice(0, length);
}

/**
 * Generate a unique ID (used for users, pages, etc.)
 * Uses randomUUID() which is available in Cloudflare Workers.
 */
export function generateId(): string {
  return randomUUID();
}
