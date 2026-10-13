# IronMat Gym: Session Booking System

A booking system for a gym that runs one-hour sessions with 20 mats each. Members book and cancel online, join a waitlist when a session is full, and show a code at the door. Staff check members in with that code.

**Live demo:** https://ironmat-gym.onrender.com
(Render free tier: the first load after idle can take about 50 seconds. The database is seeded automatically if it is empty.)

---

## Design note (stack and data model)

- Stack: Node.js + Express API, SQLite (better-sqlite3), vanilla JS single-page frontend served by the same server, JWT auth, bcrypt hashing.
- `users`: id, name, email (unique), password_hash, role (`member` | `admin`). Admins exist only through the seed or direct DB inserts, never through registration.
- `sessions`: id, date, start_hour, capacity (20). Unique on (date, start_hour). Sessions start on the hour and last one hour.
- `bookings`: id, session_id, user_id, status (`confirmed` | `cancelled` | `checked_in`), code (unique), created_at. A partial unique index allows only one active booking per member per session.
- `waitlist`: id, session_id, user_id, created_at. Unique on (session_id, user_id). Position is derived from `id` order, so it can never go out of order.
- Capacity: booking runs inside one `db.transaction` (count, compare, insert). better-sqlite3 is synchronous, so two requests cannot interleave and 20 never becomes 21.
- Cancel and auto-promote run in one transaction: cancel, take the oldest waitlist row, delete it, create the confirmed booking with a new code. Nobody is promoted into a session that has started.
- Check-in codes: 6 characters from a 32-character set (no 0/O/1/I), generated with `crypto.randomInt`, unique in the database, not sequential.

---

## Assumptions

1. The gym runs in a single time zone: the server's local time. Session start times are read in that zone.
2. Sessions are one-hour slots on the hour (for example 09:00 to 10:00). Two sessions cannot share a date and start hour.
3. Members can cancel until the session starts. Admins can cancel a booking on behalf of a member.
4. A member cannot be on the waitlist while the session has free seats, and cannot hold a booking and a waitlist place for the same session.
5. Auto-promotion takes the oldest waitlist entry and converts it to a confirmed booking in the same transaction as the cancellation.
6. Check-in works only during the session's own hour, only once, and never for a cancelled booking.
7. Capacity is a single constant (`CAPACITY` in `backend/server.js`), set to 20.
8. The UI layout and colour tokens were adapted from an earlier hackathon project (MediKiosk). Only styling and page structure were reused. The booking logic is written for this project.
9. Render free tier note: cold starts can take about 50 seconds, and the SQLite file may be reset on redeploy. An auto-seed runs on startup when the `users` table is empty, so test data returns.

---

## Setup and running locally

Requirements: Node.js 18 or newer.

```bash
cd backend
npm install
cp .env.example .env      # then set JWT_SECRET to a long random string
npm run seed              # creates test users and sessions (wipes existing data)
npm start                 # http://localhost:3000
```

The server serves the frontend too, so that is the only command you need.

Environment variables (`backend/.env`, never committed; see `backend/.env.example`):

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `JWT_SECRET` | Secret for signing tokens. Required: the server refuses to start without it. |

If the database is empty at startup, the seed runs automatically.

### Concurrency test

With 25 members booking the same 20-seat session at the same moment, exactly 20 must succeed and 5 must be rejected:

```bash
cd backend
npm run test:concurrency
```

Expected output: `Results: 20 confirmed (201), 5 rejected (409)` and `PASS`.

---

## Test credentials

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@gym.com | admin123 |
| Member | alice@test.com | member123 |
| Member | bob@test.com | member123 |

Seeded data (dates are relative to the day you run the seed):

- **Full session:** tomorrow at 17:00 has 20 confirmed bookings (members `user1@test.com` to `user20@test.com`, same password). Log in as Bob and use **Join Waitlist**. Then log in as `user1@test.com` and cancel: Bob is promoted automatically and gets a code.
- **Alice's booking:** tomorrow at 09:00, code `7XKP2Q`.
- **Open sessions:** tomorrow at 09:00 and the day after at 10:00.
- **Check-in test:** the seed also creates a session for the current hour, with Alice booked and code `NOW123`. It is valid only during that hour. To retest at any other time: as admin, create a session for the next hour, book it as a member, then enter the code on the admin page during that hour. (A started session cannot be booked, by design.)

