require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is missing.');
  process.exit(1);
}

const CAPACITY = 20;

// Auto-seed if database is empty (Render cold-start persistence)
function autoSeedIfEmpty() {
  try {
    const count = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
    if (count === 0) {
      console.log("Empty database detected. Running initial seed...");
      require("./seed");
    }
  } catch (e) {}
}
autoSeedIfEmpty();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function generateCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return code;
}

function sessionStartTime(dateStr, startHour) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, startHour, 0, 0);
}

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });
  }
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token expired or invalid' } });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  next();
}

// ----------------- AUTH -----------------
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Fields must be strings' } });
  }
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (cleanName.length < 2 || !emailRegex.test(cleanEmail) || password.length < 6 || password.length > 72) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Validation failed (name min 2 chars, valid email, password 6-72 chars)' } });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'member')");
    const info = stmt.run(cleanName, cleanEmail, hash);
    const token = jwt.sign({ id: info.lastInsertRowid, name: cleanName, email: cleanEmail, role: 'member' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: info.lastInsertRowid, name: cleanName, email: cleanEmail, role: 'member' } });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: users.email')) {
      return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'Email already registered' } });
    }
    throw err;
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Email and password required' } });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
  }
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// ----------------- SESSIONS -----------------
app.get('/api/sessions', authenticate, (req, res) => {
  const { date } = req.query;
  let q = `
    SELECT s.*, 
      (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('confirmed', 'checked_in')) as booked_count,
      (SELECT COUNT(*) FROM waitlist w WHERE w.session_id = s.id) as waitlist_count,
      (SELECT COUNT(*) FROM bookings b2 WHERE b2.session_id = s.id AND b2.user_id = ? AND b2.status IN ('confirmed', 'checked_in')) as user_booked,
      (SELECT COUNT(*) FROM waitlist w2 WHERE w2.session_id = s.id AND w2.user_id = ?) as user_waitlisted
    FROM sessions s
  `;
  const p = [req.user.id, req.user.id];
  if (date) { q += ' WHERE s.date = ?'; p.push(date); }
  q += ' ORDER BY s.date ASC, s.start_hour ASC';

  const sessions = db.prepare(q).all(...p).map(s => {
    const startTime = sessionStartTime(s.date, s.start_hour);
    return {
      ...s,
      seats_remaining: Math.max(0, s.capacity - s.booked_count),
      is_full: s.booked_count >= s.capacity,
      has_started: new Date() >= startTime,
      user_booked: s.user_booked > 0,
      user_waitlisted: s.user_waitlisted > 0
    };
  });
  res.json({ sessions });
});

app.post('/api/sessions', authenticate, requireAdmin, (req, res) => {
  const { date, start_hour } = req.body;
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Date must look like YYYY-MM-DD' } });
  }

  // Strict calendar date validation (rejects invalid dates like 2026-02-31)
  const [y, m, d] = date.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(y, m - 1, d));
  if (
    parsedDate.getUTCFullYear() !== y ||
    parsedDate.getUTCMonth() !== m - 1 ||
    parsedDate.getUTCDate() !== d
  ) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Date is not a valid calendar date' } });
  }

  const h = Number(start_hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Start hour must be an integer between 0 and 23' } });
  }

  try {
    const info = db.prepare('INSERT INTO sessions (date, start_hour, capacity) VALUES (?, ?, ?)').run(date, h, CAPACITY);
    res.status(201).json({ session: { id: info.lastInsertRowid, date, start_hour: h, capacity: CAPACITY } });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: { code: 'SESSION_EXISTS', message: 'Session already exists at this date and hour' } });
    }
    throw err;
  }
});

app.get('/api/sessions/:id/bookings', authenticate, requireAdmin, (req, res) => {
  const sessionId = Number(req.params.id);
  const bookings = db.prepare(`
    SELECT b.id, b.status, b.code, b.created_at, u.name, u.email
    FROM bookings b JOIN users u ON b.user_id = u.id
    WHERE b.session_id = ? ORDER BY b.id ASC
  `).all(sessionId);
  res.json({ bookings });
});

