import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL env var is required');

const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Normalizes a libSQL row (a Row proxy) into a plain object so the rest of
// the app can keep doing `{ ...row }` / `JSON` on it exactly like it did
// with better-sqlite3's plain objects.
const plain = (row) => (row ? { ...row } : row);

// Wraps either the top-level client or an open transaction with the same
// `.prepare(sql).get/all/run(...args)` shape the codebase already uses
// throughout — every call site just gains an `await`, nothing else changes.
function wrap(exec) {
  return {
    prepare(sql) {
      return {
        async get(...args) {
          const r = await exec.execute({ sql, args });
          return plain(r.rows[0]);
        },
        async all(...args) {
          const r = await exec.execute({ sql, args });
          return r.rows.map(plain);
        },
        async run(...args) {
          const r = await exec.execute({ sql, args });
          return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
        },
      };
    },
    async exec(sql) {
      await exec.execute(sql);
    },
  };
}

const db = wrap(client);

// Opens a real libSQL transaction and returns it wrapped in the same
// `.prepare().get/all/run()` shape, plus commit/rollback. Every
// finance.js operation that needs atomicity takes this `tx` as its first
// argument instead of each opening its own transaction — libSQL, unlike
// better-sqlite3, has no notion of nested/savepoint transactions on a
// single call, so only the outermost route handler ever opens one.
db.transaction = async () => {
  const t = await client.transaction('write');
  return { ...wrap(t), commit: () => t.commit(), rollback: () => t.rollback() };
};

// ---- schema bootstrap (idempotent, same as before) ----
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
await client.executeMultiple(schema);
await runMigrations(db);

// ---- money helpers: rupees (API) <-> paise (DB) ----
export const toPaise = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error('Invalid amount'), { status: 400 });
  return Math.round(n * 100);
};
export const toRupees = (p) => Math.round(Number(p || 0)) / 100;

// actorUserId is optional; actor_role is denormalized at write time so it
// still means something even if the user is later deleted. `x` is the
// executor (plain `db` by default, or an open `tx` when called from inside
// one of finance.js's transactional operations) so the audit row commits
// atomically with the operation it's logging instead of racing it on a
// separate libSQL session.
export const audit = async (building_id, action, entity, entity_id, detail = '', actorUserId = null, x = db) => {
  const actorRole = actorUserId
    ? (await x.prepare('SELECT role FROM users WHERE id=?').get(actorUserId))?.role || null
    : null;
  await x.prepare(
    'INSERT INTO audit_logs (building_id, action, entity, entity_id, detail, actor_user_id, actor_role) VALUES (?,?,?,?,?,?,?)'
  ).run(building_id ?? null, action, entity, entity_id ?? null, detail, actorUserId, actorRole);
};

export default db;