---

## What the app does

### Pages (hash-routed, protected)

| Route | Who | What |
| --- | --- | --- |
| `#/landing`, `#/auth` | Public | Choose portal, sign in, register |
| `#/sessions` | Logged in | Sessions with seats left, date filter, Book / Join Waitlist / Leave Waitlist, refreshes every 5 seconds |
| `#/mine` | Member | My bookings with codes, cancel, my waitlist places with position |
| `#/admin` | Admin only | Create a session, view a session's bookings, check a member in by code |

A member who opens `#/admin` is sent back to sessions. The server also enforces this (below), because hiding a page is not authorization.

### API

All errors use one format: `{ "error": { "code": "SESSION_FULL", "message": "..." } }`.

| Method and path | Access | Notes |
| --- | --- | --- |
| `POST /api/auth/register` | Public | Name, email, password. 409 if the email exists. |
| `POST /api/auth/login` | Public | Returns a token and the user |
| `GET /api/sessions?date=YYYY-MM-DD` | Logged in | Seats remaining, waitlist count, whether you are booked or waitlisted |
| `POST /api/sessions` | Admin | Create a session (date, start_hour) |
| `GET /api/sessions/:id/bookings` | Admin | All bookings for a session with member names |
| `POST /api/sessions/:id/book` | Logged in | 201, or 409 if full or already booked, 400 if started |
| `POST /api/sessions/:id/waitlist` | Logged in | Only when full. 409 if already on it |
| `DELETE /api/sessions/:id/waitlist` | Logged in | Leave the waitlist |
| `POST /api/bookings/:id/cancel` | Owner or admin | Cancels, then promotes the oldest waitlisted member |
| `GET /api/bookings/mine` | Logged in | Only your own bookings and waitlist places |
| `POST /api/checkin` | Admin | Validates the code and the session hour |

Status codes: 400 invalid input, 401 not logged in, 403 wrong role, 404 not found, 409 conflict (full session, duplicate booking or waitlist place, used code).

### How the key rules are enforced

- **Never 21 people:** the count and the insert happen inside one database transaction in the booking route (`bookTx`). The partial unique index `one_active_booking` also stops a duplicate active booking at the database level.
- **Waitlist cascade:** the cancel route marks the booking cancelled and promotes the first waitlisted member in the same transaction. A started session cannot be cancelled, so nobody is promoted into one.
- **Check-in:** the code must exist, must not be cancelled or already used, and the current time must fall inside the session's hour.
- **Role isolation:** every non-public route runs the `authenticate` middleware. Admin routes add `requireAdmin`. A member cannot cancel someone else's booking: it returns 404 for a booking they do not own. Members only receive their own data.
- **Validation:** every route checks types and formats on the server (strings, email format, password 6 to 72 characters, strict calendar dates such as rejecting 2026-02-31, integer start hour 0 to 23). A global error handler returns JSON and never leaks stack traces. Passwords are hashed with bcrypt.
- **Frontend behaviour:** booking updates the seat count immediately and rolls it back if the server refuses. Buttons are disabled while a request is in flight. Forms validate inline and the server validates independently. Loading, empty and error states are shown, and a 401 sends the user back to sign in.

---

## Project layout

```
backend/
  server.js              routes, auth middleware, transactions, error handler
  db.js                  schema and constraints
  seed.js                test users and sessions
  test-concurrency.js    25 parallel bookings against 20 seats
  .env.example
frontend/
  index.html  app.js  style.css
```

## Known limitations

- SQLite on Render's free tier is not durable across redeploys (the auto-seed restores test data).
- No rate limiting, password reset or email verification.
- Tokens last 7 days and are stored in `localStorage`.
- Time zone is the server's single local zone.