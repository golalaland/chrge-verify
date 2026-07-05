import { requireAdmin, signOut } from '../services/auth-guard.js';
import { renderShell, showToast } from '../services/shell.js';
import { functions, db } from '../services/firebase-config.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { collection, query, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const { user } = await requireAdmin();

const app = document.getElementById('app');
app.innerHTML = renderShell('print', renderContent(), { email: user.email });
document.getElementById('signOutBtn').addEventListener('click', signOut);

function renderContent() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">Print Queue</div>
        <div class="page-subtitle">Generate printable sticker sheets — each sheet has a unique QR code and short code per sticker.</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 1.5rem;">
      <div style="display:flex; gap:0.8rem; flex-wrap:wrap; align-items:flex-end;">
        <div class="form-group" style="flex:1; min-width:260px; margin-bottom:0;">
          <label class="form-label">Batch</label>
          <select id="batchSelect" class="form-select">
            <option value="">Loading batches...</option>
          </select>
        </div>
        <button id="generateBtn" class="btn btn-primary" disabled>Generate print sheet</button>
      </div>
      <div id="generateProgress" style="display:none; margin-top:1rem; color:var(--paper-dim); font-size:0.85rem;"></div>
      <div id="generateError" style="display:none; margin-top:1rem; color:#ffb3b3; font-size:0.85rem;"></div>
    </div>

    <div style="font-family:var(--font-display); font-weight:600; font-size:0.95rem; margin-bottom:0.9rem;">Recent print jobs</div>
    <div id="jobsTableWrap" class="table-wrap">
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

function jobStatusBadge(status) {
  const map = {
    ready: 'badge-success',
    generating: 'badge-warning',
    failed: 'badge-danger'
  };
  return `<span class="badge ${map[status] || 'badge-neutral'}">${status || 'unknown'}</span>`;
}

async function loadBatchOptions() {
  const select = document.getElementById('batchSelect');
  try {
    const snap = await getDocs(query(collection(db, 'batches'), orderBy('createdAt', 'desc'), limit(200)));
    const batches = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b => b.status === 'ready'); // only fully-generated batches can be printed

    if (batches.length === 0) {
      select.innerHTML = `<option value="">No ready batches yet</option>`;
      return;
    }

    select.innerHTML = `
      <option value="">Select a batch...</option>
      ${batches.map(b => `<option value="${b.id}">${escapeHtml(b.batchNumber)} (${(b.codesGenerated || 0).toLocaleString()} codes)</option>`).join('')}
    `;
    select.addEventListener('change', () => {
      document.getElementById('generateBtn').disabled = !select.value;
    });
  } catch (err) {
    console.error('Failed to load batches:', err);
    select.innerHTML = `<option value="">Couldn't load batches</option>`;
  }
}

async function loadPrintJobs() {
  const wrap = document.getElementById('jobsTableWrap');
  try {
    const listPrintJobs = httpsCallable(functions, 'listPrintJobs');
    const result = await listPrintJobs();
    const jobs = result.data.printJobs || [];

    if (jobs.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          <div style="font-family:var(--font-display); font-weight:600; margin-bottom:0.3rem;">No print jobs yet</div>
          <div style="font-size:0.85rem;">Generate your first sticker sheet above.</div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table>
        <thead>
          <tr><th>Batch</th><th>Quantity</th><th>Pages</th><th>Status</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          ${jobs.map(j => `
            <tr>
              <td class="mono">${escapeHtml(j.batchNumber || '—')}</td>
              <td>${(j.quantity || 0).toLocaleString()}</td>
              <td style="color:var(--paper-dim);">${j.pageCount || '—'}</td>
              <td>${jobStatusBadge(j.status)}</td>
              <td style="color:var(--paper-faint); font-size:0.8rem;">${fmtDate(j.createdAt)}</td>
              <td>
                ${j.status === 'ready' && j.downloadUrl
                  ? `<a href="${j.downloadUrl}" target="_blank" rel="noopener" class="btn btn-secondary" style="padding:0.4rem 0.8rem; font-size:0.78rem;">Download PDF</a>`
                  : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Failed to load print jobs:', err);
    wrap.innerHTML = `
      <div class="empty-state">
        <div style="color:#ffb3b3; font-family:var(--font-display); font-weight:600; margin-bottom:0.3rem;">Couldn't load print jobs</div>
        <div style="font-size:0.85rem;">${escapeHtml(err.message || String(err))}</div>
      </div>
    `;
  }
}

document.getElementById('generateBtn').addEventListener('click', async () => {
  const batchID = document.getElementById('batchSelect').value;
  if (!batchID) return;

  const btn = document.getElementById('generateBtn');
  const progressEl = document.getElementById('generateProgress');
  const errorEl = document.getElementById('generateError');
  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating...';
  progressEl.style.display = 'block';
  progressEl.textContent = 'Generating QR codes and laying out the sheet — large batches can take a minute or two.';

  try {
    const generatePrintSheet = httpsCallable(functions, 'generatePrintSheet');
    const result = await generatePrintSheet({ batchID });
    progressEl.style.display = 'none';
    showToast(`Print sheet ready: ${result.data.codesIncluded.toLocaleString()} stickers across ${result.data.pageCount} page${result.data.pageCount === 1 ? '' : 's'}.`);
    loadPrintJobs();
  } catch (err) {
    console.error('Print sheet generation failed:', err);
    errorEl.textContent = err.message || 'Failed to generate print sheet.';
    errorEl.style.display = 'block';
    progressEl.style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate print sheet';
  }
});

loadBatchOptions();
loadPrintJobs();
