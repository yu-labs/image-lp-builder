/**
 * Get the D1 database from Astro context.
 * Usage in pages: `const db = getDB(Astro.locals.runtime.env)`
 * Usage in API: `const db = getDB(locals.runtime.env)`
 */
export function getDB(env: Env): D1Database {
  return env.DB;
}
