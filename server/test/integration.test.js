import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { DataType, newDb } from 'pg-mem';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/test';
process.env.FRONTEND_ORIGINS = 'http://127.0.0.1:4173';
process.env.PUBLIC_API_URL = 'http://127.0.0.1:8787';
process.env.OTP_PEPPER = 'test-pepper-that-is-at-least-32-characters-long';
process.env.WECHAT_REDIRECT_URI = 'http://127.0.0.1:8787/auth/oauth/wechat/callback';
process.env.QQ_REDIRECT_URI = 'http://127.0.0.1:8787/auth/oauth/qq/callback';

const { usePoolForTests, query } = await import('../src/db.js');
const { buildApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/security.js');

const originHeaders = { origin: 'http://127.0.0.1:4173' };
const sentCodes = new Map();
let app;
let pool;

function cookieFrom(response) {
  return response.headers['set-cookie']?.split(';')[0];
}

function authHeaders(cookie) {
  return { ...originHeaders, cookie };
}

function filledGrid(colorId = 'H7') {
  return Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => x === 0 && y === 0 ? colorId : null));
}

async function createRegisteredUser(phone, password, nickname) {
  let response = await app.inject({
    method: 'POST',
    url: '/auth/sms/request',
    headers: originHeaders,
    payload: { phone, purpose: 'register' },
  });
  assert.equal(response.statusCode, 200, response.body);
  response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: originHeaders,
    payload: {
      phone,
      code: sentCodes.get(`${phone}:register`),
      password,
      passwordConfirmation: password,
      nickname,
      region: '江苏省',
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return { cookie: cookieFrom(response), user: response.json().user };
}

before(async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.registerExtension('pgcrypto', schema => {
    schema.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: crypto.randomUUID });
  });
  const migration = await fs.readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
  memory.public.none(migration);
  const adapter = memory.adapters.createPg();
  pool = new adapter.Pool();
  usePoolForTests(pool);
  app = await buildApp({
    logger: false,
    keepPoolOpen: true,
    smsService: {
      async sendVerificationSms(phone, code) {
        const latest = await query('SELECT purpose FROM sms_codes WHERE phone = $1 ORDER BY created_at DESC LIMIT 1', [phone]);
        sentCodes.set(`${phone}:${latest.rows[0].purpose}`, code);
      },
    },
  });
});

after(async () => {
  await app?.close();
  await pool?.end();
});

test('registration validates confirmation and creates an HttpOnly session', async () => {
  const phone = '13800138001';
  let response = await app.inject({ method: 'POST', url: '/auth/sms/request', headers: originHeaders, payload: { phone, purpose: 'register' } });
  assert.equal(response.statusCode, 200, response.body);
  response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: originHeaders,
    payload: {
      phone,
      code: sentCodes.get(`${phone}:register`),
      password: 'Strong_Test_2005!',
      passwordConfirmation: 'Different_Test_2005!',
      nickname: '测试用户',
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'validation_error');

  const registered = await createRegisteredUser('13800138002', 'Strong_Test_2005!', '普通用户');
  assert.match(registered.cookie, /^douhui_session=/);
  assert.equal(registered.user.role, 'user');
  const session = await query('SELECT token_hash FROM sessions WHERE user_id = $1', [registered.user.id]);
  assert.match(session.rows[0].token_hash, /^[a-f0-9]{64}$/);
  assert.equal(session.rows[0].token_hash.includes(registered.cookie.split('=')[1]), false);
});

test('ordinary users are isolated while admins can inspect and delete their patterns', async () => {
  const user = await createRegisteredUser('13800138003', 'User_Test_2005!', '图纸用户');
  let response = await app.inject({
    method: 'POST',
    url: '/patterns',
    headers: authHeaders(user.cookie),
    payload: { title: '测试图纸', width: 16, height: 16, paletteSize: 221, beads: filledGrid() },
  });
  assert.equal(response.statusCode, 201, response.body);
  const patternId = response.json().pattern.id;

  response = await app.inject({ method: 'GET', url: '/admin/users', headers: authHeaders(user.cookie) });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'admin_required');

  const adminPassword = 'Admin_Test_2005!';
  const inserted = await query(
    `INSERT INTO users (phone, password_hash, nickname, role, phone_verified_at)
     VALUES ($1, $2, $3, 'admin', now()) RETURNING id`,
    ['13800138004', await hashPassword(adminPassword), '管理员'],
  );
  response = await app.inject({
    method: 'POST',
    url: '/auth/login/password',
    headers: originHeaders,
    payload: { phone: '13800138004', password: adminPassword },
  });
  assert.equal(response.statusCode, 200, response.body);
  const adminCookie = cookieFrom(response);

  response = await app.inject({ method: 'GET', url: `/admin/users/${user.user.id}/patterns`, headers: authHeaders(adminCookie) });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().patterns[0].id, patternId);

  response = await app.inject({ method: 'GET', url: `/admin/patterns/${patternId}`, headers: authHeaders(adminCookie) });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().pattern.beads[0][0], 'H7');

  response = await app.inject({ method: 'DELETE', url: `/admin/patterns/${patternId}`, headers: authHeaders(adminCookie) });
  assert.equal(response.statusCode, 200, response.body);
  response = await app.inject({ method: 'GET', url: `/patterns/${patternId}`, headers: authHeaders(user.cookie) });
  assert.equal(response.statusCode, 404);

  const audits = await query('SELECT action, target_user_id FROM admin_audit_logs WHERE admin_user_id = $1 ORDER BY id', [inserted.rows[0].id]);
  assert.ok(audits.rows.some(row => row.action === 'pattern.read' && row.target_user_id === user.user.id));
  assert.ok(audits.rows.some(row => row.action === 'pattern.delete' && row.target_user_id === user.user.id));
});

