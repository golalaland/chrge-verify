import { requireAdmin, signOut } from '../services/auth-guard.js';
import { renderShell, showToast } from '../services/shell.js';
import { functions } from '../services/firebase-config.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

const { user } = await requireAdmin();

const app = document.getElementById('app');
app.innerHTML = renderShell('codes', renderContent(), { email: user.email });
document.getElementById('signOutBtn').addEventListener('click', signOut);

function renderContent() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">Codes</div>
        <div class="page-subtitle">Search by secure ID, public code, batch number, or product SKU.</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 1.5rem;">
      <form id="searchForm" style="display:flex; gap:0.7rem; flex-wrap:wrap;">
        <input id="searchInput" class="form-input" style="flex:1; min-width:260px;"
          placeholder="Paste a secure ID, public code (CGA8-K2MX), batch number, or SKU..." />
        <button type="submit" id="searchBtn" class="btn btn-primary">Search</button>
      </form>
    </div>

    <div id="resultsWrap"></div>

    <div id="actionModalHost"></div>
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function statusBadge(status) {
  const map = {
    active: 'badge-success',
    disabled: 'badge-neutral',
    blacklisted: 'badge-danger',
    transferred: 'badge-warning'
  };
  return `<span class="badge ${map[status] || 'badge-neutral'}">${status || 'unknown'}</span>`;
}

let lastResults = [];

async function runSearch(q) {
  const wrap = document.getElementById('resultsWrap');
  wrap.innerHTML = `<div class="table-wrap"><div style="padding:3rem; text-align:center; color:var(--paper-faint);"><span class="spinner"></span></div></div>`;

  try {
    const searchCodes = httpsCallable(functions, 'searchCodes');
    const result = await searchCodes({ query: q });
    lastResults = result.data.results || [];
    renderResults(lastResults);
  } catch (err) {
    console.error('Search failed:', err);
    wrap.innerHTML = `
      <div class="table-wrap">
        <div class="empty-state">
          <div style="color:#ffb3b3; font-family:var(--font-display); font-weight:600; margin-bottom:0.3rem;">Search failed</div>
          <div style="font-size:0.85rem;">${escapeHtml(err.message || String(err))}</div>
        </div>
      </div>
    `;
  }
}

