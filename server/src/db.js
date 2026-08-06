import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DB_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'bmms.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialise / migrate schema (idempotent).
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
runMigrations(db);

// ---- money helpers: rupees (API) <-> paise (DB) ----
export const toPaise = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error('Invalid amount'), { status: 400 });
  return Math.round(n * 100);
};
export const toRupees = (p) => Math.round(Number(p || 0)) / 100;

// actorUserId is optional and trailing so every existing call site (seed.js
// included) keeps working unchanged; actor_role is denormalized at write
// time so it still means something even if the user is later deleted.
export const audit = (building_id, action, entity, entity_id, detail = '', actorUserId = null) => {
  const actorRole = actorUserId
    ? db.prepare('SELECT role FROM users WHERE id=?').get(actorUserId)?.role || null
    : null;
  db.prepare(
    'INSERT INTO audit_logs (building_id, action, entity, entity_id, detail, actor_user_id, actor_role) VALUES (?,?,?,?,?,?,?)'
  ).run(building_id ?? null, action, entity, entity_id ?? null, detail, actorUserId, actorRole);
};

export default db;
