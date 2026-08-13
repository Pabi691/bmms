import 'dotenv/config';
import db, { audit } from './db.js';
import { hashPassword } from './services/auth.js';

// Idempotent: creates the one Master Admin account from env vars if none
// exists yet. Runs automatically at server boot (see index.js) so a fresh
// install always has a way to log in — without silently creating a
// predictable default account when the operator forgot to set env vars.
export async function ensureMasterAdmin() {
  const existing = await db.prepare("SELECT id FROM users WHERE role='master_admin'").get();
  if (existing) return;

  const username = process.env.MASTER_ADMIN_USERNAME;
  const password = process.env.MASTER_ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn(
      '[auth] No Master Admin account exists yet, and MASTER_ADMIN_USERNAME/' +
      'MASTER_ADMIN_PASSWORD are not set — set them in server/.env and restart ' +
      '(or run `npm run seed:admin`) to create one.'
    );
    return;
  }

  const hash = await hashPassword(password);
  const info = await db.prepare(
    `INSERT INTO users (role, username, password_hash, full_name, must_change_password)
     VALUES ('master_admin', ?, ?, 'Master Admin', 0)`
  ).run(username, hash);
  await audit(null, 'create', 'user', info.lastInsertRowid, `Master Admin account "${username}" created`);
  console.log(`[auth] Master Admin account "${username}" created.`);
}
