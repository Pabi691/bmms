// Creates one demo Building Admin + one demo Resident login for the
// "Green Residency (Demo)" building created by seed.js, so the whole
// role-based flow can be clicked through manually without going through
// the Master Admin console first. Does not touch seed.js itself.
import 'dotenv/config';
import db, { audit } from './db.js';
import { hashPassword } from './services/auth.js';

async function run() {
  const building = await db.prepare("SELECT * FROM buildings WHERE name='Green Residency (Demo)'").get();
  if (!building) {
    console.log('No demo building found — run `npm run seed` first.');
    return;
  }

  const existingAdmin = await db.prepare("SELECT id FROM users WHERE building_id=? AND role='building_admin'").get(building.id);
  if (!existingAdmin) {
    const pw = 'DemoAdmin123';
    const hash = await hashPassword(pw);
    const info = await db.prepare(
      `INSERT INTO users (role, username, password_hash, full_name, building_id, must_change_password)
       VALUES ('building_admin', 'demoadmin', ?, 'Demo Building Admin', ?, 0)`
    ).run(hash, building.id);
    await audit(building.id, 'create', 'user', info.lastInsertRowid, 'Demo building admin seeded', null);
    console.log(`Demo Building Admin — username: demoadmin  password: ${pw}`);
  } else {
    console.log('Demo Building Admin already exists (username: demoadmin).');
  }

  const flat = await db.prepare('SELECT * FROM flats WHERE building_id=? ORDER BY id LIMIT 1').get(building.id);
  if (flat) {
    const existingResident = await db.prepare("SELECT id FROM users WHERE flat_id=? AND role='resident'").get(flat.id);
    if (!existingResident) {
      const pw = 'DemoResident123';
      const hash = await hashPassword(pw);
      const info = await db.prepare(
        `INSERT INTO users (role, username, password_hash, full_name, building_id, flat_id, must_change_password)
         VALUES ('resident', 'demoresident', ?, ?, ?, ?, 0)`
      ).run(hash, flat.owner_name || 'Demo Resident', building.id, flat.id);
      await audit(building.id, 'create', 'user', info.lastInsertRowid, `Demo resident seeded for flat ${flat.number}`, null);
      console.log(`Demo Resident (flat ${flat.number}) — username: demoresident  password: ${pw}`);
    } else {
      console.log('Demo Resident already exists (username: demoresident).');
    }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
