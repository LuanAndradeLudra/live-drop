import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../utils/http.js';
import { enqueue, consumeBatch } from '../managers/rolls.manager.js';
import { listRolls } from '../repositories/rolls.repo.js';
import { listFetched } from '../repositories/fetched-rolls.repo.js';

const router = Router();

/** POST /api/rolls — Enfileira um roll */
router.post(
  '/rolls',
  validateBody(z.object({
    userId: z.string().min(1),
    rollId: z.string().min(1),
    type: z.enum(['upgrade', 'case']).default('upgrade')
  })),
  async (req, res) => {
    const { userId, rollId, type } = (req as any).data;
    const blackList = [
      '5768337'
    ]
    if (blackList.includes(userId)) {
      return res.status(400).json({ error: 'user_blacklisted' });
    }
    await enqueue({ userId, rollId, type });
    res.status(202).json({ ok: true });
  }
);

/** GET /api/rolls — Lista com filtros + cursor, default últimos 100 (created_at desc) */
router.get(
  '/rolls',
  validateQuery(z.object({
    state: z.enum(['queued', 'processing', 'failed']).optional(),
    userId: z.string().optional(),
    type: z.enum(['upgrade', 'case']).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    createdBefore: z.string().datetime().optional(),
    idLt: z.coerce.number().int().optional()
  })),
  async (req, res) => {
    const q = (req as any).queryData;
    const rows = await listRolls(q);
    res.json({ items: rows, count: rows.length });
  }
);

/** GET /api/fetched-rolls — Lista com filtros + cursor, default 100 */
router.get(
  '/fetched-rolls',
  validateQuery(z.object({
    userId: z.string().optional(),
    type: z.enum(['upgrade', 'case']).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    createdBefore: z.string().datetime().optional(),
    idLt: z.coerce.number().int().optional()
  })),
  async (req, res) => {
    const q = (req as any).queryData;
    const rows = await listFetched(q);
    res.json({ items: rows, count: rows.length });
  }
);

/** POST /api/jobs/consume — dispara consumo manual (útil p/ cron, PM2, etc.) */
router.post(
  '/jobs/consume',
  validateBody(z.object({
    batch: z.coerce.number().int().min(1).max(50).default(5)
  }).partial()),
  async (req, res) => {
    const { batch } = (req as any).data ?? {};
    const out = await consumeBatch({ batch });
    res.json(out);
  }
);

export default router;
