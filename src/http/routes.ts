import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../utils/http';
import { enqueue, consumeBatch } from '../managers/rolls.manager';
import { listRolls } from '../repositories/rolls.repo';
import { listFetched } from '../repositories/fetched-rolls.repo';

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

 router.get('/viewer', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Live Drop – Viewer</title>
  </head>
  <body>
    <h1>Fetched Rolls (raw)</h1>
    <div id="log"></div>

    <script>
      (function () {
        var el = document.getElementById('log');
        function append(obj) {
          var wrap = document.createElement('div');
          // Apenas monta divs com o "data" bruto como string
          var dataDiv = document.createElement('div');
          dataDiv.textContent = JSON.stringify(obj.payload.data);
          wrap.appendChild(dataDiv);
          el.prepend(wrap); // mais recente em cima
        }

        // mesmo host/porta, path /ws
        var proto = location.protocol === 'https:' ? 'wss' : 'ws';
        var ws = new WebSocket(proto + '://' + location.host + '/ws');

        ws.onmessage = function (ev) {
          try {
            var msg = JSON.parse(ev.data);
            if (msg && msg.event === 'fetched_roll') {
              append(msg);
            }
          } catch (e) {}
        };

        ws.onopen = function(){ console.log('[viewer] ws open'); };
        ws.onclose = function(){ console.log('[viewer] ws closed'); };
        ws.onerror = function(e){ console.log('[viewer] ws error', e); };
      })();
    </script>
  </body>
</html>`);
  });

export default router;
