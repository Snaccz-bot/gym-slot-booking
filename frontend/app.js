let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user') || 'null');
let isRegister = false;
let pollTimer = null;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = isError ? 'var(--brick)' : 'var(--teal)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function handle401(res) {
  if (res.status === 401) {
    logout();
    showToast('Session expired. Please log in again.', true);
    return true;
  }
  return false;
}

function choosePortal(role) {
  isRegister = false;
  const isAdm = (role === 'admin');
  document.getElementById('auth-title').innerText = isAdm ? 'Staff Station Sign In' : 'Member Sign In';
  document.getElementById('auth-lede').innerText = isAdm ? 'Enter gym staff administrator credentials.' : 'Sign in to reserve mats and view check-in tokens.';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-password').value = isAdm ? 'admin123' : '';
  document.getElementById('auth-toggle').classList.toggle('hidden', isAdm);
  document.getElementById('field-name').classList.add('hidden');
  document.getElementById('auth-btn').innerText = isAdm ? 'Staff Sign In →' : 'Sign In →';
  location.hash = '#/auth';
}

function toggleAuth(e) {
  e.preventDefault();
  isRegister = !isRegister;
  document.getElementById('auth-title').innerText = isRegister ? 'Register Member Account' : 'Member Sign In';
  document.getElementById('field-name').classList.toggle('hidden', !isRegister);
  document.getElementById('auth-btn').innerText = isRegister ? 'Create Account →' : 'Sign In →';
  document.getElementById('auth-toggle').innerText = isRegister ? 'Already have an account? Sign in' : 'Need an account? Register here';
}

async function handleAuth(e) {
  e.preventDefault();
  const btn = document.getElementById('auth-btn');
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name').value.trim();

  let hasErr = false;
  document.getElementById('err-email').innerText = '';
  document.getElementById('err-password').innerText = '';
  if (isRegister && name.length < 2) {
    document.getElementById('err-name').innerText = 'Name must be at least 2 characters'; hasErr = true;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    document.getElementById('err-email').innerText = 'Please enter a valid email address'; hasErr = true;
  }
  if (password.length < 6 || password.length > 72) {
    document.getElementById('err-password').innerText = 'Password must be between 6 and 72 characters'; hasErr = true;
  }
  if (hasErr) return;

  btn.disabled = true;
  const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
  const body = isRegister ? { name, email, password } : { email, password };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Authentication failed');
    token = data.token; user = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    showToast(`Welcome, ${user.name}!`);
    updateNav();
    location.hash = (user.role === 'admin') ? '#/admin' : '#/sessions';
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function logout() {
  localStorage.clear();
  token = null; user = null;
  clearInterval(pollTimer);
  updateNav();
  location.hash = '#/landing';
}

function updateNav() {
  const auth = !!token;
  document.getElementById('nav-logout').classList.toggle('hidden', !auth);
  document.getElementById('nav-mine').classList.toggle('hidden', !(auth && user?.role === 'member'));
  document.getElementById('nav-admin').classList.toggle('hidden', !(auth && user?.role === 'admin'));
  document.getElementById('nav-sessions').classList.toggle('hidden', !auth);
}

function clearDateFilter() {
  document.getElementById('filter-date').value = '';
  loadSessions();
}

async function loadSessions() {
  if (!token) return;
  const dateInput = document.getElementById('filter-date');
  const date = dateInput ? dateInput.value : '';
  const url = date ? `/api/sessions?date=${encodeURIComponent(date)}` : '/api/sessions';
  const statusEl = document.getElementById('sessions-status');
  const grid = document.getElementById('sessions-grid');

  if (statusEl) statusEl.innerText = '';
  if (grid && !grid.children.length) {
    grid.innerHTML = '<p style="color:var(--ink-soft);padding:20px;">Loading sessions...</p>';
  }

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (handle401(res)) return;
    if (!res.ok) throw new Error('Failed to load sessions');
    const data = await res.json();

    if (!data.sessions || data.sessions.length === 0) {
      grid.innerHTML = '<p style="color:var(--ink-soft);padding:20px;">No sessions found for this filter.</p>';
      return;
    }

    const activeId = document.activeElement ? document.activeElement.id : null;

    grid.innerHTML = data.sessions.map(s => {
      let actionBtn = '';
      
      // ADMIN: Only manages, NEVER books
      if (user?.role === 'admin') {
        actionBtn = `<span class="badge" style="background:var(--paper-dim);color:var(--ink-soft);font-size:12px;padding:6px 12px;">Staff View Only</span>`;
      } else if (s.has_started) {
        actionBtn = `<button class="btn" disabled style="background:var(--line);color:var(--ink-soft);">Session Started</button>`;
      } else if (s.user_booked) {
        actionBtn = `<button class="btn" disabled style="background:rgba(110,143,107,0.2);color:var(--sage);font-weight:bold;">✓ You are Booked</button>`;
      } else if (s.user_waitlisted) {
        actionBtn = `<button class="btn btn-saffron" onclick="leaveWaitlist(${s.id}, this)">Leave Waitlist</button>`;
      } else if (s.seats_remaining > 0) {
        actionBtn = `<button class="btn btn-primary" id="btn-book-${s.id}" onclick="bookSession(${s.id}, ${s.seats_remaining}, this)">Book Mat</button>`;
      } else {
        actionBtn = `<button class="btn btn-saffron" onclick="joinWaitlist(${s.id}, this)">Join Waitlist</button>`;
      }

      return `
        <div class="session-card" id="card-session-${s.id}">
          <div>
            <span class="badge ${s.seats_remaining > 0 ? 'badge-avail' : 'badge-full'}" id="badge-seats-${s.id}">
              ${s.seats_remaining > 0 ? `${s.seats_remaining} MATS AVAILABLE` : 'SESSION FULL'}
            </span>
            <h3 class="serif" style="color:var(--teal);margin-bottom:4px;">${escapeHtml(s.date)}</h3>
            <p style="font-size:13px;color:var(--ink-soft);">${String(s.start_hour).padStart(2,'0')}:00 – ${String(s.start_hour+1).padStart(2,'0')}:00</p>
            ${s.waitlist_count > 0 ? `<p style="font-size:12px;color:var(--saffron);font-weight:600;margin-top:4px;">Waitlist: ${s.waitlist_count} members</p>` : ''}
          </div>
          <div style="margin-top:14px;">${actionBtn}</div>
        </div>
      `;
    }).join('');

    if (activeId) {
      const el = document.getElementById(activeId);
      if (el) el.focus();
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--brick);">${escapeHtml(err.message)} <button onclick="loadSessions()">Retry</button></span>`;
  }
}

