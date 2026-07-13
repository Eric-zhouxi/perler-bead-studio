import { z } from 'zod';
import { query } from '../db.js';
import { assert, requestIp } from '../http.js';
import { decodePattern } from '../patterns.js';
import { requireAdmin } from '../session.js';
import { parse } from '../validation.js';

function patternSummary(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    width: row.width,
    height: row.height,
    paletteSize: row.palette_size,
    beadUsage: row.bead_usage,
    createdAt: row.created_at,
  };
}

async function audit(request, adminId, action, targetUserId, resourceType, resourceId, metadata = {}) {
  await query(
    `INSERT INTO admin_audit_logs (admin_user_id, target_user_id, action, resource_type, resource_id, metadata, request_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [adminId, targetUserId, action, resourceType, resourceId, metadata, requestIp(request)],
  );
}

export async function registerAdminRoutes(fastify) {
  fastify.get('/admin/users', async request => {
    const admin = await requireAdmin(request);
    const input = parse(z.object({ query: z.string().trim().max(40).optional().default(''), limit: z.coerce.number().int().min(1).max(100).default(50) }), request.query);
    const search = input.query ? `%${input.query}%` : null;
    const result = await query(
      `SELECT u.id, u.phone, u.nickname, u.region, u.avatar_key, u.avatar_url, u.role, u.created_at,
              count(p.id) FILTER (WHERE p.deleted_at IS NULL) AS pattern_count
         FROM users u
         LEFT JOIN patterns p ON p.user_id = u.id
        WHERE u.deleted_at IS NULL
          AND ($1::text IS NULL OR u.phone ILIKE $1 OR u.nickname ILIKE $1)
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT $2`,
      [search, input.limit],
    );
    await audit(request, admin.id, 'users.list', null, 'user', null, { query: input.query, resultCount: result.rowCount });
    return {
      users: result.rows.map(row => ({
        id: row.id,
        phone: row.phone,
        nickname: row.nickname,
        region: row.region,
        avatarUrl: row.avatar_key ? `/users/${row.id}/avatar` : row.avatar_url,
        role: row.role,
        createdAt: row.created_at,
        patternCount: Number(row.pattern_count),
      })),
    };
  });

  fastify.get('/admin/users/:userId/patterns', async request => {
    const admin = await requireAdmin(request);
    const params = parse(z.object({ userId: z.string().uuid() }), request.params);
    const result = await query(
      `SELECT id, user_id, title, width, height, palette_size, bead_usage, created_at
         FROM patterns WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
      [params.userId],
    );
    await audit(request, admin.id, 'patterns.list_for_user', params.userId, 'pattern', null, { resultCount: result.rowCount });
    return { patterns: result.rows.map(patternSummary) };
  });

  fastify.get('/admin/patterns/:patternId', async request => {
    const admin = await requireAdmin(request);
    const params = parse(z.object({ patternId: z.string().uuid() }), request.params);
    const result = await query('SELECT * FROM patterns WHERE id = $1 AND deleted_at IS NULL', [params.patternId]);
    assert(result.rowCount, 404, 'pattern_not_found', '图纸不存在');
    const row = result.rows[0];
    await audit(request, admin.id, 'pattern.read', row.user_id, 'pattern', row.id);
    return { pattern: { ...patternSummary(row), beads: decodePattern(row.pattern_data, row.width, row.height) } };
  });

  fastify.delete('/admin/patterns/:patternId', async request => {
    const admin = await requireAdmin(request);
    const params = parse(z.object({ patternId: z.string().uuid() }), request.params);
    const result = await query(
      `UPDATE patterns SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id, user_id, title`,
      [params.patternId],
    );
    assert(result.rowCount, 404, 'pattern_not_found', '图纸不存在');
    const pattern = result.rows[0];
    await audit(request, admin.id, 'pattern.delete', pattern.user_id, 'pattern', pattern.id, { title: pattern.title });
    return { ok: true };
  });

  fastify.get('/admin/audit-logs', async request => {
    await requireAdmin(request);
    const result = await query(
      `SELECT id, admin_user_id, target_user_id, action, resource_type, resource_id, metadata, request_ip, created_at
         FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200`,
    );
    return { logs: result.rows };
  });
}
