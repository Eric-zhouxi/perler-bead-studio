import { z } from 'zod';
import { query, transaction } from '../db.js';
import { assert } from '../http.js';
import { decodePattern, encodePattern, validatePattern } from '../patterns.js';
import { requireUser } from '../session.js';
import { parse } from '../validation.js';

const idSchema = z.object({ patternId: z.string().uuid() });
const patternBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  width: z.number().int(),
  height: z.number().int(),
  paletteSize: z.union([z.literal(221), z.literal(291)]),
  beads: z.array(z.array(z.string().nullable())),
});

function summary(row) {
  return {
    id: row.id,
    title: row.title,
    width: row.width,
    height: row.height,
    paletteSize: row.palette_size,
    beadUsage: row.bead_usage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function registerPatternRoutes(fastify) {
  fastify.get('/patterns', async request => {
    const user = await requireUser(request);
    const input = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.string().datetime().optional() }), request.query);
    const result = await query(
      `SELECT id, title, width, height, palette_size, bead_usage, created_at, updated_at
       FROM patterns WHERE user_id = $1 AND deleted_at IS NULL AND ($2::timestamptz IS NULL OR created_at < $2)
       ORDER BY created_at DESC LIMIT $3`,
      [user.id, input.before || null, input.limit],
    );
    return { patterns: result.rows.map(summary) };
  });

  fastify.post('/patterns', async (request, reply) => {
    const user = await requireUser(request);
    const body = parse(patternBodySchema, request.body);
    const validated = validatePattern(body);
    const result = await query(
      `INSERT INTO patterns (user_id, title, width, height, palette_size, pattern_data, bead_usage, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, width, height, palette_size, bead_usage, created_at, updated_at`,
      [user.id, body.title, body.width, body.height, body.paletteSize, encodePattern(body.beads), validated.usage, validated.fingerprint],
    );
    reply.code(201);
    return { pattern: summary(result.rows[0]) };
  });

  fastify.get('/patterns/:patternId', async request => {
    const user = await requireUser(request);
    const params = parse(idSchema, request.params);
    const result = await query('SELECT * FROM patterns WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [params.patternId, user.id]);
    assert(result.rowCount, 404, 'pattern_not_found', '图纸不存在');
    const row = result.rows[0];
    return { pattern: { ...summary(row), beads: decodePattern(row.pattern_data, row.width, row.height) } };
  });

  fastify.delete('/patterns/:patternId', async request => {
    const user = await requireUser(request);
    const params = parse(idSchema, request.params);
    const result = await query('UPDATE patterns SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id', [params.patternId, user.id]);
    assert(result.rowCount, 404, 'pattern_not_found', '图纸不存在');
    return { ok: true };
  });

  fastify.post('/patterns/:patternId/complete', async request => {
    const user = await requireUser(request);
    const params = parse(idSchema, request.params);
    return transaction(async client => {
      const pattern = await client.query('SELECT id, bead_usage FROM patterns WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE', [params.patternId, user.id]);
      assert(pattern.rowCount, 404, 'pattern_not_found', '图纸不存在');
      const existing = await client.query('SELECT changes FROM inventory_transactions WHERE user_id = $1 AND pattern_id = $2', [user.id, params.patternId]);
      if (existing.rowCount) return { applied: false, changes: existing.rows[0].changes };
      const changes = [];
      for (const [colorId, used] of Object.entries(pattern.rows[0].bead_usage)) {
        const locked = await client.query('SELECT quantity FROM inventory WHERE user_id = $1 AND color_id = $2 FOR UPDATE', [user.id, colorId]);
        const before = Number(locked.rows[0]?.quantity || 0);
        const after = Math.max(0, before - Number(used));
        await client.query(
          `INSERT INTO inventory (user_id, color_id, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, color_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
          [user.id, colorId, after],
        );
        changes.push({ colorId, before, used: Number(used), after, lowStock: after < 100 });
      }
      await client.query('INSERT INTO inventory_transactions (user_id, pattern_id, changes) VALUES ($1, $2, $3)', [user.id, params.patternId, changes]);
      return { applied: true, changes };
    });
  });
}
