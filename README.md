# IronMat Gym — Session Booking System

A gym session booking and door attendance application with strict capacity enforcement.

## Stack & Data Model Note (Under 10 Lines)
- Stack: Node.js, Express, SQLite (better-sqlite3), Vanilla JS, JWT, bcrypt.
- Users: id, name, email (unique), password_hash, role (member | admin).
- Sessions: id, date, start_hour, capacity (20), unique on (date, start_hour).
- Bookings: id, session_id, user_id, status (confirmed | cancelled | checked_in), code (unique), created_at.
- Waitlist: id, session_id, user_id, created_at, unique on (session_id, user_id).
- Concurrency Guarantee: Atomic SQLite transactions enforce the 20-mat invariant under concurrent requests.

## Assumptions
1. Gym operates in single local timezone matching the server.
2. Sessions are 1-hour slots on the hour (e.g. 09:00 - 10:00).
3. Members can cancel anytime prior to the session start time.
4. Auto-promotion takes the oldest waitlist record and promotes to confirmed atomically.
5. Check-in codes are unguessable 6-character alphanumeric tokens (no ambiguous chars).

## Test Credentials
- Staff / Admin: admin@gym.com / admin123
- Member 1: alice@test.com / member123 (Test Code: 7XKP2Q)
- Member 2: bob@test.com / member123
- Full Session Test: 17:00 (5:00 PM) today has 20 pre-filled dummy attendees to test waitlist.
