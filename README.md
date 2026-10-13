# IronMat Gym — Session Booking System

A gym session booking and door attendance application with strict capacity enforcement.

## Stack & Data Model Note (Under 10 Lines)
- Stack: Node.js, Express, SQLite (better-sqlite3), Vanilla JS, JWT, bcrypt.
- Users: id, name, email (unique), password_hash, role (member | admin).
- Sessions: id, date, start_hour, capacity (20), unique on (date, start_hour).
- Bookings: id, session_id, user_id, status (confirmed | cancelled | checked_in), code (unique), created_at.
- Waitlist: id, session_id, user_id, created_at, unique on (session_id, user_id).
- Concurrency Guarantee: Synchronous atomic SQLite transactions guarantee the 20-mat invariant under concurrent requests.

## Assumptions
1. Gym operates in single local timezone matching the server.
2. Sessions are 1-hour slots on the hour (e.g. 09:00 - 10:00).
3. Members can cancel anytime prior to session start; admins can cancel on behalf of members.
4. Auto-promotion takes the oldest waitlist record and converts it to confirmed atomically.
5. Check-in is strictly valid only during the session active 1-hour window.
6. Check-in codes are unguessable 6-character alphanumeric tokens (excluding ambiguous chars 0/O).
7. UI architecture, color palette, and layout tokens adapted from previous hackathon design exploration.

## Setup & Running Locally
cd backend
npm install
node seed.js
npm start

## Running Concurrency Verification Test
cd backend
npm run test:concurrency

## Test Credentials
- Staff / Admin: admin@gym.com / admin123
- Member 1 (Live Session Booking): alice@test.com / member123 (Check-in Code for current hour: NOW123)
- Member 2 (Tomorrow Pre-booked): alice@test.com / member123 (Check-in Code: 7XKP2Q)
- Full Session Test: Tomorrow at 17:00 (5:00 PM) has 20 pre-filled dummy attendees to test waitlist behavior.
- Live URL: https://ironmat-gym.onrender.com
