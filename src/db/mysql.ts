import mysql from 'mysql2/promise';
import { ENV } from '../config/env';

let pool: mysql.Pool | null = null;

export function getDb() {
  if (!pool) {
    pool = mysql.createPool({
      host: ENV.MYSQL_HOST,
      port: ENV.MYSQL_PORT,
      user: ENV.MYSQL_USER,
      password: ENV.MYSQL_PASSWORD,
      database: ENV.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      decimalNumbers: true
    });
  }
  return pool;
}

export type Db = ReturnType<typeof getDb>;