function renderResults(results) {
  const wrap = document.getElementById('resultsWrap');

  if (results.length === 0) {
    wrap.innerHTML = `
      <div class="table-wrap">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <div style="font-family:var(--font-display); font-weight:600; margin-bottom:0.3rem;">No matches</div>
          <div style="font-size:0.85rem;">Try a full secure ID, exact public code (e.g. CGA8-K2MX), batch number, or SKU.</div>
        </div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Public code</th><th>Secure ID</th><th>Batch</th><th>Status</th><th>Verified</th><th>Scans</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${results.map((c, i) => `
            <tr>
              <td class="mono">${escapeHtml(c.publicCode)}</td>
              <td class="mono" style="color:var(--paper-faint); font-size:0.75rem;" title="${escapeHtml(c.secureID)}">${escapeHtml((c.secureID || '').slice(0, 16))}...</td>
              <td style="color:var(--paper-dim);">${escapeHtml(c.batchNumber || '—')}</td>
              <td>${statusBadge(c.status)}</td>
              <td style="color:var(--paper-faint); font-size:0.8rem;">${c.verified ? fmtDate(c.verificationDate) : '—'}</td>
              <td style="color:var(--paper-dim);">${c.scanCount || 0}</td>
              <td>
                <div style="display:flex; gap:0.4rem;">
                  ${c.status === 'active' ? `<button class="btn btn-secondary action-disable" data-idx="${i}" style="padding:0.4rem 0.7rem; font-size:0.75rem;">Disable</button>` : ''}
                  ${c.status === 'disabled' ? `<button class="btn btn-secondary action-reenable" data-idx="${i}" style="padding:0.4rem 0.7rem; font-size:0.75rem;">Re-enable</button>` : ''}
                  ${c.status !== 'blacklisted' ? `<button class="btn btn-danger action-blacklist" data-idx="${i}" style="padding:0.4rem 0.7rem; font-size:0.75rem;">Blacklist</button>` : ''}
                  ${c.status !== 'blacklisted' ? `<button class="btn btn-secondary action-reissue" data-idx="${i}" style="padding:0.4rem 0.7rem; font-size:0.75rem;">Reissue</button>` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  wrap.querySelectorAll('.action-disable').forEach(btn => btn.addEventListener('click', () => confirmAction('disable', results[+btn.dataset.idx])));
  wrap.querySelectorAll('.action-reenable').forEach(btn => btn.addEventListener('click', () => confirmAction('reenable', results[+btn.dataset.idx])));
  wrap.querySelectorAll('.action-blacklist').forEach(btn => btn.addEventListener('click', () => confirmAction('blacklist', results[+btn.dataset.idx])));
  wrap.querySelectorAll('.action-reissue').forEach(btn => btn.addEventListener('click', () => confirmAction('reissue', results[+btn.dataset.idx])));
}

const ACTION_COPY = {
  disable: {
    title: 'Disable this code?',
    body: 'The code stops verifying as genuine immediately. You can re-enable it later — this is reversible.',
    confirmLabel: 'Disable code',
    fn: 'disableCode'
  },
  reenable: {
    title: 'Re-enable this code?',
    body: 'The code will verify as genuine again.',
    confirmLabel: 'Re-enable',
    fn: 'reenableCode'
  },
  blacklist: {
    title: 'Blacklist this code?',
    body: 'This is meant to be permanent — use it for codes you believe are compromised or counterfeit-linked. It cannot be casually re-enabled afterward.',
    confirmLabel: 'Blacklist permanently',
    fn: 'blacklistCode'
  },
  reissue: {
    title: 'Reissue this code?',
    body: 'Generates a brand new secure ID and public code for the same product, and permanently blacklists this one — use this when a code has leaked (e.g. a photo of the sticker got out) before the product shipped, not for routine disabling.',
    confirmLabel: 'Reissue & blacklist old code',
    fn: 'reissueCode'
  }
};

function confirmAction(action, code) {
  const copy = ACTION_COPY[action];
  const host = document.getElementById('actionModalHost');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${copy.title}</div>
        <button id="closeActionModal" style="background:none;border:none;color:var(--paper-faint);cursor:pointer;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <p style="color:var(--paper-dim); font-size:0.88rem; line-height:1.55; margin-bottom:1.2rem;">
        ${copy.body}
      </p>
      <div class="mono" style="background:rgba(244,244,242,0.04); border-radius:8px; padding:0.6rem 0.8rem; font-size:0.8rem; margin-bottom:1.2rem; color:var(--paper-dim);">
        ${escapeHtml(code.publicCode)}
      </div>
      ${action === 'blacklist' ? `
        <div class="form-group">
          <label class="form-label">Reason (optional)</label>
          <input type="text" id="blacklistReason" class="form-input" placeholder="e.g. reported as counterfeit by customer">
        </div>
      ` : ''}
      <div id="actionError" style="display:none; color:#ffb3b3; font-size:0.83rem; margin-bottom:1rem;"></div>
      <button id="confirmActionBtn" class="btn ${action === 'blacklist' || action === 'reissue' ? 'btn-danger' : 'btn-primary'}" style="width:100%; justify-content:center;">
        ${copy.confirmLabel}
      </button>
    </div>
  `;
  host.appendChild(overlay);

  document.getElementById('closeActionModal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('confirmActionBtn').addEventListener('click', async () => {
    const btn = document.getElementById('confirmActionBtn');
    const errorEl = document.getElementById('actionError');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Working...';

    try {
      const fn = httpsCallable(functions, copy.fn);
      const payload = { secureID: code.secureID };
      if (action === 'blacklist') {
        payload.reason = document.getElementById('blacklistReason').value.trim();
      }
      const result = await fn(payload);
      overlay.remove();
      showToast(
        action === 'reissue'
          ? `Reissued. New code: ${result.data.newPublicCode}`
          : `Code ${action === 'reenable' ? 're-enabled' : action + 'd'}.`
      );
      // Refresh current search results so the UI reflects the change
      const q = document.getElementById('searchInput').value.trim();
      if (q) runSearch(q);
    } catch (err) {
      console.error(`${action} failed:`, err);
      errorEl.textContent = err.message || `Failed to ${action} code.`;
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = copy.confirmLabel;
    }
  });
}

document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('searchInput').value.trim();
  if (q) runSearch(q);
});
