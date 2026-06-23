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
  
  // Fair round-robin: pega 1 roll por streamer distinto (o mais antigo de cada),
  // depois limita ao batch e aplica SKIP LOCKED para segurança concorrente.
  // Isso impede que falhas de um streamer atrasem os demais.
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
      SELECT r.id, r.user_id, r.streamer, r.roll, r.type, r.state, r.tries, r.created_at, r.updated_at
      FROM rolls r
      WHERE r.id IN (
        SELECT DISTINCT ON (streamer) id
        FROM rolls
        WHERE state = 'queued' AND tries < ${opts.maxTries}
        ORDER BY streamer, created_at ASC, id ASC
      )
      ORDER BY r.created_at ASC, r.id ASC
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

/** Remove todos os rolls com state = 'failed'. Retorna o número deletado. */
export async function deleteAllFailedRolls(): Promise<number> {
  const prisma = getPrisma();
  const result = await prisma.roll.deleteMany({ where: { state: 'failed' } });
  return result.count;
}

export async function countRollsByState(state: RollState): Promise<number> {
  const prisma = getPrisma();
  return prisma.roll.count({ where: { state } });
}

/** Devolve processing travados (sem heartbeat em updated_at) para queued. */
export async function releaseStaleProcessing(olderThanMinutes: number): Promise<number> {
  if (olderThanMinutes <= 0) return 0;
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const result = await prisma.roll.updateMany({
    where: {
      state: 'processing',
      updatedAt: { lt: cutoff },
    },
    data: {
      state: 'queued',
      updatedAt: new Date(),
    },
  });
  return result.count;
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
