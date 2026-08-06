// Optional sample data: creates a demo building with flats and a few transactions.
import db, { toPaise } from './db.js';
import { recordPayment } from './services/finance.js';

const existing = db.prepare("SELECT id FROM buildings WHERE name='Green Residency (Demo)'").get();
if (existing) { console.log('Demo data already present.'); process.exit(0); }

const b = db.prepare(
  "INSERT INTO buildings (name, address, manager_name, contact) VALUES ('Green Residency (Demo)','Kolkata','Demo Manager','9000000000')"
).run();
const bid = b.lastInsertRowid;
const flats = [
  ['A-101', 580, 'R. Sen'], ['A-102', 580, 'S. Das'], ['B-201', 650, 'M. Roy'], ['B-202', 650, 'P. Ghosh'],
];
const now = new Date(); const m = now.getMonth() + 1, y = now.getFullYear();
for (const [num, amt, owner] of flats) {
  const f = db.prepare('INSERT INTO flats (building_id, number, monthly_amount, owner_name) VALUES (?,?,?,?)')
    .run(bid, num, toPaise(amt), owner);
  recordPayment({ flat_id: f.lastInsertRowid, month: m, year: y, amount: toPaise(amt === 580 ? 300 : amt),
    method: 'cash', paid_on: now.toISOString().slice(0,10), notes: 'Seed payment' });
}
db.prepare("INSERT INTO expenses (building_id, date, amount, category, method, paid_to) VALUES (?,?,?,?,?,?)")
  .run(bid, now.toISOString().slice(0,10), toPaise(1200), 'Sweeper / Cleaning', 'cash', 'Cleaning staff');
console.log('Seeded demo building #' + bid);
