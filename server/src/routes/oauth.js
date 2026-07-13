import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { query, transaction } from '../db.js';
import { assert, HttpError } from '../http.js';
import { createSession } from '../session.js';
import { randomToken, sha256 } from '../security.js';
import { exchangeOAuthCode, oauthAuthorizeUrl } from '../services/oauth.js';
import { parse } from '../validation.js';

const providerSchema = z.enum(['wechat', 'qq']);

function callbackPage(success, message) {
  const title = success ? '登录成功' : '登录失败';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8f7f3;color:#20201e}main{text-align:center;padding:28px}h1{font-size:22px}p{color:#76736d}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

async function upsertOauthUser(provider, profile, attemptId) {
  return transaction(async client => {
    const existing = await client.query(
      `SELECT u.id
         FROM oauth_accounts oa
         JOIN users u ON u.id = oa.user_id
        WHERE oa.provider = $1 AND oa.provider_user_id = $2 AND u.deleted_at IS NULL
        FOR UPDATE`,
      [provider, profile.providerUserId],
    );
    let userId = existing.rows[0]?.id;
    if (!userId) {
      const user = await client.query(
        `INSERT INTO users (nickname, avatar_url) VALUES ($1, $2) RETURNING id`,
        [profile.nickname.slice(0, 40), profile.avatarUrl],
      );
      userId = user.rows[0].id;
      await client.query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, union_id, profile)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, provider, profile.providerUserId, profile.unionId, profile.profile],
      );
    } else {
      await client.query(
        `UPDATE oauth_accounts SET union_id = COALESCE($3, union_id), profile = $4, updated_at = now()
          WHERE provider = $1 AND provider_user_id = $2`,
        [provider, profile.providerUserId, profile.unionId, profile.profile],
      );
    }
    await client.query(
      `UPDATE oauth_login_attempts SET status = 'complete', user_id = $2, completed_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [attemptId, userId],
    );
    return userId;
  });
}

export async function registerOAuthRoutes(fastify) {
  fastify.post('/auth/oauth/:provider/start', async request => {
    const provider = parse(providerSchema, request.params.provider);
    assert(config.oauthConfigured[provider], 503, 'oauth_not_configured', `${provider === 'wechat' ? '微信' : 'QQ'}登录尚未配置`);
    const state = randomToken(24);
    const pollToken = randomToken(32);
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const result = await query(
      `INSERT INTO oauth_login_attempts (provider, state_hash, poll_token_hash, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [provider, sha256(state), sha256(pollToken), expiresAt],
    );
    const authorizeUrl = oauthAuthorizeUrl(provider, state);
    const qrDataUrl = await QRCode.toDataURL(authorizeUrl, { width: 260, margin: 1, errorCorrectionLevel: 'M' });
    return { attemptId: result.rows[0].id, pollToken, qrDataUrl, expiresIn: 300 };
  });

  fastify.get('/auth/oauth/:provider/callback', async (request, reply) => {
    const provider = parse(providerSchema, request.params.provider);
    const querystring = parse(z.object({ code: z.string().min(1), state: z.string().min(20) }), request.query);
    const attempt = await query(
      `SELECT id FROM oauth_login_attempts
        WHERE provider = $1 AND state_hash = $2 AND status = 'pending' AND expires_at > now()`,
      [provider, sha256(querystring.state)],
    );
    if (!attempt.rowCount) {
      reply.type('text/html').code(400);
      return callbackPage(false, '二维码已过期，请返回电脑重新获取。');
    }
    try {
      const profile = await exchangeOAuthCode(provider, querystring.code);
      await upsertOauthUser(provider, profile, attempt.rows[0].id);
      reply.type('text/html');
      return callbackPage(true, '授权已完成，请返回电脑继续使用。');
    } catch (error) {
      await query(`UPDATE oauth_login_attempts SET status = 'failed', error_code = $2 WHERE id = $1`, [attempt.rows[0].id, error.code || 'oauth_failed']);
      request.log.error({ err: error, provider }, 'OAuth callback failed');
      reply.type('text/html').code(502);
      return callbackPage(false, '授权没有完成，请返回电脑重新扫码。');
    }
  });

  fastify.get('/auth/oauth/attempts/:attemptId', async (request, reply) => {
    const params = parse(z.object({ attemptId: z.string().uuid() }), request.params);
    const pollToken = request.headers['x-oauth-poll-token'];
    assert(typeof pollToken === 'string' && pollToken.length >= 32, 401, 'invalid_poll_token', '扫码登录凭证无效');
    const result = await query(
      `SELECT id, status, user_id, expires_at, error_code
         FROM oauth_login_attempts
        WHERE id = $1 AND poll_token_hash = $2`,
      [params.attemptId, sha256(pollToken)],
    );
    assert(result.rowCount, 404, 'oauth_attempt_not_found', '扫码登录请求不存在');
    const attempt = result.rows[0];
    if (new Date(attempt.expires_at).getTime() <= Date.now()) return { status: 'expired' };
    if (attempt.status === 'failed') return { status: 'failed', errorCode: attempt.error_code };
    if (attempt.status !== 'complete') return { status: attempt.status };
    const consumed = await query(
      `UPDATE oauth_login_attempts SET status = 'consumed'
        WHERE id = $1 AND status = 'complete' RETURNING user_id`,
      [attempt.id],
    );
    if (!consumed.rowCount) throw new HttpError(409, 'oauth_attempt_consumed', '扫码登录请求已经使用');
    try {
      await createSession(reply, request, consumed.rows[0].user_id);
    } catch (error) {
      await query(`UPDATE oauth_login_attempts SET status = 'complete' WHERE id = $1 AND status = 'consumed'`, [attempt.id]);
      throw error;
    }
    return { status: 'authenticated' };
  });
}
