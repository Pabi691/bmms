// Lightweight column migrator. schema.sql's `CREATE TABLE IF NOT EXISTS`
// can create brand-new tables idempotently, but it can't add a column to a
// table that already exists on disk — SQLite has no `ADD COLUMN IF NOT
// EXISTS`. This runs once at boot, checks PRAGMA table_info, and only
// applies the ALTER when the column is actually missing.
//
// No inline REFERENCES/CHECK on these ALTER-added columns: SQLite's ADD
// COLUMN support for constraints is version-sensitive, so integrity here is
// enforced in application code instead. That's a deliberate trade-off, not
// an oversight.
const MIGRATIONS = [
  { table: 'buildings', column: 'status', ddl: "TEXT NOT NULL DEFAULT 'active'", index: 'CREATE INDEX IF NOT EXISTS idx_buildings_status ON buildings(status)' },
  { table: 'buildings', column: 'bank_account_name', ddl: 'TEXT' },
  { table: 'buildings', column: 'bank_account_number', ddl: 'TEXT' },
  { table: 'buildings', column: 'bank_ifsc', ddl: 'TEXT' },
  { table: 'buildings', column: 'bank_upi_id', ddl: 'TEXT' },
  { table: 'buildings', column: 'bank_qr_path', ddl: 'TEXT' },
  { table: 'audit_logs', column: 'actor_user_id', ddl: 'INTEGER', index: 'CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id)' },
  { table: 'audit_logs', column: 'actor_role', ddl: 'TEXT' },
];

export function runMigrations(db) {
  for (const { table, column, ddl, index } of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = cols.some((c) => c.name === column);
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
    if (index) db.exec(index);
  }
}
