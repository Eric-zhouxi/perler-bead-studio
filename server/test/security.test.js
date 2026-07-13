import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.FRONTEND_ORIGINS ||= 'http://127.0.0.1:4173';
process.env.PUBLIC_API_URL ||= 'http://127.0.0.1:8787';
process.env.OTP_PEPPER ||= 'test-pepper-that-is-at-least-32-characters-long';
process.env.WECHAT_REDIRECT_URI ||= 'http://127.0.0.1:8787/auth/oauth/wechat/callback';
process.env.QQ_REDIRECT_URI ||= 'http://127.0.0.1:8787/auth/oauth/qq/callback';

const security = await import('../src/security.js');

test('passwords are stored as Argon2id hashes and verify correctly', async () => {
  const password = 'Strong_Test_2005';
  const hash = await security.hashPassword(password);
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await security.verifyPassword(hash, password), true);
  assert.equal(await security.verifyPassword(hash, 'wrong-password'), false);
});

test('password policy rejects weak values', () => {
  assert.ok(security.validatePasswordStrength('short').length >= 3);
  assert.deepEqual(security.validatePasswordStrength('Strong_Test_2005'), []);
});

test('OTP hashes are purpose-bound and deterministic', () => {
  const registerHash = security.hashOtp('13800138000', 'register', '123456');
  const loginHash = security.hashOtp('13800138000', 'login', '123456');
  assert.equal(registerHash.length, 64);
  assert.notEqual(registerHash, loginHash);
  assert.equal(security.safeEqualHex(registerHash, security.hashOtp('13800138000', 'register', '123456')), true);
});

test('pattern fingerprints change with pattern content', () => {
  const first = security.patternFingerprint({ width: 16, height: 16, paletteSize: 221, beads: [['H7']] });
  const second = security.patternFingerprint({ width: 16, height: 16, paletteSize: 221, beads: [['A1']] });
  assert.notEqual(first, second);
});
