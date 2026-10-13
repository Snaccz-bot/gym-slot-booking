let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user') || 'null');
let isRegister = false;
let pollTimer = null;

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function toggleAuth(e) {
  e.preventDefault(); isRegister = !isRegister;
  document.getElementById('auth-title').innerText = isRegister ? 'Register Account' : 'Member Sign In';
  document.getElementById('field-name').classList.toggle('hidden', !isRegister);
  document.getElementById('auth-btn').innerText = isRegister ? 'Register →' : 'Sign In →';
  document.getElementById('auth-toggle').innerText = isRegister ? 'Already have an account? Sign in' : 'Need an account? Register here';
}

async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name').value;
  const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
  const body = isRegister ? { name, email, password } : { email, password };
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed');
    token = data.token; user = data.user;
    localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user));
    showToast(`Welcome, ${user.name}!`); updateNav(); location.hash = '#/sessions';
  } catch (err) { showToast(err.message); }
}

function logout() {
  localStorage.clear(); token = null; user = null;
  clearInterval(pollTimer); updateNav(); location.hash = '#/auth';
}

function updateNav() {
  const auth = !!token;
  document.getElementById('nav-logout').classList.toggle('hidden', !auth);
  document.getElementById('nav-mine').classList.toggle('hidden', !auth);
  document.getElementById('nav-admin').classList.toggle('hidden', !(auth && user?.role === 'admin'));
}

async function loadSessions() {
  if (!token) return;
  const date = document.getElementById('filter-date').value;
  try {
    const res = await fetch(`/api/sessions?date=${date}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    document.getElementById('sessions-grid').innerHTML = (data.sessions || []).map(s => `
      <div class="session-card">
        <div>
          <span class="badge ${s.seats_remaining > 0 ? 'badge-avail' : 'badge-full'}">${s.seats_remaining > 0 ? `${s.seats_remaining} MATS AVAILABLE` : 'SESSION FULL'}</span>
          <h3 class="serif" style="color:var(--teal);margin-bottom:4px;">${s.date}</h3>
          <p style="font-size:13px;color:var(--ink-soft);">${String(s.start_hour).padStart(2,'0')}:00 – ${String(s.start_hour+1).padStart(2,'0')}:00</p>
          ${s.waitlist_count > 0 ? `<p style="font-size:12px;color:var(--saffron);font-weight:600;margin-top:4px;">Waitlist: ${s.waitlist_count}</p>` : ''}
        </div>
        <div style="margin-top:14px;">
          ${s.seats_remaining > 0 ? `<button class="btn btn-primary" onclick="bookSession(${s.id})">Book Mat</button>` : `<button class="btn btn-saffron" onclick="joinWaitlist(${s.id})">Join Waitlist</button>`}
        </div>
      </div>
    `).join('') || '<p style="color:var(--ink-soft);">No sessions scheduled.</p>';
  } catch (err) { console.error(err); }
}

async function bookSession(id) {
  try {
    const res = await fetch(`/api/sessions/${id}/book`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed');
    showToast(`Booked! Code: ${data.booking.code}`); loadSessions();
  } catch (err) { showToast(err.message); }
}

async function joinWaitlist(id) {
  try {
    const res = await fetch(`/api/sessions/${id}/waitlist`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed');
    showToast(`Waitlisted at position #${data.waitlist.position}`); loadSessions();
  } catch (err) { showToast(err.message); }
}

async function loadMine() {
  try {
    const res = await fetch('/api/bookings/mine', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    document.getElementById('mine-bookings').innerHTML = (data.bookings || []).map(b => `
      <div class="session-card">
        <div>
          <span class="badge badge-avail">${b.status.toUpperCase()}</span>
          <h3 class="serif" style="color:var(--teal);">${b.date} @ ${String(b.start_hour).padStart(2,'0')}:00</h3>
          ${b.status === 'confirmed' ? `<div class="code-display">${b.code}</div>` : ''}
        </div>
        ${b.status === 'confirmed' ? `<button class="btn btn-danger" style="margin-top:10px;" onclick="cancelBooking(${b.id})">Cancel</button>` : ''}
      </div>
    `).join('') || '<p style="color:var(--ink-soft);">No active bookings.</p>';

    document.getElementById('mine-waitlists').innerHTML = (data.waitlists || []).map(w => `
      <div class="session-card">
        <h3 class="serif" style="color:var(--teal);">${w.date} @ ${String(w.start_hour).padStart(2,'0')}:00</h3>
        <p style="margin-top:8px;">Queue Position: <strong style="color:var(--saffron);">#${w.position}</strong></p>
      </div>
    `).join('') || '<p style="color:var(--ink-soft);">Not on waitlist.</p>';
  } catch (err) { console.error(err); }
}

async function cancelBooking(id) {
  if (!confirm('Cancel booking? Waitlisted member will be auto-promoted.')) return;
  try {
    const res = await fetch(`/api/bookings/${id}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed');
    showToast('Cancelled.'); loadMine();
  } catch (err) { showToast(err.message); }
}

async function handleCheckin(e) {
  e.preventDefault();
  const code = document.getElementById('checkin-code').value.trim();
  try {
    const res = await fetch('/api/checkin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Invalid code');
    showToast(`✓ Checked in: ${data.attendee.name}`);
    document.getElementById('checkin-code').value = '';
  } catch (err) { showToast(err.message); }
}

async function handleCreateSession(e) {
  e.preventDefault();
  const date = document.getElementById('new-date').value;
  const start_hour = document.getElementById('new-hour').value;
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ date, start_hour })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed');
    showToast('Session created!');
    document.getElementById('new-date').value = '';
  } catch (err) { showToast(err.message); }
}

function route() {
  const hash = location.hash || '#/sessions';
  ['auth', 'sessions', 'mine', 'admin'].forEach(v => document.getElementById(`view-${v}`).classList.add('hidden'));
  ['nav-sessions', 'nav-mine', 'nav-admin'].forEach(n => document.getElementById(n)?.classList.remove('active'));

  if (!token) { document.getElementById('view-auth').classList.remove('hidden'); return; }
  clearInterval(pollTimer);
  if (hash === '#/sessions') {
    document.getElementById('view-sessions').classList.remove('hidden');
    document.getElementById('nav-sessions')?.classList.add('active');
    loadSessions(); pollTimer = setInterval(loadSessions, 5000);
  } else if (hash === '#/mine') {
    document.getElementById('view-mine').classList.remove('hidden');
    document.getElementById('nav-mine')?.classList.add('active');
    loadMine();
  } else if (hash === '#/admin') {
    if (user?.role !== 'admin') { location.hash = '#/sessions'; return; }
    document.getElementById('view-admin').classList.remove('hidden');
    document.getElementById('nav-admin')?.classList.add('active');
  } else { location.hash = '#/sessions'; }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('filter-date').value = new Date().toISOString().split('T')[0];
  updateNav(); route();
});
