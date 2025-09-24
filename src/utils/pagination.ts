export type Cursor = {
  createdBefore?: string; // ISO
  idLt?: number;          // desempate
};

/**
 * Gera cláusulas e params para paginação por cursor usando (created_at DESC, id DESC).
 * Use o índice idx_rolls_state_created (state, created_at, id).
 */
export function buildCursorWhere(cursor?: Cursor) {
  if (!cursor?.createdBefore && !cursor?.idLt) return { sql: '', params: {} };
  return {
    sql: 'AND (created_at < :createdBefore OR (created_at = :createdBefore AND id < :idLt))',
    params: {
      createdBefore: cursor.createdBefore ?? '9999-12-31 23:59:59',
      idLt: cursor.idLt ?? 9_223_372_036_854_775 // grande o bastante
    }
  };
}
