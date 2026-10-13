require('dotenv').config({ path: __dirname + '/.env' });
const http = require('http');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is missing.');
  process.exit(1);
}

console.log('=== Running Concurrency Verification (25 requests vs 20 capacity) ===');

const date = '2099-01-01';
db.prepare('DELETE FROM bookings WHERE session_id IN (SELECT id FROM sessions WHERE date = ?)').run(date);
db.prepare('DELETE FROM sessions WHERE date = ?').run(date);
const sess = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, 10, 20)').run(date);
const sessionId = sess.lastInsertRowid;

const userIds = [];
for (let i = 1; i <= 25; i++) {
  const email = `concurrency_user_${i}@test.com`;
  db.prepare('DELETE FROM users WHERE email = ?').run(email);
  const u = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, 'hash', 'member')").run(`User ${i}`, email);
  userIds.push(u.lastInsertRowid);
}

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

function isServerAlive() {
  return new Promise((resolve) => {
    const testReq = http.request({ hostname: 'localhost', port: 3000, path: '/api/health', method: 'GET', timeout: 800 }, () => resolve(true));
    testReq.on('error', () => resolve(false));
    testReq.on('timeout', () => resolve(false));
    testReq.end();
  });
}

async function run() {
  let serverProcess = null;
  const alive = await isServerAlive();
  if (!alive) {
    serverProcess = spawn('node', ['server.js'], { cwd: __dirname, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1500));
  }

  try {
    const results = await Promise.all(tokens.map(t => sendBooking(t)));
    const c201 = results.filter(r => r === 201).length;
    const c409 = results.filter(r => r === 409).length;

    console.log(`Results: ${c201} confirmed (201), ${c409} rejected (409)`);
    if (c201 === 20 && c409 === 5) {
      console.log('✓ PASS: Concurrency guarantee verified. Exactly 20 seats booked.');
      process.exitCode = 0;
    } else {
      console.error('✗ FAIL: Concurrency invariant breached.');
      process.exitCode = 1;
    }
  } finally {
    if (serverProcess) serverProcess.kill();
  }
}

run();