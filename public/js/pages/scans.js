import { requireAdmin, signOut } from '../services/auth-guard.js';
import { renderShell } from '../services/shell.js';
import { functions } from '../services/firebase-config.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

const { user } = await requireAdmin();

const app = document.getElementById('app');
app.innerHTML = renderShell('scans', renderContent(), { email: user.email });
document.getElementById('signOutBtn').addEventListener('click', signOut);

let suspiciousOnly = false;

function renderContent() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">Scan Activity</div>
        <div class="page-subtitle">Every verification attempt, collected automatically by the public verify page.</div>
      </div>
      <button id="suspiciousToggle" class="btn btn-secondary">Show suspicious only</button>
    </div>
    <div id="scansTableWrap" class="table-wrap">
      <div style="padding:3rem; text-align:center; color:var(--paper-faint);"><span class="spinner"></span></div>
    </div>
  `;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function fmtDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts._seconds ? new Date(ts._seconds * 1000) : (ts.toDate ? ts.toDate() : new Date(ts));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function locationText(loc) {
  if (!loc) return '—';
  const parts = [loc.city, loc.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

async function loadScans() {
  const wrap = document.getElementById('scansTableWrap');
  wrap.innerHTML = `<div style="padding:3rem; text-align:center; color:var(--paper-faint);"><span class="spinner"></span></div>`;

  try {
    const listScans = httpsCallable(functions, 'listScans');
    const result = await listScans({ limit: 100, suspiciousOnly });
    const scans = result.data.scans || [];

    if (scans.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <div style="font-family:var(--font-display); font-weight:600; margin-bottom:0.3rem;">
            ${suspiciousOnly ? 'No suspicious scans' : 'No scans yet'}
          </div>
          <div style="font-size:0.85rem;">
            ${suspiciousOnly ? 'Nothing has been flagged so far — good sign.' : 'Scans appear here automatically once codes start getting verified.'}
          </div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table>
        <thead>
          <tr><th>Code</th><th>Location</th><th>First scan</th><th>Flagged</th><th>Time</th></tr>
        </thead>
        <tbody>
          ${scans.map(s => `
            <tr>
              <td class="mono">${escapeHtml(s.publicCode || (s.secureID || '').slice(0, 12) + '...')}</td>
              <td style="color:var(--paper-dim);">${escapeHtml(locationText(s.location))}</td>
              <td style="color:var(--paper-faint);">${s.isFirstScan ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
              <td>${s.suspicious ? `<span class="badge badge-danger" title="${escapeHtml((s.suspicionReasons || []).join('; '))}">Flagged</span>` : '<span class="badge badge-neutral">—</span>'}</td>
              <td style="color:var(--paper-faint); font-size:0.8rem;">${fmtDate(s.scannedAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Failed to load scans:', err);
    wrap.innerHTML = `
      <div class="empty-state">
        <div style="color:#ffb3b3; font-family:var(--font-display); font-weight:600; margin-bottom:0.3rem;">Couldn't load scan activity</div>
        <div style="font-size:0.85rem;">${escapeHtml(err.message || String(err))}</div>
      </div>
    `;
  }
}

document.getElementById('suspiciousToggle').addEventListener('click', () => {
  suspiciousOnly = !suspiciousOnly;
  const btn = document.getElementById('suspiciousToggle');
  btn.textContent = suspiciousOnly ? 'Show all scans' : 'Show suspicious only';
  btn.classList.toggle('btn-primary', suspiciousOnly);
  btn.classList.toggle('btn-secondary', !suspiciousOnly);
  loadScans();
});

loadScans();
