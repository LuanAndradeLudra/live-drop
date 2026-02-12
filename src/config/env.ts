import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),

  // PostgreSQL (Prisma usa DATABASE_URL)
  DATABASE_URL: z.string(),

  JOBS_DEFAULT_BATCH: z.coerce.number().default(5),
  JOBS_MAX_TRIES: z.coerce.number().default(3)
});

export const ENV = schema.parse(process.env);
