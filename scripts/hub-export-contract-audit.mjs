// Executable audit for the hub export contract:
// - the shared contract module accepts the shared fixture payload
// - the contract module rejects structurally broken payloads
// - the snapshot push path and the export endpoint are wired to the
//   contract validator
//
// Run via `npm run test:hub-export-contract` (uses Node's type
// stripping to import the TypeScript contract module directly).
import fs from 'node:fs';

function fail(message, details = []) {
  console.error(`Hub export contract audit failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

const { HUB_EXPORT_CONTRACT_VERSION, validateHubExportPayload } = await import(
  new URL('../src/lib/hub-export-contract.ts', import.meta.url)
);

if (HUB_EXPORT_CONTRACT_VERSION !== 1) {
  fail(
    `unexpected contract version ${HUB_EXPORT_CONTRACT_VERSION} (update this audit together with the contract)`
  );
}

const fixtureUrl = new URL(
  './fixtures/hub-export-payload.json',
  import.meta.url
);
const fixture = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'));

const accepted = validateHubExportPayload(fixture);
if (!accepted.ok) {
  fail('shared fixture payload was rejected', accepted.errors);
}
if (accepted.payload.public_url !== fixture.public_url) {
  fail('fixture public_url was not preserved by validation');
}

const brokenCases = [
  ['payload is not an object', null],
  ['page is missing', { ...fixture, page: undefined }],
  ['page.id is blank', { ...fixture, page: { ...fixture.page, id: ' ' } }],
  ['version.id is missing', { ...fixture, version: { ...fixture.version, id: undefined } }],
  ['publication is an array', { ...fixture, publication: [] }],
  ['sections is not an array', { ...fixture, sections: 'nope' }],
  ['ctas is not an array', { ...fixture, ctas: {} }],
  ['images is not an array', { ...fixture, images: 12 }],
];
for (const [label, value] of brokenCases) {
  const result = validateHubExportPayload(value);
  if (result.ok) fail(`broken payload was accepted: ${label}`);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assertIncludes(file, content, needles) {
  const missing = needles.filter((needle) => !content.includes(needle));
  if (missing.length > 0) {
    fail(`${file} is missing expected contract wiring`, missing);
  }
}

const pushFile = 'src/lib/hub-connector-snapshot-push.ts';
assertIncludes(pushFile, read(pushFile), [
  'validateHubExportPayload',
  "reason: 'contract_invalid'",
]);

const exportRouteFile = 'src/pages/api/hub/exports/[id].ts';
assertIncludes(exportRouteFile, read(exportRouteFile), [
  'validateHubExportPayload',
  'Export payload failed contract validation',
]);

console.log('Hub export contract audit passed');
