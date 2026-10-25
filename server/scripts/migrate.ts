/** Applies pending migrations to the local SQLite database. */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrate } from '../sqlite';

if (existsSync('.env')) process.loadEnvFile('.env');
const path = process.env.DATABASE_PATH ?? 'data/eden-awards.sqlite';
mkdirSync(dirname(resolve(path)), { recursive: true });
const db = new DatabaseSync(path);
db.exec('PRAGMA foreign_keys = ON;');
const ran = migrate(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
db.close();
