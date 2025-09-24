import { RowDataPacket } from 'mysql2';
import { getDb } from '../db/mysql';
import type { RollType } from './rolls.repo';

export type FetchedRow = RowDataPacket &{
  id: number;
  user_id: string;
  roll: string;
  type: RollType;
  data: any;
  created_at: string;
  processed_at: string;
};

export async function insertFetched(params: {
  userId: string;
  roll: string;
  type: RollType;
  data: any;
}) {
  const db = getDb();
  await db.execute(
    `INSERT INTO fetched_rolls (user_id, roll, type, data)
     VALUES (:userId, :roll, :type, CAST(:data AS JSON))
     ON DUPLICATE KEY UPDATE data = VALUES(data), processed_at = CURRENT_TIMESTAMP`,
    { ...params, data: JSON.stringify(params.data) }
  );
}

export type FetchedListFilters = {
  userId?: string;
  type?: RollType;
  limit?: number; // default 100
  createdBefore?: string; // ISO
  idLt?: number;
};

export async function listFetched(filters: FetchedListFilters) {
  const db = getDb();
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 1000));

  const where: string[] = [];
  const params: any = {};

  if (filters.userId) { where.push('user_id = :userId'); params.userId = filters.userId; }
  if (filters.type) { where.push('type = :type'); params.type = filters.type; }

  let cursorSql = '';
  if (filters.createdBefore || filters.idLt) {
    cursorSql = 'AND (created_at < :createdBefore OR (created_at = :createdBefore AND id < :idLt))';
    params.createdBefore = filters.createdBefore ?? '9999-12-31 23:59:59';
    params.idLt = filters.idLt ?? 9_223_372_036_854_775;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')} ${cursorSql}` : (cursorSql ? `WHERE 1=1 ${cursorSql}` : '');

  const [rows] = await db.query<FetchedRow[]>(
    `SELECT id, user_id, roll, type, data, created_at, processed_at
     FROM fetched_rolls
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT :limit`,
    { ...params, limit }
  );
  return rows;
}
