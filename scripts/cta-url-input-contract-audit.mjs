#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function fail(message, details = []) {
  console.error(`CTA URL input contract audit failed: ${message}`);
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

function assertFunctionDoesNotInclude(file, functionName, forbiddenSnippet) {
  const text = read(file);
  const match = text.match(
    new RegExp(`function ${functionName}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match) {
    fail(`${file} is missing ${functionName}`);
  }
  if (match[1].includes(forbiddenSnippet)) {
    fail(`${functionName} contains forbidden snippet`, [forbiddenSnippet]);
  }
}

const ctaEditor = 'src/components/admin/CtaEditor.tsx';

assertIncludes(ctaEditor, 'function urlValueForInlineUrl(link: CtaLink): string');
assertIncludes(ctaEditor, 'function urlValueForModeSwitch(link: CtaLink): string');
assertIncludes(ctaEditor, 'return url;');
assertIncludes(ctaEditor, "return isPlaceholderUrl(url) ? '' : url;");
assertIncludes(
  ctaEditor,
  "onChange({ type: 'custom_url', url: urlValueForModeSwitch(link) });",
);
assertFunctionDoesNotInclude(
  ctaEditor,
  'urlValueForInlineUrl',
  'isPlaceholderUrl(url)',
);

console.log('CTA URL input contract audit passed');