test('completion is idempotent and 221-color patterns reject extended colors', async () => {
  const user = await createRegisteredUser('13800138005', 'Stock_Test_2005!', '库存用户');
  await app.inject({
    method: 'PUT',
    url: '/inventory',
    headers: authHeaders(user.cookie),
    payload: { items: [{ colorId: 'H7', quantity: 150 }] },
  });
  let response = await app.inject({
    method: 'POST',
    url: '/patterns',
    headers: authHeaders(user.cookie),
    payload: { title: '库存图纸', width: 16, height: 16, paletteSize: 221, beads: filledGrid() },
  });
  const patternId = response.json().pattern.id;
  response = await app.inject({ method: 'POST', url: `/patterns/${patternId}/complete`, headers: authHeaders(user.cookie) });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().applied, true);
  assert.equal(response.json().changes[0].after, 149);
  response = await app.inject({ method: 'POST', url: `/patterns/${patternId}/complete`, headers: authHeaders(user.cookie) });
  assert.equal(response.json().applied, false);
  const inventory = await app.inject({ method: 'GET', url: '/inventory', headers: authHeaders(user.cookie) });
  assert.equal(inventory.json().quantities.H7, 149);

  response = await app.inject({
    method: 'POST',
    url: '/patterns',
    headers: authHeaders(user.cookie),
    payload: { title: '错误色号', width: 16, height: 16, paletteSize: 221, beads: filledGrid('P1') },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'invalid_color_id');
});

test('OAuth polling path is not captured by the provider callback route', async () => {
  const response = await app.inject({ method: 'GET', url: '/auth/oauth/attempts/not-a-uuid', headers: { 'x-oauth-poll-token': 'x'.repeat(32) } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'validation_error');
});

test('OTP expires and locks after five invalid attempts', async () => {
  const phone = '13800138006';
  let response = await app.inject({ method: 'POST', url: '/auth/sms/request', headers: originHeaders, payload: { phone, purpose: 'register' } });
  assert.equal(response.statusCode, 200, response.body);
  await query(`UPDATE sms_codes SET expires_at = now() - interval '1 minute' WHERE phone = $1`, [phone]);
  response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: originHeaders,
    payload: { phone, code: sentCodes.get(`${phone}:register`), password: 'Expire_Test_2005!', passwordConfirmation: 'Expire_Test_2005!', nickname: '过期用户' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'otp_expired');

  const lockedPhone = '13800138007';
  await query(`UPDATE sms_codes SET created_at = now() - interval '2 hours'`);
  response = await app.inject({ method: 'POST', url: '/auth/sms/request', headers: originHeaders, payload: { phone: lockedPhone, purpose: 'register' } });
  assert.equal(response.statusCode, 200, response.body);
  for (let attempt = 0; attempt < 5; attempt++) {
    response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: originHeaders,
      payload: { phone: lockedPhone, code: '000000', password: 'Locked_Test_2005!', passwordConfirmation: 'Locked_Test_2005!', nickname: '锁定用户' },
    });
    assert.equal(response.json().error.code, 'otp_invalid');
  }
  response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: originHeaders,
    payload: { phone: lockedPhone, code: sentCodes.get(`${lockedPhone}:register`), password: 'Locked_Test_2005!', passwordConfirmation: 'Locked_Test_2005!', nickname: '锁定用户' },
  });
  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error.code, 'otp_attempts_exceeded');
});

test('password login rate limits repeated phone failures', async () => {
  const phone = '13800138008';
  await query(
    `INSERT INTO users (phone, password_hash, nickname, phone_verified_at)
     VALUES ($1, $2, $3, now())`,
    [phone, await hashPassword('Rate_Test_2005!'), '限流用户'],
  );
  await query('DELETE FROM login_attempts');
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await app.inject({ method: 'POST', url: '/auth/login/password', headers: originHeaders, payload: { phone, password: 'Wrong_Test_2005!' } });
    assert.equal(response.statusCode, 401, response.body);
  }
  const limited = await app.inject({ method: 'POST', url: '/auth/login/password', headers: originHeaders, payload: { phone, password: 'Rate_Test_2005!' } });
  assert.equal(limited.statusCode, 429, limited.body);
  assert.equal(limited.json().error.code, 'login_rate_limited');
  assert.equal(limited.headers['x-content-type-options'], 'nosniff');
  assert.equal(limited.headers['cache-control'], 'no-store');
});
