const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function generateCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars.charAt(crypto.randomInt(0, chars.length));
  return c;
}

console.log('Seeding IronMat Gym database with clean future test data...');
db.exec('DELETE FROM waitlist; DELETE FROM bookings; DELETE FROM sessions; DELETE FROM users;');

const adminHash = bcrypt.hashSync('admin123', 10);
db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
  .run('Gym Staff Admin', 'admin@gym.com', adminHash);

const memberHash = bcrypt.hashSync('member123', 10);
const alice = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'member')")
  .run('Alice Smith', 'alice@test.com', memberHash);
const bob = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'member')")
  .run('Bob Jones', 'bob@test.com', memberHash);

const dummyIds = [];
for (let i = 1; i <= 20; i++) {
  const u = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'member')")
    .run(`Member ${i}`, `user${i}@test.com`, memberHash);
  dummyIds.push(u.lastInsertRowid);
}

const now = new Date();
const today = formatLocalDate(now);
const tomorrow = formatLocalDate(new Date(now.getTime() + 86400000));
const dayAfter = formatLocalDate(new Date(now.getTime() + 86400000 * 2));

// 1. Session right now (for live check-in test)
const currentHour = now.getHours();
const sCurrent = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, ?, 20)').run(today, currentHour);
db.prepare("INSERT INTO bookings (session_id, user_id, status, code) VALUES (?, ?, 'confirmed', 'NOW123')")
  .run(sCurrent.lastInsertRowid, alice.lastInsertRowid);

// 2. Future Sessions tomorrow
const s1 = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, 9, 20)').run(tomorrow);
const sFull = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, 17, 20)').run(tomorrow); // 5 PM Full
const s3 = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, 10, 20)').run(dayAfter);

// Fill sFull with 20 distinct random codes
dummyIds.forEach(uid => {
  db.prepare("INSERT INTO bookings (session_id, user_id, status, code) VALUES (?, ?, 'confirmed', ?)")
    .run(sFull.lastInsertRowid, uid, generateCode());
});

// Alice pre-booked into tomorrow 9 AM session
db.prepare("INSERT INTO bookings (session_id, user_id, status, code) VALUES (?, ?, 'confirmed', '7XKP2Q')")
  .run(s1.lastInsertRowid, alice.lastInsertRowid);

console.log('✓ Seed completed successfully!');
console.log('Live Check-in Test Code (valid right now): NOW123');
console.log('Tomorrow Test Code: 7XKP2Q');
