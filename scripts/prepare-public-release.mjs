#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const BOT_NAME = 'yulab-bot';
const BOT_EMAIL = '282944904+yulab-bot@users.noreply.github.com';
const PUSH_CONFIRM = 'yulab-bot-noreply-initial-commit-only';
const FORBIDDEN_HISTORY_PATTERNS = [
  [/@gmail\.com/i, 'Gmail address'],
];
const FORBIDDEN_HISTORY_TOKEN_HASHES = new Set([
  '94e43058fe0a30b2a59121625b9831328e6687fd6efcae8fc3a3a3835b3fa700',
  '1780bc79db2c9f8f4a2cda1f308c956bb1c63294d0ad4f7cf61048fc5bff27de',
  'e9c18239063b448ccc1439763d4fac2095e847ddb51174846c9ad04a34798d73',
  '5c3a711e46fa087852d0f1f986f34335e6eb282e3cef4703b44dff8f4f98c97e',
]);

function hashIdentityToken(value) {
  return createHash('sha256').update(value.toLowerCase()).digest('hex');
}

function containsForbiddenIdentityToken(text) {
  const tokens = text.toLowerCase().match(/[a-z0-9._%+-]+/g) ?? [];
  return tokens.some((token) =>
    FORBIDDEN_HISTORY_TOKEN_HASHES.has(hashIdentityToken(token))
  );
}

