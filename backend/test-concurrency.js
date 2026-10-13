const http = require('http');
const db = require('./db');

console.log('=== Running Concurrency Verification (25 requests vs 20 capacity) ===');

// Create test session
const date = '2099-01-01';
db.prepare('DELETE FROM bookings WHERE session_id IN (SELECT id FROM sessions WHERE date = ?)').run(date);
db.prepare('DELETE FROM sessions WHERE date = ?').run(date);
const sess = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, 10, 20)').run(date);
const sessionId = sess.lastInsertRowid;

// Setup 25 test users
const userIds = [];
for (let i = 1; i <= 25; i++) {
  const email = `concurrency_user_${i}@test.com`;
  db.prepare('DELETE FROM users WHERE email = ?').run(email);
  const u = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, 'hash', 'member')").run(`User ${i}`, email);
  userIds.push(u.lastInsertRowid);
}

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'gym-super-secret-jwt-key-2026';
const tokens = userIds.map((id, i) => jwt.sign({ id, name: `User ${i}`, email: `u${i}@test.com`, role: 'member' }, JWT_SECRET));

function sendBooking(token) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: process.env.PORT || 3000,
      path: `/api/sessions/${sessionId}/book`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(500));
    req.end();
  });
}

async function run() {
  const results = await Promise.all(tokens.map(t => sendBooking(t)));
  const c201 = results.filter(r => r === 201).length;
  const c409 = results.filter(r => r === 409).length;

  console.log(`Results: ${c201} confirmed (201), ${c409} rejected (409)`);
  if (c201 === 20 && c409 === 5) {
    console.log('✓ PASS: Concurrency guarantee verified. Exactly 20 seats booked.');
    process.exit(0);
  } else {
    console.error('✗ FAIL: Concurrency invariant breached.');
    process.exit(1);
  }
}

run();
