import fs from 'node:fs';

function fail(message, details = []) {
  console.error(`Hub Connector sync contract audit failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assertIncludes(file, content, needles) {
  const missing = needles.filter((needle) => !content.includes(needle));
  if (missing.length > 0) {
    fail(`${file} is missing expected sync contract text`, missing);
  }
}

function assertNotIncludes(file, content, needles) {
  const present = needles.filter((needle) => content.includes(needle));
  if (present.length > 0) {
    fail(`${file} contains forbidden sync contract text`, present);
  }
}

const bulkApiFile = 'src/pages/api/hub-connector/sync-published.ts';
const singleApiFile = 'src/pages/api/lps/[id]/hub-connector/snapshot.ts';
const pushFile = 'src/lib/hub-connector-snapshot-push.ts';
const panelFile = 'src/components/admin/HubConnectorPanel.tsx';

const bulkApi = read(bulkApiFile);
const singleApi = read(singleApiFile);
const push = read(pushFile);
const panel = read(panelFile);

assertIncludes(bulkApiFile, bulkApi, [
  'POST /api/hub-connector/sync-published',
  'republishes an LP',
  'pageQueries.listLivePublishedSummaries',
  'pushHubConnectorSnapshot',
  "status: 'synced'",
  "status: 'failed'",
]);

assertNotIncludes(bulkApiFile, bulkApi, [
  'pageQueries.publish(',
  'pageQueries.republish(',
  'published_version_id =',
  'latest_publication_id =',
  'INSERT INTO publications',
]);

assertIncludes(singleApiFile, singleApi, [
  'POST /api/lps/:id/hub-connector/snapshot',
  'currently-published export payload',
  'no publish/republish event will fire',
]);

assertIncludes(pushFile, push, [
  'buildHubExportPayload',
  'core_lp_id',
  'export_payload',
  '/snapshots',
]);

assertNotIncludes(pushFile, push, [
  'readLpHubConnectorEnabled',
  'lp_disabled',
]);

assertIncludes(panelFile, panel, [
  '/api/hub-connector/sync-published',
  '全公開LPをConnectorへ同期',
  '公開中のLPをConnectorへ送ります。LP本文や公開状態は変更されません。',
  '既存の公開LPを同期',
]);

console.log('Hub Connector sync contract audit passed.');
