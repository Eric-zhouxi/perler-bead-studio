const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const apiConfig = fs.readFileSync(path.join(root, 'api-config.js'), 'utf8');

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
