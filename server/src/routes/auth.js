import { z } from 'zod';
import { config } from '../config.js';
import { transaction, query } from '../db.js';
import { assert, HttpError, requestIp } from '../http.js';
import {
  generateOtp,
  hashOtp,
  hashPassword,
  isChineseMobile,
  normalizePhone,
  safeEqualHex,
  validatePasswordStrength,
  verifyPassword,
} from '../security.js';
import { authenticate, createSession, revokeSession } from '../session.js';
import { parse } from '../validation.js';

const phoneSchema = z.string().transform(normalizePhone).refine(isChineseMobile, '手机号格式不正确');
const otpSchema = z.string().regex(/^\d{6}$/, '验证码必须为 6 位数字');
const passwordSchema = z.string().min(1).superRefine((value, context) => {
  validatePasswordStrength(value).forEach(message => context.addIssue({ code: z.ZodIssueCode.custom, message }));
});
const userFields = 'id, phone, nickname, region, avatar_key, avatar_url, role, created_at';
const dummyPasswordHash = hashPassword('Dummy_Login_Value_2026!');

function publicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    nickname: user.nickname,
    region: user.region,
    avatarUrl: user.avatar_key ? `${config.PUBLIC_API_URL}/users/${user.id}/avatar` : user.avatar_url || null,
    role: user.role,
    createdAt: user.created_at,
  };
}

async function enforcePasswordRateLimit(phone, ip) {
  const [phoneResult, ipResult] = await Promise.all([
    query(`SELECT count(*) AS failures FROM login_attempts WHERE phone = $1 AND success = false AND created_at > now() - interval '15 minutes'`, [phone]),
    query(`SELECT count(*) AS failures FROM login_attempts WHERE request_ip = $1::inet AND success = false AND created_at > now() - interval '15 minutes'`, [ip]),
  ]);
  if (Number(phoneResult.rows[0].failures) >= 8 || Number(ipResult.rows[0].failures) >= 20) {
    throw new HttpError(429, 'login_rate_limited', '登录尝试过多，请 15 分钟后重试');
  }
}

async function recordLoginAttempt(phone, ip, success) {
  await query('INSERT INTO login_attempts (phone, request_ip, success) VALUES ($1, $2, $3)', [phone, ip, success]);
}

