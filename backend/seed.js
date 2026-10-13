const bcrypt = require('bcryptjs');
const db = require('./db');

console.log('Seeding IronMat Gym database...');
db.exec('DELETE FROM waitlist; DELETE FROM bookings; DELETE FROM sessions; DELETE FROM users;');

const adminHash = bcrypt.hashSync('admin123', 10);
db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
  .run('Gym Staff Admin', 'admin@gym.com', adminHash, 'admin');

const memberHash = bcrypt.hashSync('member123', 10);
const alice = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
  .run('Alice Smith', 'alice@test.com', memberHash, 'member');
const bob = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
  .run('Bob Jones', 'bob@test.com', memberHash, 'member');

const dummyIds = [];
for (let i = 1; i <= 20; i++) {
  const u = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(`Member ${i}`, `user${i}@test.com`, memberHash, 'member');
  dummyIds.push(u.lastInsertRowid);
}

const today = new Date().toISOString().split('T')[0];
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

const s1 = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, ?, ?)').run(today, 9, 20);
const s2 = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, ?, ?)').run(today, 11, 20);
const sFull = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, ?, ?)').run(today, 17, 20);
const s4 = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, ?, ?)').run(tomorrow, 10, 20);

dummyIds.forEach((uid, idx) => {
  const code = 'SEAT' + String(idx + 1).padStart(2, '0');
  db.prepare('INSERT INTO bookings (session_id, user_id, status, code) VALUES (?, ?, ?, ?)')
    .run(sFull.lastInsertRowid, uid, 'confirmed', code);
});

db.prepare('INSERT INTO bookings (session_id, user_id, status, code) VALUES (?, ?, ?, ?)')
  .run(s1.lastInsertRowid, alice.lastInsertRowid, 'confirmed', '7XKP2Q');

console.log('✓ Seed completed successfully!');
console.log('Admin: admin@gym.com / admin123');
console.log('Member: alice@test.com / member123');
