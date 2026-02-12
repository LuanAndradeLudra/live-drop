#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const ENV = {
  MYSQL_HOST: process.env.MYSQL_HOST,
  MYSQL_PORT: process.env.MYSQL_PORT || '3306',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE,
  MYSQL_USER: process.env.MYSQL_USER,
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
};

// Valida variáveis
const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
for (const key of required) {
  if (!ENV[key]) {
    console.error(`[migrate] Missing required env var: ${key}`);
    process.exit(1);
  }
}

const migrationFile = process.argv[2] || 'all';

function runMigration(file) {
  const filePath = join(rootDir, 'migrations', file);
  console.log(`[migrate] Running: ${file}`);
  
  try {
    const sql = readFileSync(filePath, 'utf-8');
    
    const cmd = [
      'mysql',
      `-u${ENV.MYSQL_USER}`,
      `-h${ENV.MYSQL_HOST}`,
      `-P${ENV.MYSQL_PORT}`,
      ENV.MYSQL_DATABASE
    ].join(' ');
    
    execSync(cmd, {
      input: sql,
      stdio: 'inherit',
      env: { 
        ...process.env,
        MYSQL_PWD: ENV.MYSQL_PASSWORD
      }
    });
    
    console.log(`[migrate] ✓ ${file} completed`);
  } catch (err) {
    console.error(`[migrate] ✗ ${file} failed:`, err.message);
    process.exit(1);
  }
}

if (migrationFile === 'all') {
  runMigration('001_init.sql');
  runMigration('002_add_streamer.sql');
  console.log('[migrate] All migrations completed');
} else {
  runMigration(migrationFile);
}

