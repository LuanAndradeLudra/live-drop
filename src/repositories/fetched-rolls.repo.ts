import { getPrisma, type Prisma } from '../db/prisma.js';
import type { RollType } from './rolls.repo.js';

export type FetchedRow = {
  id: number;
  user_id: string;
  streamer: string;
  roll: string;
  type: RollType;
  data: any;
  created_at: string;
  processed_at: string;
};

export async function insertFetched(params: {
  userId: string;
  streamer: string;
  roll: string;
  type: RollType;
  data: any;
}) {
  const prisma = getPrisma();
  await prisma.fetchedRoll.upsert({
    where: {
      uniq_fetched_per_user_streamer: {
        userId: params.userId,
        roll: params.roll,
        type: params.type,
        streamer: params.streamer,
      },
    },
    update: {
      data: params.data,
      processedAt: new Date(),
    },
    create: {
      userId: params.userId,
      streamer: params.streamer,
      roll: params.roll,
      type: params.type,
      data: params.data,
    },
  });
}

/**
 * Remove os drops mais antigos mantendo apenas os últimos `keepLast` por streamer.
 * Retorna o número de registros deletados.
 */
export async function pruneOldDropsPerStreamer(keepLast: number): Promise<number> {
  const prisma = getPrisma();
  const result = await prisma.$executeRaw`
    DELETE FROM fetched_rolls
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY streamer
                 ORDER BY created_at DESC, id DESC
               ) AS rn
        FROM fetched_rolls
      ) ranked
      WHERE rn > ${keepLast}
    )
  `;
  return result;
}

export type FetchedListFilters = {
  userId?: string;
  streamer?: string;
  type?: RollType;
  limit?: number; // default 100
  createdBefore?: string; // ISO
  idLt?: number;
};

export async function listFetched(filters: FetchedListFilters) {
  const prisma = getPrisma();
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 1000));

  const where: Prisma.FetchedRollWhereInput = {};

  if (filters.userId) where.userId = filters.userId;
  if (filters.streamer) where.streamer = filters.streamer;
  if (filters.type) where.type = filters.type;

  // Cursor pagination
  if (filters.createdBefore || filters.idLt) {
    const createdBefore = filters.createdBefore ? new Date(filters.createdBefore) : new Date('9999-12-31');
    const idLt = filters.idLt ?? Number.MAX_SAFE_INTEGER;
    
    where.OR = [
      { createdAt: { lt: createdBefore } },
      {
        createdAt: createdBefore,
        id: { lt: idLt },
      },
    ];
  }

  const rows = await prisma.fetchedRoll.findMany({
    where,
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit,
  });

  // Converter para formato esperado
  return rows.map((row: { id: any; userId: any; streamer: any; roll: any; type: any; data: any; createdAt: { toISOString: () => any; }; processedAt: { toISOString: () => any; }; }) => ({
    id: row.id,
    user_id: row.userId,
    streamer: row.streamer,
    roll: row.roll,
    type: row.type,
    data: row.data,
    created_at: row.createdAt.toISOString(),
    processed_at: row.processedAt.toISOString(),
  }));
}
