import { config } from './config.js';
import { query } from './db.js';
import { HttpError, requestIp } from './http.js';
import { randomToken, sha256 } from './security.js';

const cookieOptions = Object.freeze({
  path: '/',
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: config.COOKIE_SAME_SITE,
});

export async function createSession(reply, request, userId) {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, request_ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, expiresAt, request.headers['user-agent'] || null, requestIp(request)],
  );
  reply.setCookie(config.SESSION_COOKIE_NAME, token, { ...cookieOptions, expires: expiresAt });
}

export async function revokeSession(reply, request) {
  const token = request.cookies[config.SESSION_COOKIE_NAME];
  if (token) await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
  reply.clearCookie(config.SESSION_COOKIE_NAME, cookieOptions);
}

export async function authenticate(request) {
  const token = request.cookies[config.SESSION_COOKIE_NAME];
  if (!token) return null;
  const result = await query(
    `SELECT u.id, u.phone, u.nickname, u.region, u.avatar_key, u.avatar_url, u.role, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [sha256(token)],
  );
  if (!result.rowCount) return null;
  query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [sha256(token)]).catch(() => {});
  return result.rows[0];
}

export async function requireUser(request) {
  const user = request.user !== undefined ? request.user : await authenticate(request);
  if (!user) throw new HttpError(401, 'authentication_required', '请先登录');
  return user;
}

export async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== 'admin') throw new HttpError(403, 'admin_required', '需要管理员权限');
  return user;
}