async function bookSession(id, currentSeats, btn) {
  btn.disabled = true;
  const badge = document.getElementById(`badge-seats-${id}`);
  const origText = badge ? badge.innerText : '';
  if (badge) badge.innerText = `${currentSeats - 1} MATS AVAILABLE`;

  try {
    const res = await fetch(`/api/sessions/${id}/book`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (handle401(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Booking refused');
    showToast(`Booked! Check-in code: ${data.booking.code}`);
    loadSessions();
  } catch (err) {
    if (badge) badge.innerText = origText;
    showToast(err.message, true);
    btn.disabled = false;
  }
}

async function joinWaitlist(id, btn) {
  btn.disabled = true;
  try {
    const res = await fetch(`/api/sessions/${id}/waitlist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (handle401(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Waitlist request failed');
    showToast(`Added to waitlist at position #${data.waitlist.position}`);
    loadSessions();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
  }
}

async function leaveWaitlist(id, btn) {
  btn.disabled = true;
  try {
    const res = await fetch(`/api/sessions/${id}/waitlist`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (handle401(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to leave waitlist');
    showToast('Removed from waitlist');
    loadSessions();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
  }
}

async function loadMine() {
  try {
    const res = await fetch('/api/bookings/mine', { headers: { Authorization: `Bearer ${token}` } });
    if (handle401(res)) return;
    const data = await res.json();

    const confirmed = (data.bookings || []).filter(b => b.status === 'confirmed');
    const past = (data.bookings || []).filter(b => b.status !== 'confirmed');

    document.getElementById('mine-bookings').innerHTML = confirmed.map(b => `
      <div class="session-card">
        <div>
          <span class="badge badge-avail">CONFIRMED</span>
          <h3 class="serif" style="color:var(--teal);">${escapeHtml(b.date)} @ ${String(b.start_hour).padStart(2,'0')}:00</h3>
          <div class="code-display">${escapeHtml(b.code)}</div>
        </div>
        ${!b.has_started ? `<button class="btn btn-danger" onclick="cancelBooking(${b.id}, this)">Cancel Booking</button>` : ''}
      </div>
    `).join('') || '<p style="color:var(--ink-soft);padding:10px;">No active confirmed bookings.</p>';

    document.getElementById('mine-waitlists').innerHTML = (data.waitlists || []).map(w => `
      <div class="session-card">
        <div>
          <h3 class="serif" style="color:var(--teal);">${escapeHtml(w.date)} @ ${String(w.start_hour).padStart(2,'0')}:00</h3>
          <p style="margin:8px 0;">Queue Position: <strong style="color:var(--saffron);">#${w.position}</strong></p>
        </div>
        <button class="btn btn-saffron" onclick="leaveWaitlist(${w.session_id}, this)">Leave Waitlist</button>
      </div>
    `).join('') || '<p style="color:var(--ink-soft);padding:10px;">You are not on any waitlists.</p>';

    document.getElementById('mine-history').innerHTML = past.map(b => `
      <div class="session-card" style="opacity:0.75;">
        <span class="badge" style="background:#e9ecef;color:#495057;">${escapeHtml(b.status.toUpperCase())}</span>
        <h4 style="color:var(--ink-soft);margin-top:6px;">${escapeHtml(b.date)} @ ${String(b.start_hour).padStart(2,'0')}:00</h4>
      </div>
    `).join('') || '<p style="color:var(--ink-soft);padding:10px;">No past history.</p>';
  } catch (err) {
    showToast(err.message, true);
  }
}

async function cancelBooking(id, btn) {
  if (!confirm('Cancel this booking? The oldest waitlisted member will be automatically promoted.')) return;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/bookings/${id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (handle401(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Cancellation rejected');
    showToast('Booking cancelled');
    loadMine();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
  }
}

async function handleCheckin(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-checkin');
  const code = document.getElementById('checkin-code').value.trim();
  const resBox = document.getElementById('checkin-result');
  btn.disabled = true;
  resBox.innerHTML = '';

  try {
    const res = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Check-in failed');
    resBox.innerHTML = `<div style="padding:10px;background:#ebfbee;border:1px solid #b2f2bb;border-radius:8px;color:var(--teal);">✓ <strong>Checked In:</strong> ${escapeHtml(data.attendee.name)} (${escapeHtml(data.attendee.email)}) – ${escapeHtml(data.attendee.session)}</div>`;
    document.getElementById('checkin-code').value = '';
    loadAdminSessionBookings();
  } catch (err) {
    resBox.innerHTML = `<div style="padding:10px;background:#fff5f5;border:1px solid #ffc9c9;border-radius:8px;color:var(--brick);">✗ ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

async function handleCreateSession(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-create-session');
  const date = document.getElementById('new-date').value;
  const start_hour = document.getElementById('new-hour').value;
  btn.disabled = true;
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ date, start_hour })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Creation failed');
    showToast('Session created successfully');
    document.getElementById('new-date').value = '';
    loadAdminSessionDropdown();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function loadAdminSessionDropdown() {
  const sel = document.getElementById('admin-session-select');
  if (!sel) return;
  try {
    const res = await fetch('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    sel.innerHTML = '<option value="">Select a session to view attendees</option>' + 
      (data.sessions || []).map(s => `<option value="${s.id}">${escapeHtml(s.date)} @ ${String(s.start_hour).padStart(2,'0')}:00 (${s.booked_count}/20 booked)</option>`).join('');
  } catch (err) {}
}

async function loadAdminSessionBookings() {
  const sid = document.getElementById('admin-session-select').value;
  const table = document.getElementById('admin-bookings-table');
  if (!sid) { table.innerHTML = ''; return; }
  table.innerHTML = '<p style="color:var(--ink-soft);padding:10px;">Loading bookings...</p>';
  try {
    const res = await fetch(`/api/sessions/${sid}/bookings`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.bookings || data.bookings.length === 0) {
      table.innerHTML = '<p style="color:var(--ink-soft);padding:10px;">No bookings found for this session.</p>';
      return;
    }
    table.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;">
        <thead>
          <tr style="border-bottom:1.5px solid var(--line);text-align:left;">
            <th style="padding:8px;">Member</th><th style="padding:8px;">Email</th><th style="padding:8px;">Status</th><th style="padding:8px;">Code</th>
          </tr>
        </thead>
        <tbody>
          ${data.bookings.map(b => `
            <tr style="border-bottom:1px solid var(--line);">
              <td style="padding:8px;">${escapeHtml(b.name)}</td>
              <td style="padding:8px;">${escapeHtml(b.email)}</td>
              <td style="padding:8px;"><strong>${escapeHtml(b.status)}</strong></td>
              <td style="padding:8px;font-family:monospace;">${escapeHtml(b.code || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    table.innerHTML = '<p style="color:var(--brick);">Failed to load bookings.</p>';
  }
}

function route() {
  const hash = location.hash || '#/landing';
  ['landing', 'auth', 'sessions', 'mine', 'admin'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
  });

  if (!token) {
    if (hash === '#/auth') {
      document.getElementById('view-auth').classList.remove('hidden');
    } else {
      document.getElementById('view-landing').classList.remove('hidden');
    }
    return;
  }

  clearInterval(pollTimer);
  if (hash === '#/sessions') {
    document.getElementById('view-sessions').classList.remove('hidden');
    loadSessions();
    pollTimer = setInterval(loadSessions, 5000);
  } else if (hash === '#/mine') {
    if (user?.role === 'admin') { location.hash = '#/admin'; return; }
    document.getElementById('view-mine').classList.remove('hidden');
    loadMine();
  } else if (hash === '#/admin') {
    if (user?.role !== 'admin') { location.hash = '#/sessions'; return; }
    document.getElementById('view-admin').classList.remove('hidden');
    loadAdminSessionDropdown();
  } else {
    location.hash = (user?.role === 'admin') ? '#/admin' : '#/sessions';
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('filter-date').value = '';
  updateNav();
  route();
});