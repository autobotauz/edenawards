/** Writes a consistent copy of the local SQLite database to backups/ (safe while the server runs). */
import { existsSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');
const path = process.env.DATABASE_PATH ?? 'data/eden-awards.sqlite';
if (!existsSync(path)) {
  console.error(`No database at ${path}`);
  process.exit(1);
}
const dir = resolve(process.env.BACKUP_DIR ?? 'backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(dir, `eden-awards-${stamp}.sqlite`);
const db = new DatabaseSync(path);
db.prepare('VACUUM INTO ?').run(target);
db.close();
console.log(`Backup written to ${target}`);
