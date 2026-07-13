import { z } from 'zod';
import { query, transaction } from '../db.js';
import { HttpError } from '../http.js';
import { allPaletteIds, isPaletteColor } from '../palette.js';
import { requireUser } from '../session.js';
import { parse } from '../validation.js';

export async function registerInventoryRoutes(fastify) {
  fastify.get('/inventory', async request => {
    const user = await requireUser(request);
    const result = await query('SELECT color_id, quantity, updated_at FROM inventory WHERE user_id = $1 ORDER BY color_id', [user.id]);
    const quantities = Object.fromEntries(allPaletteIds(291).map(id => [id, 0]));
    result.rows.forEach(row => { quantities[row.color_id] = row.quantity; });
    return { quantities };
  });

  fastify.put('/inventory', async request => {
    const user = await requireUser(request);
    const body = parse(z.object({ items: z.array(z.object({ colorId: z.string(), quantity: z.number().int().min(0).max(10_000_000) })).min(1).max(291) }), request.body);
    body.items.forEach(item => {
      if (!isPaletteColor(item.colorId, 291)) throw new HttpError(400, 'invalid_color_id', `色号 ${item.colorId} 不属于 MARD 291 色卡`);
    });
    await transaction(async client => {
      for (const item of body.items) {
        await client.query(
          `INSERT INTO inventory (user_id, color_id, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, color_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
          [user.id, item.colorId, item.quantity],
        );
      }
    });
    return { ok: true };
  });
}
