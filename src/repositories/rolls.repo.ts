import { RowDataPacket } from 'mysql2';
import { getDb } from '../db/mysql';

export type RollType = 'upgrade' | 'case';
export type RollState = 'queued' | 'processing' | 'failed';

export type RollRow = RowDataPacket & {
  id: number;
  user_id: string;
  roll: string;
  type: RollType;
  state: RollState;
  tries: number;
  created_at: string;
  updated_at: string | null;
};

export async function enqueueRoll(params: { userId: string; roll: string; type: RollType }) {
  const db = getDb();
  await db.execute(
    `INSERT INTO rolls (user_id, roll, type)
     VALUES (:userId, :roll, :type)
     ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
    params
  );
}

type ClaimOptions = { maxTries: number; batch: number };

export async function claimNextRolls(opts: ClaimOptions): Promise<RollRow[]> {
  const db = getDb();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Seguro e escalável com MySQL 8+: SKIP LOCKED
    const [rows] = await conn.query<RollRow[]>(
      `SELECT id, user_id, roll, type, state, tries, created_at, updated_at
       FROM rolls
       WHERE state = 'queued' AND tries < :maxTries
       ORDER BY created_at ASC, id ASC
       LIMIT :batch
       FOR UPDATE SKIP LOCKED`,
      { maxTries: opts.maxTries, batch: opts.batch }
    );

    if (rows.length === 0) {
      await conn.commit();
      return [];
    }

    const ids = rows.map(r => r.id);
    await conn.query(
      `UPDATE rolls
       SET state = 'processing', tries = tries + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );

    await conn.commit();
    return rows;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function markFailedOrRequeue(id: number, maxTries: number) {
  const db = getDb();
  // se já atingiu o maxTries, marca failed; do contrário volta para queued
  await db.execute(
    `UPDATE rolls
     SET state = IF(tries >= :maxTries, 'failed', 'queued'),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = :id`,
    { id, maxTries }
  );
}

export async function deleteFromQueue(id: number) {
  const db = getDb();
  await db.execute(`DELETE FROM rolls WHERE id = :id`, { id });
}

export type RollsListFilters = {
  state?: RollState;
  userId?: string;
  type?: RollType;
  limit?: number; // default 100
  createdBefore?: string; // ISO
  idLt?: number;
};

export async function listRolls(filters: RollsListFilters) {
  const db = getDb();
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 1000));

  const where: string[] = [];
  const params: any = {};

  if (filters.state) { where.push('state = :state'); params.state = filters.state; }
  if (filters.userId) { where.push('user_id = :userId'); params.userId = filters.userId; }
  if (filters.type) { where.push('type = :type'); params.type = filters.type; }

  let cursorSql = '';
  if (filters.createdBefore || filters.idLt) {
    cursorSql = 'AND (created_at < :createdBefore OR (created_at = :createdBefore AND id < :idLt))';
    params.createdBefore = filters.createdBefore ?? '9999-12-31 23:59:59';
    params.idLt = filters.idLt ?? 9_223_372_036_854_775;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')} ${cursorSql}` : (cursorSql ? `WHERE 1=1 ${cursorSql}` : '');

  const [rows] = await db.query<RollRow[]>(
    `SELECT id, user_id, roll, type, state, tries, created_at, updated_at
     FROM rolls
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT :limit`,
    { ...params, limit }
  );

  return rows;
}
