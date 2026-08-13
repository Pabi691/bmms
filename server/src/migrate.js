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

  // payments.category/is_adjustment/custom_title/batch_id and
  // advance_tx.category and expenses.source_payment_id and
  // payment_submissions.batch_id were added for a same-day multi-category
  // "adjustment" design that was superseded (before shipping) by the
  // Resident Credit Ledger below. Deliberately not migrated here any more —
  // an already-migrated dev DB just keeps those columns, unused and
  // harmless, same as the still-present-but-unused flat_charges table.

  { table: 'expenses', column: 'is_adjustment', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'expenses', column: 'source_credit_id', ddl: 'INTEGER',
    index: 'CREATE INDEX IF NOT EXISTS idx_expenses_source_credit ON expenses(source_credit_id)' },

  { table: 'advance_tx', column: 'source', ddl: "TEXT NOT NULL DEFAULT 'bank'",
    index: 'CREATE INDEX IF NOT EXISTS idx_advance_flat_source ON advance_tx(flat_id, source)' },
  { table: 'advance_tx', column: 'resident_credit_id', ddl: 'INTEGER',
    index: 'CREATE INDEX IF NOT EXISTS idx_advance_resident_credit ON advance_tx(resident_credit_id)' },

  { table: 'payment_submissions', column: 'bank_amount', ddl: 'INTEGER' },
  { table: 'payment_submissions', column: 'adjustment_category', ddl: 'TEXT' },
  { table: 'payment_submissions', column: 'adjustment_amount', ddl: 'INTEGER' },
  { table: 'payment_submissions', column: 'adjustment_custom_title', ddl: 'TEXT' },
  { table: 'payment_submissions', column: 'resident_credit_id', ddl: 'INTEGER',
    index: 'CREATE INDEX IF NOT EXISTS idx_paysub_resident_credit ON payment_submissions(resident_credit_id)' },
];

export async function runMigrations(db) {
  for (const { table, column, ddl, index } of MIGRATIONS) {
    const cols = await db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = cols.some((c) => c.name === column);
    if (!exists) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
    if (index) await db.exec(index);
  }
  // bank_amount can't carry a constant DEFAULT (it must equal the row's own
  // pre-existing `amount`) — backfill every submission that predates the
  // Resident Credit Ledger so it stays approvable under the new
  // bank_amount/adjustment_amount split. Idempotent: once backfilled, no
  // rows match `bank_amount IS NULL` again.
  await db.exec('UPDATE payment_submissions SET bank_amount = amount WHERE bank_amount IS NULL');
}
