#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

function fail(message, details = []) {
  console.error(`Domain public-host contract audit failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

function assertIncludes(file, needle) {
  const text = read(file);
  if (!text.includes(needle)) {
    fail(`${file} is missing expected public-host contract text`, [needle]);
  }
}

function assertNotIncludes(file, needle) {
  const text = read(file);
  if (text.includes(needle)) {
    fail(`${file} still contains derived lp. host logic`, [needle]);
  }
}

const migration = 'migrations/0003_site_domain_public_host.sql';
if (!existsSync(path.join(root, migration))) {
  fail('migration for old bare-domain rows is missing', [migration]);
}

assertIncludes(
  migration,
  "INSERT INTO schema_migrations (version) VALUES ('0003_site_domain_public_host')"
);
assertIncludes(migration, "domain = 'lp.' || domain");

assertIncludes('src/lib/migrations.ts', "version: '0003_site_domain_public_host'");
assertIncludes('src/lib/migrations.ts', 'migration0003');

assertIncludes('src/pages/api/site-domain.ts', 'const probeUrl = `https://${domain}/`;');
assertNotIncludes('src/pages/api/site-domain.ts', 'value = value.slice(3)');
assertNotIncludes('src/pages/api/site-domain.ts', 'lp.{domain}');
assertNotIncludes('src/pages/api/site-domain.ts', '「lp.」');

assertIncludes('src/lib/canonical.ts', 'host: domain');
assertNotIncludes('src/lib/canonical.ts', 'host: `lp.${domain}`');

assertIncludes('src/lib/admin-public-url.ts', 'return domain ? `https://${domain}` : fallback;');
assertNotIncludes('src/lib/admin-public-url.ts', 'https://lp.${domain}');

assertIncludes('src/middleware.ts', 'Location: `https://${targetDomain}${pathname}${url.search}`');
assertNotIncludes('src/middleware.ts', 'https://lp.${targetDomain}');

assertNotIncludes('src/components/admin/DomainSettingsPanel.tsx', 'displayLpHost');
assertNotIncludes('src/components/admin/DomainSettingsPanel.tsx', 'lp.{modal.domain}');
assertNotIncludes('src/components/admin/DomainSettingsPanel.tsx', 'https://lp.{cleaned}');
assertNotIncludes('src/components/admin/DomainSettingsPanel.tsx', 'lp.{modal.cleaned}');
assertNotIncludes('src/components/admin/DomainSettingsPanel.tsx', '「lp.」');
assertIncludes(
  'src/components/admin/DomainSettingsPanel.tsx',
  'if (preview.validationError) return;'
);
assertIncludes(
  'src/components/admin/DomainSettingsPanel.tsx',
  'if (!probe.validationError && probe.cleaned !== raw.toLowerCase())'
);

assertIncludes(
  'src/pages/admin/lps/[id]/preview/mock.astro',
  '? `https://${siteMeta.domain.trim()}`'
);
assertNotIncludes(
  'src/pages/admin/lps/[id]/preview/mock.astro',
  '? `https://lp.${siteMeta.domain.trim()}`'
);

console.log('Domain public-host contract audit passed.');