// ----------------- BOOKING (ATOMIC) -----------------
app.post('/api/sessions/:id/book', authenticate, (req, res) => {
  const sessionId = Number(req.params.id);
  const userId = req.user.id;

  const bookTx = db.transaction(() => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { status: 404, data: { error: { code: 'NOT_FOUND', message: 'Session not found' } } };

    const startTime = sessionStartTime(session.date, session.start_hour);
    if (new Date() >= startTime) {
      return { status: 400, data: { error: { code: 'SESSION_STARTED', message: 'Session has already started' } } };
    }

    const count = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE session_id = ? AND status IN ('confirmed', 'checked_in')").get(sessionId).c;
    if (count >= session.capacity) {
      return { status: 409, data: { error: { code: 'SESSION_FULL', message: 'Session is full' } } };
    }

    const existing = db.prepare("SELECT id FROM bookings WHERE session_id = ? AND user_id = ? AND status IN ('confirmed', 'checked_in')").get(sessionId, userId);
    if (existing) {
      return { status: 409, data: { error: { code: 'ALREADY_BOOKED', message: 'You already have an active seat in this session' } } };
    }

    db.prepare('DELETE FROM waitlist WHERE session_id = ? AND user_id = ?').run(sessionId, userId);

    let code = null;
    let inserted = false;
    for (let attempts = 0; attempts < 5; attempts++) {
      code = generateCode();
      try {
        const info = db.prepare("INSERT INTO bookings (session_id, user_id, status, code) VALUES (?, ?, 'confirmed', ?)").run(sessionId, userId, code);
        inserted = true;
        return { status: 201, data: { booking: { id: info.lastInsertRowid, session_id: sessionId, status: 'confirmed', code } } };
      } catch (err) {
        if (!err.message.includes('UNIQUE constraint failed: bookings.code')) throw err;
      }
    }
    if (!inserted) {
      return { status: 500, data: { error: { code: 'CODE_COLLISION', message: 'Could not generate unique code' } } };
    }
  });

  const result = bookTx();
  res.status(result.status).json(result.data);
});

// ----------------- WAITLIST (STRICT FULL CHECK) -----------------
app.post('/api/sessions/:id/waitlist', authenticate, (req, res) => {
  const sessionId = Number(req.params.id);
  const userId = req.user.id;

  const waitTx = db.transaction(() => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { status: 404, data: { error: { code: 'NOT_FOUND', message: 'Session not found' } } };

    const startTime = sessionStartTime(session.date, session.start_hour);
    if (new Date() >= startTime) {
      return { status: 400, data: { error: { code: 'SESSION_STARTED', message: 'Session has already started' } } };
    }

    const count = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE session_id = ? AND status IN ('confirmed', 'checked_in')").get(sessionId).c;
    if (count < session.capacity) {
      return { status: 409, data: { error: { code: 'SESSION_NOT_FULL', message: 'Seats are still available; please book directly' } } };
    }

    const active = db.prepare("SELECT id FROM bookings WHERE session_id = ? AND user_id = ? AND status IN ('confirmed', 'checked_in')").get(sessionId, userId);
    if (active) {
      return { status: 409, data: { error: { code: 'ALREADY_BOOKED', message: 'You already have a confirmed seat' } } };
    }

    try {
      const info = db.prepare('INSERT INTO waitlist (session_id, user_id) VALUES (?, ?)').run(sessionId, userId);
      const pos = db.prepare('SELECT COUNT(*) as p FROM waitlist WHERE session_id = ? AND id <= ?').get(sessionId, info.lastInsertRowid).p;
      return { status: 201, data: { waitlist: { id: info.lastInsertRowid, session_id: sessionId, position: pos } } };
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return { status: 409, data: { error: { code: 'ALREADY_WAITLISTED', message: 'You are already on the waitlist' } } };
      }
      throw err;
    }
  });

  const result = waitTx();
  res.status(result.status).json(result.data);
});

app.delete('/api/sessions/:id/waitlist', authenticate, (req, res) => {
  const sessionId = Number(req.params.id);
  const userId = req.user.id;
  const info = db.prepare('DELETE FROM waitlist WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
  if (info.changes === 0) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not on waitlist for this session' } });
  }
  res.json({ ok: true, message: 'Removed from waitlist' });
});

