import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db.js';
import { assert } from '../http.js';
import { hashPassword, sha256, validatePasswordStrength, verifyPassword } from '../security.js';
import { requireUser } from '../session.js';
import { deleteStoredObject, signedObjectUrl, uploadAvatar } from '../services/storage.js';
import { parse } from '../validation.js';

function profile(user) {
  return {
    id: user.id,
    phone: user.phone,
    nickname: user.nickname,
    region: user.region,
    avatarUrl: user.avatar_key ? `${config.PUBLIC_API_URL}/users/${user.id}/avatar` : user.avatar_url,
    role: user.role,
  };
}

export async function registerUserRoutes(fastify) {
  fastify.patch('/users/me', async request => {
    const user = await requireUser(request);
    const body = parse(z.object({ nickname: z.string().trim().min(1).max(40), region: z.string().trim().max(100).default('') }), request.body);
    const result = await query(
      `UPDATE users SET nickname = $2, region = $3, updated_at = now() WHERE id = $1
       RETURNING id, phone, nickname, region, avatar_key, avatar_url, role`,
      [user.id, body.nickname, body.region],
    );
    return { user: profile(result.rows[0]) };
  });

  fastify.post('/users/me/password', async request => {
    const user = await requireUser(request);
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1), newPasswordConfirmation: z.string().min(1) }), request.body);
    assert(body.newPassword === body.newPasswordConfirmation, 400, 'password_confirmation_mismatch', '两次输入的新密码不一致');
    const failures = validatePasswordStrength(body.newPassword);
    assert(!failures.length, 400, 'weak_password', '新密码不符合安全要求', { failures });
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    assert(await verifyPassword(result.rows[0]?.password_hash, body.currentPassword), 401, 'invalid_current_password', '当前密码不正确');
    await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, await hashPassword(body.newPassword)]);
    const currentToken = request.cookies[config.SESSION_COOKIE_NAME];
    await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2)', [user.id, currentToken ? sha256(currentToken) : null]);
    return { ok: true };
  });

  fastify.post('/users/me/avatar', async request => {
    const user = await requireUser(request);
    const part = await request.file({ limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
    assert(part && part.mimetype?.startsWith('image/'), 400, 'avatar_required', '请选择头像图片');
    const buffer = await part.toBuffer();
    const key = await uploadAvatar(user.id, buffer);
    const old = await query('SELECT avatar_key FROM users WHERE id = $1', [user.id]);
    const oldKey = old.rows[0]?.avatar_key;
    await query('UPDATE users SET avatar_key = $2, avatar_url = NULL, updated_at = now() WHERE id = $1', [user.id, key]);
    if (oldKey && oldKey !== key) deleteStoredObject(oldKey).catch(() => {});
    return { avatarUrl: `${config.PUBLIC_API_URL}/users/${user.id}/avatar` };
  });

  fastify.get('/users/:userId/avatar', async (request, reply) => {
    const params = parse(z.object({ userId: z.string().uuid() }), request.params);
    const result = await query('SELECT avatar_key, avatar_url FROM users WHERE id = $1 AND deleted_at IS NULL', [params.userId]);
    assert(result.rowCount, 404, 'user_not_found', '用户不存在');
    const url = result.rows[0].avatar_key ? signedObjectUrl(result.rows[0].avatar_key) : result.rows[0].avatar_url;
    assert(url, 404, 'avatar_not_found', '用户没有设置头像');
    return reply.redirect(url);
  });
}
