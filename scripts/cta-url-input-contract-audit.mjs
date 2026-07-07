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

// The URL-mode helpers moved out of CtaEditor.tsx into CtaLinkForm.tsx
// when the link form was split into its own component; the guard
// follows the code.
const linkForm = 'src/components/admin/CtaLinkForm.tsx';

assertIncludes(linkForm, 'function urlValueForInlineUrl(link: CtaLink): string');
assertIncludes(linkForm, 'function urlValueForModeSwitch(link: CtaLink): string');
assertIncludes(linkForm, 'return url;');
assertIncludes(linkForm, "return isPlaceholderUrl(url) ? '' : url;");
assertIncludes(
  linkForm,
  "onChange({ type: 'custom_url', url: urlValueForModeSwitch(link) });",
);
assertFunctionDoesNotInclude(
  linkForm,
  'urlValueForInlineUrl',
  'isPlaceholderUrl(url)',
);

console.log('CTA URL input contract audit passed');
