import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/test';
process.env.FRONTEND_ORIGINS = 'http://127.0.0.1:4173';
process.env.PUBLIC_API_URL = 'http://127.0.0.1:8787';
process.env.OTP_PEPPER = 'test-pepper-that-is-at-least-32-characters-long';
process.env.WECHAT_REDIRECT_URI = 'http://127.0.0.1:8787/auth/oauth/wechat/callback';
process.env.QQ_REDIRECT_URI = 'http://127.0.0.1:8787/auth/oauth/qq/callback';

const { bindSql } = await import('../src/cloudbase-db.js');

test('CloudBase SQL parameters are escaped without changing their types', () => {
  const date = new Date('2026-07-15T02:03:04.000Z');
  const sql = bindSql(
    'SELECT $1::text AS name, $2::boolean AS enabled, $3::integer AS amount, $4::jsonb AS data, $5::timestamptz AS created',
    ["O'Reilly", true, 12, { color: 'H7' }, date],
  );
  assert.equal(
    sql,
    "SELECT 'O''Reilly'::text AS name, TRUE::boolean AS enabled, 12::integer AS amount, '{\"color\":\"H7\"}'::jsonb AS data, '2026-07-15T02:03:04.000Z'::timestamptz AS created",
  );
});

test('CloudBase SQL binding handles repeated and double-digit placeholders', () => {
  const values = Array.from({ length: 10 }, (_, index) => index + 1);
  assert.equal(bindSql('SELECT $10, $1, $10', values), 'SELECT 10, 1, 10');
  assert.throws(() => bindSql('SELECT $2', [1]), /Missing database parameter/);
});

