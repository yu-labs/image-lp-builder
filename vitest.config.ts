import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit-test config for pure logic in `src/lib`. Tests run in a plain
 * Node environment — they cover framework-free functions (validation,
 * parsing, comparisons), not Astro routes or Worker bindings.
 *
 * `cloudflare:workers` only resolves inside the Workers runtime, so it
 * is aliased to a mutable stub (test/mocks/cloudflare-workers.ts) that
 * lets tests set the bindings a module reads.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./test/mocks/cloudflare-workers.ts', import.meta.url)
      ),
    },
  },
});
