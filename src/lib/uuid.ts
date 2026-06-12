/**
 * UUID generation that works everywhere we ship.
 *
 * `crypto.randomUUID()` is the obvious choice, but iOS Safari blocks
 * it on non-secure origins, so a focused-test session against the
 * LAN dev URL (http://192.168.x.x) hits an "is not a function" error
 * on phones. The fallback below keeps the API consistent across
 * Cloudflare Workers, modern browsers in secure contexts, and the
 * LAN dev-server case so the rest of the codebase only has to import
 * one symbol.
 *
 * The fallback isn't cryptographically secure (Math.random) and we
 * only use it for client-side ids — never for auth tokens, session
 * cookies, or anything signed. Those paths run on the Worker where
 * the native `crypto.randomUUID()` is always available.
 */
export function randomUUID(): string {
  const native = globalThis.crypto?.randomUUID;
  if (typeof native === 'function') {
    return native.call(globalThis.crypto);
  }
  return fallbackUUID();
}

/** RFC 4122 v4 compatible Math.random fallback. */
function fallbackUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
