import assert from 'node:assert/strict';
import { renderReleaseNotesMarkdown } from '../src/lib/release-notes-markdown.js';

const html = renderReleaseNotesMarkdown(`## 変更内容

- CTAのURL入力欄で \`https://\` の途中入力が消える問題を修正しました。
- **安全な表示**にしました。

<script>alert(1)</script>

1. 管理画面で確認します。

[詳細](https://example.com/releases/v0.1.7)
`);

assert.match(html, /<h3>変更内容<\/h3>/);
assert.match(html, /<ul>\s*<li>CTAのURL入力欄で <code>https:\/\/<\/code>/);
assert.match(html, /<strong>安全な表示<\/strong>/);
assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(html, /<ol>\s*<li>管理画面で確認します。<\/li>\s*<\/ol>/);
assert.match(
  html,
  /<a href="https:\/\/example\.com\/releases\/v0\.1\.7" target="_blank" rel="noreferrer">詳細<\/a>/
);
assert.doesNotMatch(html, /## 変更内容/);
assert.doesNotMatch(html, /<script>/);

console.log('Release notes markdown contract audit passed.');
