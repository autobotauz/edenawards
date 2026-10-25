/**
 * Seeds the local database with sample data.
 *   npm run db:seed          seed an empty database
 *   npm run db:reset         delete the local database file and reseed
 *   npm run db:seed-sql      print the seed as SQL (for Cloudflare D1)
 */
import { existsSync, rmSync } from 'node:fs';
import { openSqlite } from '../sqlite';
import { seedStatements, toSqlScript, SEED_USERS } from '../seed';

if (existsSync('.env')) process.loadEnvFile('.env');
const args = new Set(process.argv.slice(2));
const now = Date.now();

if (args.has('--sql')) {
  process.stdout.write(toSqlScript(seedStatements(now)) + '\n');
  process.exit(0);
}

const path = process.env.DATABASE_PATH ?? 'data/eden-awards.sqlite';
if (args.has('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
}
const { raw, db } = openSqlite(path);
const count = (raw.prepare('SELECT COUNT(*) AS n FROM seasons').get() as { n: number }).n;
if (count > 0) {
  console.log('Database already has data. Use `npm run db:reset` to wipe it and reseed.');
  process.exit(0);
}
await db.batch(seedStatements(now));
console.log(`Seeded ${path}`);
console.log('Sample users (use "Dev login" on the site):');
for (const u of SEED_USERS) console.log(`  ${u.id}  ${u.globalName}`);