function fail(message, details = []) {
  console.error(`Public release preparation failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    sourceRef: 'HEAD',
    outDir: '',
    remote: '',
    githubRepo: '',
    push: false,
    allowDirty: false,
    skipOriginCheck: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (!argv[index]) fail(`missing value for ${arg}`);
      return argv[index];
    };

    if (arg === '--') continue;
    else if (arg === '--source-ref') parsed.sourceRef = next();
    else if (arg === '--out-dir') parsed.outDir = next();
    else if (arg === '--remote') parsed.remote = next();
    else if (arg === '--github-repo') parsed.githubRepo = next();
    else if (arg === '--push') parsed.push = true;
    else if (arg === '--allow-dirty') parsed.allowDirty = true;
    else if (arg === '--skip-origin-check') parsed.skipOriginCheck = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      fail(`unknown argument ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage:
  pnpm run prepare:public-release -- [options]

Options:
  --source-ref <ref>       Source commit to export. Default: HEAD
  --out-dir <path>         Output directory. Default: /private/tmp/image-lp-builder-public-release-<short-sha>
  --remote <url>           Git remote to add as origin in the generated repo
  --github-repo <owner/repo>
                           GitHub repo to verify after --push. Required with --push
  --push                   Push main to origin. Requires an empty remote and:
                           ILPB_PUBLIC_RELEASE_CONFIRM=${PUSH_CONFIRM}
  --allow-dirty            Allow a dirty source worktree. Never use with --push
  --skip-origin-check      Do not require source commit to match origin/main.
                           Dry-run only; cannot be used with --push
`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runText(command, args, cwd) {
  return run(command, args, { cwd, encoding: 'utf8' }).trim();
}

function ensureSourceClean(root, { allowDirty, push }) {
  const dirty = runText('git', ['status', '--porcelain'], root);
  if (!dirty) return;
  if (allowDirty && !push) {
    console.warn('Source worktree is dirty; only committed files are exported.');
    return;
  }
  fail('source worktree is dirty', dirty.split('\n'));
}

function ensureOriginMainMatches(root, sourceCommit, skipOriginCheck) {
  if (skipOriginCheck) return;
  try {
    const originMain = runText('git', ['rev-parse', 'origin/main^{commit}'], root);
    if (originMain !== sourceCommit) {
      fail('source commit does not match origin/main', [
        `source: ${sourceCommit}`,
        `origin/main: ${originMain}`,
      ]);
    }
  } catch {
    fail('origin/main could not be resolved; use --skip-origin-check only for local dry-runs');
  }
}

function defaultOutDir(sourceCommit) {
  return `/private/tmp/image-lp-builder-public-release-${sourceCommit.slice(0, 7)}`;
}

function ensureFreshOutDir(outDir) {
  if (existsSync(outDir)) {
    const stat = statSync(outDir);
    if (!stat.isDirectory()) fail('output path exists and is not a directory', [outDir]);
    fail('output directory already exists; choose a new --out-dir', [outDir]);
  }
  mkdirSync(outDir, { recursive: true });
}

function copyTrackedFiles(root, sourceCommit, outDir) {
  const files = runText('git', ['ls-tree', '-r', '--name-only', sourceCommit], root)
    .split('\n')
    .filter(Boolean);

  for (const file of files) {
    if (file.includes('/.git/') || file === '.git') {
      fail('git metadata appeared in tracked file list', [file]);
    }
    const body = execFileSync('git', ['show', `${sourceCommit}:${file}`], {
      cwd: root,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const target = path.join(outDir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }

  return files;
}

function verifyNoGitMetadata(outDir) {
  if (existsSync(path.join(outDir, '.git'))) {
    fail('output directory contains .git before initialization');
  }
}

function commitCleanRepo(outDir) {
  run('git', ['init', '-b', 'main'], { cwd: outDir, stdio: 'inherit' });
  run('git', ['config', 'user.name', BOT_NAME], { cwd: outDir });
  run('git', ['config', 'user.email', BOT_EMAIL], { cwd: outDir });
  run('git', ['add', '-A'], { cwd: outDir });
  run(
    'git',
    ['commit', '-m', 'Initial commit'],
    {
      cwd: outDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: BOT_NAME,
        GIT_AUTHOR_EMAIL: BOT_EMAIL,
        GIT_COMMITTER_NAME: BOT_NAME,
        GIT_COMMITTER_EMAIL: BOT_EMAIL,
      },
      stdio: 'inherit',
    }
  );
}

function verifyCommit(outDir, expectedFileCount) {
  const count = Number(runText('git', ['rev-list', '--count', 'HEAD'], outDir));
  if (count !== 1) fail('generated repo must have exactly one commit', [`found ${count}`]);

  const fields = runText(
    'git',
    ['show', '--no-patch', '--format=%H%n%an%n%ae%n%cn%n%ce', 'HEAD'],
    outDir
  ).split('\n');
  const [sha, authorName, authorEmail, committerName, committerEmail] = fields;
  const problems = [];
  if (authorName !== BOT_NAME) problems.push(`author name: ${authorName}`);
  if (authorEmail !== BOT_EMAIL) problems.push(`author email: ${authorEmail}`);
  if (committerName !== BOT_NAME) problems.push(`committer name: ${committerName}`);
  if (committerEmail !== BOT_EMAIL) problems.push(`committer email: ${committerEmail}`);
  if (problems.length > 0) fail('generated commit is not yulab-bot noreply only', problems);

  const history = runText('git', ['log', '--format=fuller'], outDir);
  const forbidden = FORBIDDEN_HISTORY_PATTERNS
    .filter(([pattern]) => pattern.test(history))
    .map(([, label]) => label);
  if (containsForbiddenIdentityToken(history)) {
    forbidden.push('blocked identity token');
  }
  if (forbidden.length > 0) fail('forbidden identity text found in generated git history', forbidden);

  const dirty = runText('git', ['status', '--porcelain'], outDir);
  if (dirty) fail('generated repo has uncommitted changes', dirty.split('\n'));

  const tracked = Number(runText('git', ['ls-files'], outDir).split('\n').filter(Boolean).length);
  if (tracked !== expectedFileCount) {
    fail('generated tracked file count changed unexpectedly', [
      `expected ${expectedFileCount}`,
      `found ${tracked}`,
    ]);
  }

  return sha;
}

function runPublicAudit(outDir) {
  run('node', ['scripts/public-snapshot-audit.mjs'], {
    cwd: outDir,
    stdio: 'inherit',
  });
}

function addRemote(outDir, remote) {
  if (!remote) return;
  run('git', ['remote', 'add', 'origin', remote], { cwd: outDir });
}

function ensurePushIsExplicit({ push, remote, githubRepo, skipOriginCheck }) {
  if (!push) return;
  if (!remote) fail('--push requires --remote');
  if (!githubRepo) {
    fail('--push requires --github-repo so GitHub commit metadata is verified');
  }
  if (skipOriginCheck) {
    fail('--push cannot be used with --skip-origin-check');
  }
  if (process.env.ILPB_PUBLIC_RELEASE_CONFIRM !== PUSH_CONFIRM) {
    fail('push confirmation env var is missing', [
      `set ILPB_PUBLIC_RELEASE_CONFIRM=${PUSH_CONFIRM}`,
    ]);
  }
}

function ensureRemoteIsEmpty(outDir) {
  let refs = '';
  try {
    refs = runText('git', ['ls-remote', '--heads', 'origin'], outDir);
  } catch (err) {
    fail('could not inspect origin before push', [String(err.message ?? err)]);
  }
  if (refs) {
    fail('origin already has branch refs; refusing to push into a non-empty repo', refs.split('\n'));
  }
}

function pushAndVerify(outDir, githubRepo, sha) {
  run('git', ['push', 'origin', 'main'], { cwd: outDir, stdio: 'inherit' });

  const remoteMain = runText('git', ['ls-remote', '--heads', 'origin', 'main'], outDir).split(/\s+/)[0];
  if (remoteMain !== sha) {
    fail('remote main does not match generated initial commit', [
      `local: ${sha}`,
      `remote: ${remoteMain}`,
    ]);
  }

  if (!githubRepo) return;
  const raw = runText(
    'gh',
    [
      'api',
      `repos/${githubRepo}/commits/${sha}`,
      '--jq',
      '{sha,authorName:.commit.author.name,authorEmail:.commit.author.email,committerName:.commit.committer.name,committerEmail:.commit.committer.email}',
    ],
    outDir
  );
  const commit = JSON.parse(raw);
  const problems = [];
  if (commit.sha !== sha) problems.push(`sha: ${commit.sha}`);
  if (commit.authorName !== BOT_NAME) problems.push(`author name: ${commit.authorName}`);
  if (commit.authorEmail !== BOT_EMAIL) problems.push(`author email: ${commit.authorEmail}`);
  if (commit.committerName !== BOT_NAME) problems.push(`committer name: ${commit.committerName}`);
  if (commit.committerEmail !== BOT_EMAIL) problems.push(`committer email: ${commit.committerEmail}`);
  if (problems.length > 0) fail('GitHub commit metadata verification failed', problems);
}

const options = parseArgs(process.argv.slice(2));
ensurePushIsExplicit(options);

const root = runText('git', ['rev-parse', '--show-toplevel'], process.cwd());
ensureSourceClean(root, options);

const sourceCommit = runText('git', ['rev-parse', `${options.sourceRef}^{commit}`], root);
ensureOriginMainMatches(root, sourceCommit, options.skipOriginCheck);

const outDir = path.resolve(options.outDir || defaultOutDir(sourceCommit));
if (options.push && options.allowDirty) fail('--push cannot be used with --allow-dirty');

try {
  ensureFreshOutDir(outDir);
  const files = copyTrackedFiles(root, sourceCommit, outDir);
  verifyNoGitMetadata(outDir);
  runPublicAudit(outDir);
  commitCleanRepo(outDir);
  const sha = verifyCommit(outDir, files.length);
  addRemote(outDir, options.remote);

  if (options.push) {
    ensureRemoteIsEmpty(outDir);
    pushAndVerify(outDir, options.githubRepo, sha);
  }

  console.log('Public release repo prepared.');
  console.log(`- source commit: ${sourceCommit}`);
  console.log(`- output dir: ${outDir}`);
  console.log(`- release commit: ${sha}`);
  console.log(`- author/committer: ${BOT_NAME} <${BOT_EMAIL}>`);
  console.log(`- tracked files: ${files.length}`);
  if (!options.push) {
    console.log('- push: not run');
    console.log(`- push confirmation required: ILPB_PUBLIC_RELEASE_CONFIRM=${PUSH_CONFIRM}`);
  }
} catch (err) {
  if (existsSync(outDir) && !existsSync(path.join(outDir, '.git'))) {
    rmSync(outDir, { recursive: true, force: true });
  }
  fail(String(err.message ?? err));
}
