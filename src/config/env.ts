import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),

  // PostgreSQL (Prisma usa DATABASE_URL)
  DATABASE_URL: z.string(),

  JOBS_DEFAULT_BATCH: z.coerce.number().default(1),
  JOBS_MAX_TRIES: z.coerce.number().default(3),

  /** > 0: POST /api/rolls retorna 429 quando fila queued ≥ valor (evita backlog infinito). 0 = sem limite. */
  MAX_QUEUED_ROLLS: z.coerce.number().int().min(0).default(0),

  /** Re-passar rolls em processing sem atualização há N minutos para queued (recupera travamento). 0 = desliga. */
  STALE_PROCESSING_MINUTES: z.coerce.number().int().min(0).default(15),

  /** Intervalo do cron que verifica processing preso (ms). */
  STALE_PROCESSING_INTERVAL_MS: z.coerce.number().int().min(10_000).default(90_000),

  /** Máx. páginas Puppeteer em paralelo (browser pool). */
  PPTR_MAX_PAGES: z.coerce.number().int().min(1).max(64).default(1),
});

export const ENV = schema.parse(process.env);
