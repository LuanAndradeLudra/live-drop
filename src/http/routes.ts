import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../utils/http.js';
import { enqueue, consumeBatch } from '../managers/rolls.manager.js';
import { listRolls, countRollsByState } from '../repositories/rolls.repo.js';
import { ENV } from '../config/env.js';
import { listFetched } from '../repositories/fetched-rolls.repo.js';

const router = Router();

/** userIds que não entram na fila (sem DB, sem browser). */
const IGNORED_ROLL_USER_IDS = new Set(['1101827', '918310', '6709790']);

/** POST /api/rolls — Enfileira um roll */
router.post(
  '/rolls',
  validateBody(z.object({
    userId: z.string().min(1),
    streamer: z.string().min(1),
    rollId: z.string().min(1),
    type: z.enum(['upgrade', 'case']).default('upgrade')
  })),
  async (req, res) => {
    const { userId, streamer, rollId, type } = (req as any).data;
    if (IGNORED_ROLL_USER_IDS.has(userId)) {
      return res.status(202).json({ ok: true });
    }
    if (ENV.MAX_QUEUED_ROLLS > 0) {
      const queued = await countRollsByState('queued');
      if (queued >= ENV.MAX_QUEUED_ROLLS) {
        return res.status(429).json({
          error: 'queue_full',
          message: 'Fila de rolls cheia; tente mais tarde.',
          queued,
          max: ENV.MAX_QUEUED_ROLLS,
        });
      }
    }
    await enqueue({ userId, streamer, rollId, type });
    res.status(202).json({ ok: true });
  }
);

/** GET /api/rolls — Lista com filtros + cursor, default últimos 100 (created_at desc) */
router.get(
  '/rolls',
  validateQuery(z.object({
    state: z.enum(['queued', 'processing', 'failed']).optional(),
    userId: z.string().optional(),
    streamer: z.string().optional(),
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
    streamer: z.string().optional(),
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
