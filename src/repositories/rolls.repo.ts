import { getPrisma, type Prisma } from '../db/prisma.js';

export type RollType = 'upgrade' | 'case';
export type RollState = 'queued' | 'processing' | 'failed';

export type RollRow = {
  id: number;
  userId: string;
  streamer: string;
  roll: string;
  type: RollType;
  state: RollState;
  tries: number;
  createdAt: Date;
  updatedAt: Date | null;
};

export async function enqueueRoll(params: { userId: string; streamer: string; roll: string; type: RollType }) {
  const prisma = getPrisma();
  await prisma.roll.upsert({
    where: {
      uniq_roll_per_user_streamer: {
        userId: params.userId,
        roll: params.roll,
        type: params.type,
        streamer: params.streamer,
      },
    },
    update: {
      updatedAt: new Date(),
    },
    create: {
      userId: params.userId,
      streamer: params.streamer,
      roll: params.roll,
      type: params.type,
    },
  });
}

type ClaimOptions = { maxTries: number; batch: number };

export async function claimNextRolls(opts: ClaimOptions): Promise<RollRow[]> {
  const prisma = getPrisma();
  
  // PostgreSQL usa SKIP LOCKED para processamento concorrente seguro
  // Usamos $transaction com $queryRaw para garantir atomicidade
  return await prisma.$transaction(async (tx) => {
    const result = await tx.$queryRaw<Array<{
      id: number;
      user_id: string;
      streamer: string;
      roll: string;
      type: string;
      state: string;
      tries: number;
      created_at: Date;
      updated_at: Date | null;
    }>>`
      SELECT id, user_id, streamer, roll, type, state, tries, created_at, updated_at
      FROM rolls
      WHERE state = 'queued' AND tries < ${opts.maxTries}
      ORDER BY created_at ASC, id ASC
      LIMIT ${opts.batch}
      FOR UPDATE SKIP LOCKED
    `;

    if (result.length === 0) {
      return [];
    }

    const ids = result.map((r: { id: any; }) => r.id);
    
    await tx.roll.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        state: 'processing',
        tries: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    // Converter para formato esperado
    return result.map((r: { id: any; user_id: any; streamer: any; roll: any; type: string; state: string; tries: any; created_at: any; updated_at: any; }) => ({
      id: r.id,
      userId: r.user_id,
      streamer: r.streamer,
      roll: r.roll,
      type: r.type as RollType,
      state: r.state as RollState,
      tries: r.tries,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
}

export async function markFailedOrRequeue(id: number, maxTries: number) {
  const prisma = getPrisma();
  
  // Busca o roll atual para verificar tries
  const roll = await prisma.roll.findUnique({
    where: { id },
    select: { tries: true },
  });

  if (!roll) return;

  await prisma.roll.update({
    where: { id },
    data: {
      state: roll.tries >= maxTries ? 'failed' : 'queued',
      updatedAt: new Date(),
    },
  });
}

export async function deleteFromQueue(id: number) {
  const prisma = getPrisma();
  await prisma.roll.delete({
    where: { id },
  });
}

export type RollsListFilters = {
  state?: RollState;
  userId?: string;
  streamer?: string;
  type?: RollType;
  limit?: number; // default 100
  createdBefore?: string; // ISO
  idLt?: number;
};

export async function listRolls(filters: RollsListFilters) {
  const prisma = getPrisma();
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 1000));

  const where: Prisma.RollWhereInput = {};

  if (filters.state) where.state = filters.state;
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

  const rows = await prisma.roll.findMany({
    where,
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit,
  });

  // Converter para formato esperado
  return rows.map((row) => ({
    id: row.id,
    user_id: row.userId,
    streamer: row.streamer,
    roll: row.roll,
    type: row.type,
    state: row.state,
    tries: row.tries,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt?.toISOString() ?? null,
  }));
}
