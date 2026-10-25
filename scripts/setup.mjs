// First-run setup: creates .env from the example (if missing) and seeds the local database.
import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example (dev login enabled, sample admin 100000000000000001).');
} else {
  console.log('.env already exists; leaving it unchanged.');
}
const r = spawnSync('npm', ['run', 'db:seed'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('\nReady. Start the app with:  npm run dev   then open http://localhost:5173');
