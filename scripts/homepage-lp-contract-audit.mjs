#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function fail(message, details = []) {
  console.error(`Homepage LP contract audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(file) {
  return readFileSync(file, 'utf8');
}

function assertIncludes(file, snippet) {
  const text = read(file);
  if (!text.includes(snippet)) {
    fail(`${file} is missing required snippet`, [snippet]);
  }
}

function assertNotIncludes(file, snippet) {
  const text = read(file);
  if (text.includes(snippet)) {
    fail(`${file} contains forbidden snippet`, [snippet]);
  }
}

assertIncludes('src/pages/index.astro', 'readHomePageId');
assertIncludes('src/pages/index.astro', 'findLivePublishedById');
assertIncludes('src/pages/index.astro', 'Astro.redirect(`/${homePage.slug}${Astro.url.search}`, 302)');
assertIncludes('src/pages/index.astro', "Astro.redirect('/admin', 302)");

assertIncludes('src/pages/api/site-homepage.ts', 'siteMetaJsonWithHomePageId');
assertIncludes('src/pages/api/site-homepage.ts', 'listLivePublishedSummaries');
assertIncludes('src/pages/api/site-homepage.ts', 'findLivePublishedById');
assertIncludes('src/pages/api/site-homepage.ts', 'サイトトップには公開中のLPだけを選べます');

assertIncludes('src/lib/site-meta.ts', 'homePageId?: string');
assertIncludes('src/lib/site-meta.ts', 'readHomePageId');
assertIncludes('src/lib/site-meta.ts', 'siteMetaJsonWithHomePageId');

assertIncludes('src/components/admin/SiteSettingsHub.tsx', "'home-page'");
assertIncludes('src/components/admin/SiteSettingsHub.tsx', 'HomePageSettingsPanel');
assertIncludes('src/components/admin/SiteSettingsHub.tsx', 'サイトトップ');
assertIncludes('src/components/admin/SiteSettingsHub.tsx', '公開URLの / から開くLP');
assertIncludes('src/components/admin/HomePageSettingsPanel.tsx', '未設定（/admin へ移動）');
assertIncludes('src/components/admin/HomePageSettingsPanel.tsx', '/ は選択LPへ移動する入口です。');
assertIncludes('src/components/admin/HomePageSettingsPanel.tsx', '公開URLの / にアクセスされた時に開くLPを選びます。');
assertIncludes('src/components/admin/HomePageSettingsPanel.tsx', '公開URL');
assertIncludes('src/components/admin/HomePageSettingsPanel.tsx', 'サイトトップで開くLP');
assertIncludes('src/components/admin/HomePageSettingsPanel.tsx', 'href={rootUrl}');
assertNotIncludes('src/components/admin/HomePageSettingsPanel.tsx', "fetch('/api/site-domain')");
assertNotIncludes('src/components/admin/HomePageSettingsPanel.tsx', 'この画面で確認するURL');
assertNotIncludes('src/components/admin/HomePageSettingsPanel.tsx', '本番のトップURL');
assertNotIncludes('src/components/admin/HomePageSettingsPanel.tsx', 'ローカル確認中');
assertNotIncludes('src/components/admin/HomePageSettingsPanel.tsx', '再読み込み');

assertNotIncludes('src/lib/slugs.ts', 'SLUG_MIN_LENGTH = 0');

console.log('Homepage LP contract audit passed');
