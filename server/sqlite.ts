/**
 * Node.js SQLite setup (built-in node:sqlite, no native dependencies).
 * Applies the versioned migrations in /migrations, tracking them in the same
 * `d1_migrations` table that Wrangler uses for D1, so both stay comparable.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqliteDb, type Db, type SyncSqlite } from './db';

const here = dirname(fileURLToPath(import.meta.url));

/** Finds the migrations folder whether running from source (server/) or the bundle (dist/server/). */
export function migrationsDir(): string {
  for (const candidate of [resolve(here, '../migrations'), resolve(here, '../../migrations'), resolve('migrations')]) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error('migrations directory not found');
}

export function migrate(db: DatabaseSync, dir = migrationsDir()): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT name FROM d1_migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
      ran.push(file);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return ran;
}

export interface OpenedDb {
  raw: DatabaseSync;
  db: Db;
}

export function openSqlite(path = ':memory:'): OpenedDb {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');
  migrate(raw);
  return { raw, db: sqliteDb(raw as unknown as SyncSqlite) };
}
