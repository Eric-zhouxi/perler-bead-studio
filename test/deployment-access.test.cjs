const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const apiConfig = fs.readFileSync(path.join(root, 'api-config.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('the frontend loads no runtime assets from external domains', () => {
  const externalAssets = html.match(/<(?:link|script)\b[^>]*(?:href|src)=["']https?:\/\/[^"']+/gi) || [];
  assert.deepEqual(externalAssets, []);
  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/i);
});

test('the former web fonts resolve from local system fonts', () => {
  assert.match(css, /font-family:'Noto Sans SC';src:local\('Microsoft YaHei UI'\)/);
  assert.match(css, /font-family:'DM Mono';src:local\('Cascadia Mono'\)/);
  assert.doesNotMatch(css, /url\(https?:\/\//i);
});

test('the account UI points at the deployed CloudBase HTTPS API', () => {
  assert.match(apiConfig, /^window\.DOUHUI_API_BASE = window\.DOUHUI_API_BASE \|\| 'https:\/\/douhui-prod-[^']+\.ap-shanghai\.app\.tcloudbase\.com\/api';\s*$/);
});

test('the README links the verified Gitee mirror without claiming an unavailable Pages site', () => {
  assert.match(readme, /Gitee（中国大陆镜像）：<https:\/\/gitee\.com\/Eric_zhoux\/perler-bead-studio>/);
  assert.doesNotMatch(readme, /eric_zhoux\.gitee\.io\/perler-bead-studio/i);
});

test('the README provides CloudBase as the mainland site and keeps GitHub Pages as backup', () => {
  assert.match(
    readme,
    /中国大陆（CloudBase）：<https:\/\/douhui-prod-d1g1urejqdaeee4d4-1453834128\.tcloudbaseapp\.com\/>/
  );
  assert.match(readme, /GitHub Pages（海外备用）/);
});
