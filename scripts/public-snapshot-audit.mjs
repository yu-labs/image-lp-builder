#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function fail(message, details = []) {
  console.error(`Public snapshot audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

const BLOCKED_IDENTITY_TOKEN_HASHES = new Set([
  '94e43058fe0a30b2a59121625b9831328e6687fd6efcae8fc3a3a3835b3fa700',
  '1780bc79db2c9f8f4a2cda1f308c956bb1c63294d0ad4f7cf61048fc5bff27de',
  'e9c18239063b448ccc1439763d4fac2095e847ddb51174846c9ad04a34798d73',
  '5c3a711e46fa087852d0f1f986f34335e6eb282e3cef4703b44dff8f4f98c97e',
]);

function hashIdentityToken(value) {
  return createHash('sha256').update(value.toLowerCase()).digest('hex');
}

function containsBlockedIdentityToken(text) {
  const tokens = text.toLowerCase().match(/[a-z0-9._%+-]+/g) ?? [];
  return tokens.some((token) =>
    BLOCKED_IDENTITY_TOKEN_HASHES.has(hashIdentityToken(token))
  );
}

function trackedFiles() {
  if (!existsSync(path.join(root, '.git'))) {
    return walkSourceFiles(root);
  }
  try {
    const raw = execFileSync('git', ['ls-files', '--cached'], {
      cwd: root,
      encoding: 'utf8',
    });
    return raw.split('\n').filter(Boolean);
  } catch (err) {
    return walkSourceFiles(root);
  }
}

function walkSourceFiles(dir, prefix = '') {
  const skipDirs = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    '.astro',
    '.wrangler',
    '.cache',
    '.next',
  ]);
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.' || entry.name === '..') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      found.push(...walkSourceFiles(path.join(dir, entry.name), rel));
      continue;
    }
    if (entry.isFile()) found.push(rel);
  }
  return found.sort();
}

const files = trackedFiles();

const requiredFiles = [
  '.env.example',
  'README.md',
  'LICENSE',
  'install/README.md',
  'package.json',
  'pnpm-lock.yaml',
  'wrangler.jsonc',
  'worker-configuration.d.ts',
];

const missing = requiredFiles.filter((file) => !files.includes(file));
if (missing.length > 0) {
  fail('required public files are missing', missing);
}

const packageJson = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8')
);
if (packageJson.version !== '0.1.0') {
  fail('package.json version must be 0.1.0 for the initial public release', [
    `found ${JSON.stringify(packageJson.version)}`,
  ]);
}

const cloudflareBindings = packageJson.cloudflare?.bindings ?? {};
if (cloudflareBindings.SESSION) {
  fail('package.json must not expose a second Deploy to Cloudflare KV binding', [
    'use RATE_LIMIT for Astro session storage, temporary locks, and rate limits',
  ]);
}

const missingCloudflareBindingDescriptions = [
  'RATE_LIMIT',
  'DB',
  'BUCKET',
  'OAUTH_RELAY_URL',
].filter((binding) => {
  const description = cloudflareBindings[binding]?.description;
  return typeof description !== 'string' || description.trim() === '';
});
if (missingCloudflareBindingDescriptions.length > 0) {
  fail(
    'package.json is missing Deploy to Cloudflare binding descriptions',
    missingCloudflareBindingDescriptions
  );
}

const blockedPathMatches = files.filter((file) => {
  const parts = file.split('/');
  const base = path.basename(file);
  if (file === '.env.example') return false;
  if (file === 'AGENTS.md' || file === 'CLAUDE.md') return true;
  if (!file.includes('/') && base.startsWith('_') && base.endsWith('.md')) {
    return true;
  }
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base === '.dev.vars' || base === 'wrangler-secrets.toml') return true;
  if (base === 'package-lock.json') return true;
  if (/\.(key|pem|cert|crt)$/i.test(base)) return true;
  return parts.some((part) =>
    [
      '.git',
      'node_modules',
      'dist',
      '.astro',
      '.wrangler',
      '.claude',
      '.obsidian',
      '.vscode',
      'private',
      'internal',
      'secrets',
      '.secrets',
    ].includes(part)
  );
});

if (blockedPathMatches.length > 0) {
  fail('blocked files would enter the public snapshot', blockedPathMatches);
}

const secretPatterns = [
  [/@gmail\.com/i, 'Gmail address'],
  [/GH_TOKEN\s*=/i, 'GitHub token variable assignment'],
  [/GITHUB_TOKEN\s*=/i, 'GitHub token variable assignment'],
  [/CLOUDFLARE_API_TOKEN\s*=/i, 'Cloudflare API token assignment'],
  [/OPENAI_API_KEY\s*=/i, 'OpenAI API key assignment'],
  [/ANTHROPIC_API_KEY\s*=/i, 'Anthropic API key assignment'],
  [/CLIENT_SECRET\s*=/i, 'OAuth client secret assignment'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, 'private key block'],
];

const secretHits = [];
for (const file of files) {
  const abs = path.join(root, file);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  for (const [pattern, label] of secretPatterns) {
    if (pattern.test(text)) {
      secretHits.push(`${file}: ${label}`);
    }
  }
  if (containsBlockedIdentityToken(text)) {
    secretHits.push(`${file}: blocked identity token`);
  }
}

if (secretHits.length > 0) {
  fail('sensitive text was found in tracked files', secretHits);
}

const wrangler = readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
const requiredWranglerSnippets = [
  '"binding": "DB"',
  '"binding": "BUCKET"',
  '"binding": "ASSETS"',
  '"binding": "IMAGES"',
  '"binding": "RATE_LIMIT"',
  '"OAUTH_RELAY_URL"',
];

const missingWranglerSnippets = requiredWranglerSnippets.filter(
  (snippet) => !wrangler.includes(snippet)
);
if (missingWranglerSnippets.length > 0) {
  fail(
    'wrangler.jsonc is missing required public bindings',
    missingWranglerSnippets
  );
}

if (wrangler.includes('"binding": "SESSION"')) {
  fail('wrangler.jsonc must not declare a second KV binding', [
    'use RATE_LIMIT for Astro session storage, temporary locks, and rate limits',
  ]);
}

const forbiddenWranglerResourceFields = [
  [/"database_id"\s*:/, 'D1 database_id'],
  [/"database_name"\s*:/, 'D1 database_name'],
  [/"bucket_name"\s*:/, 'R2 bucket_name'],
  [/"(?:id|preview_id)"\s*:/, 'KV namespace id'],
];

const forbiddenWranglerHits = forbiddenWranglerResourceFields
  .filter(([pattern]) => pattern.test(wrangler))
  .map(([, label]) => label);
if (forbiddenWranglerHits.length > 0) {
  fail(
    'wrangler.jsonc must not pin provider-specific resource names or IDs',
    forbiddenWranglerHits
  );
}

const astroConfig = readFileSync(path.join(root, 'astro.config.mjs'), 'utf8');
if (!astroConfig.includes("sessionKVBindingName: 'RATE_LIMIT'")) {
  fail('Astro Cloudflare sessions must share the public RATE_LIMIT KV binding');
}

const workerTypes = readFileSync(
  path.join(root, 'worker-configuration.d.ts'),
  'utf8'
);
if (!workerTypes.includes('wrangler types --env-file .env.example')) {
  fail('worker-configuration.d.ts was not generated from .env.example');
}

if (/GH_TOKEN|GITHUB_TOKEN|auth\.yulab\.me/.test(workerTypes)) {
  fail('worker-configuration.d.ts contains local env or relay literal values');
}

console.log(`Public snapshot audit passed (${files.length} tracked files).`);