async function verifyOtp(client, phone, purpose, code) {
  const result = await client.query(
    `SELECT id, code_hash, attempts, expires_at
       FROM sms_codes
      WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [phone, purpose],
  );
  assert(result.rowCount, 400, 'otp_not_found', '请先获取验证码');
  const otp = result.rows[0];
  assert(new Date(otp.expires_at).getTime() > Date.now(), 400, 'otp_expired', '验证码已过期');
  assert(otp.attempts < 5, 429, 'otp_attempts_exceeded', '验证码错误次数过多，请重新获取');
  const valid = safeEqualHex(otp.code_hash, hashOtp(phone, purpose, code));
  if (!valid) {
    await client.query('UPDATE sms_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    return new HttpError(400, 'otp_invalid', '验证码不正确');
  }
  await client.query('UPDATE sms_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
  return null;
}

export async function registerAuthRoutes(fastify, { smsService }) {
  fastify.post('/auth/sms/request', async request => {
    const body = parse(z.object({ phone: phoneSchema, purpose: z.enum(['register', 'login']) }), request.body);
    const ip = requestIp(request);
    const existing = await query('SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL', [body.phone]);
    if (body.purpose === 'register') assert(!existing.rowCount, 409, 'phone_already_registered', '该手机号已经注册');
    if (body.purpose === 'login') assert(existing.rowCount, 404, 'account_not_found', '账号不存在');

    const [latestResult, phoneRate, ipRate] = await Promise.all([
      query('SELECT max(created_at) AS latest FROM sms_codes WHERE phone = $1', [body.phone]),
      query(`SELECT count(*) AS total FROM sms_codes WHERE phone = $1 AND created_at > now() - interval '1 hour'`, [body.phone]),
      query(`SELECT count(*) AS total FROM sms_codes WHERE request_ip = $1::inet AND created_at > now() - interval '1 hour'`, [ip]),
    ]);
    const latest = latestResult.rows[0].latest ? new Date(latestResult.rows[0].latest).getTime() : 0;
    assert(Date.now() - latest >= 60_000, 429, 'otp_too_frequent', '请 60 秒后再获取验证码');
    assert(Number(phoneRate.rows[0].total) < 5 && Number(ipRate.rows[0].total) < 20, 429, 'otp_rate_limited', '验证码请求过多，请稍后重试');

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const inserted = await query(
      `INSERT INTO sms_codes (phone, purpose, code_hash, expires_at, request_ip)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [body.phone, body.purpose, hashOtp(body.phone, body.purpose, code), expiresAt, ip],
    );
    try {
      await smsService.sendVerificationSms(body.phone, code, 5);
    } catch (error) {
      await query('DELETE FROM sms_codes WHERE id = $1', [inserted.rows[0].id]);
      throw error;
    }
    return { ok: true, expiresIn: 300, retryAfter: 60 };
  });

  fastify.post('/auth/register', async (request, reply) => {
    const body = parse(z.object({
      phone: phoneSchema,
      code: otpSchema,
      password: passwordSchema,
      passwordConfirmation: z.string(),
      nickname: z.string().trim().min(1).max(40),
      region: z.string().trim().max(100).optional().default(''),
    }).refine(value => value.password === value.passwordConfirmation, { path: ['passwordConfirmation'], message: '两次输入的密码不一致' }), request.body);
    const passwordHash = await hashPassword(body.password);
    const registration = await transaction(async client => {
      const otpError = await verifyOtp(client, body.phone, 'register', body.code);
      if (otpError) return { otpError };
      const existing = await client.query('SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL FOR UPDATE', [body.phone]);
      assert(!existing.rowCount, 409, 'phone_already_registered', '该手机号已经注册');
      const result = await client.query(
        `INSERT INTO users (phone, password_hash, nickname, region, phone_verified_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING ${userFields}`,
        [body.phone, passwordHash, body.nickname, body.region],
      );
      return { user: result.rows[0] };
    });
    if (registration.otpError) throw registration.otpError;
    const user = registration.user;
    await createSession(reply, request, user.id);
    reply.code(201);
    return { user: publicUser(user) };
  });

  fastify.post('/auth/login/password', async (request, reply) => {
    const body = parse(z.object({ phone: phoneSchema, password: z.string().min(1).max(128) }), request.body);
    const ip = requestIp(request);
    await enforcePasswordRateLimit(body.phone, ip);
    const result = await query(`SELECT ${userFields}, password_hash FROM users WHERE phone = $1 AND deleted_at IS NULL`, [body.phone]);
    const user = result.rows[0];
    const valid = await verifyPassword(user?.password_hash || await dummyPasswordHash, body.password);
    await recordLoginAttempt(body.phone, ip, Boolean(user && valid));
    assert(user && valid, 401, 'invalid_credentials', '手机号或密码不正确');
    await createSession(reply, request, user.id);
    return { user: publicUser(user) };
  });

  fastify.post('/auth/login/otp', async (request, reply) => {
    const body = parse(z.object({ phone: phoneSchema, code: otpSchema }), request.body);
    const login = await transaction(async client => {
      const otpError = await verifyOtp(client, body.phone, 'login', body.code);
      if (otpError) return { otpError };
      const result = await client.query(`SELECT ${userFields} FROM users WHERE phone = $1 AND deleted_at IS NULL`, [body.phone]);
      assert(result.rowCount, 404, 'account_not_found', '账号不存在');
      return { user: result.rows[0] };
    });
    if (login.otpError) throw login.otpError;
    const user = login.user;
    await createSession(reply, request, user.id);
    return { user: publicUser(user) };
  });

  fastify.get('/auth/me', async request => {
    const user = await authenticate(request);
    return { user: user ? publicUser(user) : null };
  });

  fastify.post('/auth/logout', async (request, reply) => {
    await revokeSession(reply, request);
    return { ok: true };
  });
}
