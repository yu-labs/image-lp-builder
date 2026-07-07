/**
 * Test stand-in for the `cloudflare:workers` module, which only exists
 * inside the Workers runtime. vitest aliases `cloudflare:workers` to
 * this file (see vitest.config.ts) so modules that read runtime
 * bindings can be unit-tested off-Worker.
 *
 * `env` is a plain mutable object. Tests set the bindings they need
 * (e.g. `env.UPDATE_SOURCE_REPO = 'owner/name'`) and reset with
 * `resetEnv()` in an afterEach.
 */
export const env: Record<string, unknown> = {};

export function resetEnv(): void {
  for (const key of Object.keys(env)) delete env[key];
}
