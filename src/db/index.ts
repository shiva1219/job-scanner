import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA_VERSION = 1;
const DEFAULT_PATH = resolve(process.cwd(), 'data/scanner.db');

/** Opens the database, switches on foreign keys, and applies the schema if it is new. */
export function openDb(path = process.env.SCANNER_DB ?? DEFAULT_PATH): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const current = db.pragma('user_version', { simple: true }) as number;
  if (current < SCHEMA_VERSION) {
    const sql = readFileSync(resolve(process.cwd(), 'db/schema.sql'), 'utf8');
    db.exec(sql);
  }
  return db;
}
