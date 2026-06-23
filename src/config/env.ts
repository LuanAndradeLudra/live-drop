import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),

  // PostgreSQL (Prisma usa DATABASE_URL)
  DATABASE_URL: z.string(),

  JOBS_DEFAULT_BATCH: z.coerce.number().default(1),
  JOBS_MAX_TRIES: z.coerce.number().default(2),

  /** Quantos drops por streamer manter em fetched_rolls (limpeza diária). */
  FETCHED_ROLLS_KEEP_PER_STREAMER: z.coerce.number().int().min(1).default(30),

  /** Hora (0-23, horário local) em que roda a limpeza diária de drops antigos. */
  DAILY_CLEANUP_HOUR: z.coerce.number().int().min(0).max(23).default(5),

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