// ----------------- CANCELLATION & AUTO-PROMOTE -----------------
app.post('/api/bookings/:id/cancel', authenticate, (req, res) => {
  const bookingId = Number(req.params.id);
  const userId = req.user.id;

  const cancelTx = db.transaction(() => {
    let booking;
    if (req.user.role === 'admin') {
      booking = db.prepare("SELECT b.*, s.date, s.start_hour FROM bookings b JOIN sessions s ON b.session_id = s.id WHERE b.id = ? AND b.status = 'confirmed'").get(bookingId);
    } else {
      booking = db.prepare("SELECT b.*, s.date, s.start_hour FROM bookings b JOIN sessions s ON b.session_id = s.id WHERE b.id = ? AND b.user_id = ? AND b.status = 'confirmed'").get(bookingId, userId);
    }

    if (!booking) {
      return { status: 404, data: { error: { code: 'NOT_FOUND', message: 'Active booking not found' } } };
    }

    const startTime = sessionStartTime(booking.date, booking.start_hour);
    if (new Date() >= startTime) {
      return { status: 400, data: { error: { code: 'SESSION_STARTED', message: 'Cannot cancel a session that has already started' } } };
    }

    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(bookingId);

    const nextWait = db.prepare('SELECT * FROM waitlist WHERE session_id = ? ORDER BY id ASC LIMIT 1').get(booking.session_id);
    if (nextWait) {
      db.prepare('DELETE FROM waitlist WHERE id = ?').run(nextWait.id);
      for (let attempts = 0; attempts < 5; attempts++) {
        const promoCode = generateCode();
        try {
          db.prepare("INSERT INTO bookings (session_id, user_id, status, code) VALUES (?, ?, 'confirmed', ?)").run(booking.session_id, nextWait.user_id, promoCode);
          break;
        } catch (err) {
          if (!err.message.includes('UNIQUE constraint failed')) throw err;
        }
      }
    }

    return { status: 200, data: { ok: true, cancelled_id: bookingId } };
  });

  const result = cancelTx();
  res.status(result.status).json(result.data);
});

// ----------------- MY BOOKINGS -----------------
app.get('/api/bookings/mine', authenticate, (req, res) => {
  const userId = req.user.id;
  const bookings = db.prepare(`
    SELECT b.*, s.date, s.start_hour 
    FROM bookings b JOIN sessions s ON b.session_id = s.id 
    WHERE b.user_id = ? ORDER BY s.date DESC, s.start_hour DESC
  `).all(userId).map(b => ({
    ...b,
    has_started: new Date() >= sessionStartTime(b.date, b.start_hour)
  }));

  const waitlists = db.prepare(`
    SELECT w.*, s.date, s.start_hour,
      (SELECT COUNT(*) FROM waitlist w2 WHERE w2.session_id = w.session_id AND w2.id <= w.id) as position
    FROM waitlist w JOIN sessions s ON w.session_id = s.id
    WHERE w.user_id = ? ORDER BY s.date ASC, s.start_hour ASC
  `).all(userId).map(w => ({
    ...w,
    has_started: new Date() >= sessionStartTime(w.date, w.start_hour)
  }));

  res.json({ bookings, waitlists });
});

// ----------------- CHECK-IN (STRICT HOUR WINDOW) -----------------
app.post('/api/checkin', authenticate, requireAdmin, (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Check-in code required' } });
  }

  const booking = db.prepare(`
    SELECT b.*, u.name as user_name, u.email as user_email, s.date, s.start_hour
    FROM bookings b JOIN users u ON b.user_id = u.id JOIN sessions s ON b.session_id = s.id 
    WHERE b.code = ?
  `).get(code.trim().toUpperCase());

  if (!booking) return res.status(404).json({ error: { code: 'INVALID_CODE', message: 'Invalid check-in code' } });
  if (booking.status === 'cancelled') return res.status(400).json({ error: { code: 'CANCELLED', message: 'Booking was cancelled' } });
  if (booking.status === 'checked_in') return res.status(409).json({ error: { code: 'ALREADY_USED', message: 'Code has already been used' } });

  const now = new Date();
  const startTime = sessionStartTime(booking.date, booking.start_hour);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

  if (now < startTime || now >= endTime) {
    return res.status(400).json({ error: { code: 'OUTSIDE_HOUR_WINDOW', message: 'Check-in is only permitted during the session hour' } });
  }

  db.prepare("UPDATE bookings SET status = 'checked_in' WHERE id = ?").run(booking.id);
  res.json({ ok: true, attendee: { name: booking.user_name, email: booking.user_email, session: `${booking.date} @ ${booking.start_hour}:00` } });
});

// Fallback & Error Handlers
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON payload' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'An internal server error occurred' } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`IronMat Gym live on http://localhost:${PORT}`));