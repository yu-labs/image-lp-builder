// Audits the update-source override wiring:
// - version.ts owns resolveUpdateSourceRepo (env override with a safe
//   fallback to the project repo) and the release check uses it
// - run.ts syncs from the resolved source repo, not the constant
// - repo discovery and the revert path stay pinned to the default
//   repo name (the override changes where updates come FROM, never
//   which repo the installation writes to)
import fs from 'node:fs';

function fail(message, details = []) {
  console.error(`Update source override audit failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assertIncludes(file, content, needles) {
  const missing = needles.filter((needle) => !content.includes(needle));
  if (missing.length > 0) {
    fail(`${file} is missing expected override wiring`, missing);
  }
}

function assertNotIncludes(file, content, needles) {
  const present = needles.filter((needle) => content.includes(needle));
  if (present.length > 0) {
    fail(`${file} contains forbidden override usage`, present);
  }
}

const versionFile = 'src/lib/version.ts';
const version = read(versionFile);
assertIncludes(versionFile, version, [
  'export function resolveUpdateSourceRepo(): string',
  'UPDATE_SOURCE_REPO',
  "return REPO_SLUG;",
  'const repoSlug = resolveUpdateSourceRepo();',
  'cache.repoSlug === repoSlug',
  '`https://api.github.com/repos/${repoSlug}/releases/latest`',
]);

const runFile = 'src/pages/api/admin/update/run.ts';
const run = read(runFile);
assertIncludes(runFile, run, [
  'resolveUpdateSourceRepo',
  'const sourceRepo = resolveUpdateSourceRepo();',
  'syncFromUpstream(accessToken, customerRepo, sourceRepo)',
  '`/repos/${sourceRepo}/git/ref/heads/${UPSTREAM_BRANCH}`',
  '`/repos/${sourceRepo}/git/commits/${upstreamCommitSha}`',
  '`${GH_API}/repos/${sourceRepo}/zipball/${commitSha}`',
]);
// Discovery must keep using the default repo name.
assertIncludes(runFile, run, ["const upstreamName = REPO_SLUG.split('/')[1];"]);
// No sync step may still point at the constant.
assertNotIncludes(runFile, run, [
  '`/repos/${REPO_SLUG}/git/',
  '`${GH_API}/repos/${REPO_SLUG}/zipball/',
]);

const revertFile = 'src/lib/github-revert.ts';
const revert = read(revertFile);
// The revert path only touches the customer repo; the override must
// not leak into it.
assertNotIncludes(revertFile, revert, [
  'UPDATE_SOURCE_REPO',
  'resolveUpdateSourceRepo',
]);

console.log('Update source override audit passed');
