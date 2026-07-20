/**
 * ==========================================================================
 * CORE CHAMA MANAGEMENT MATRIX ENGINE a" DB-BACKED (loanmanagement MySQL)
 * All data storage uses /api/* endpoints a' loanmanagement database.
 * localStorage is used ONLY for UI preferences (theme, font, size, bg).
 * ==========================================================================
 */

// a"a" In-memory working state (populated from DB on load) a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"
let membersArray          = [];   // approved members
let pendingMembers        = [];
let deniedMembers         = [];
let notificationsArray    = [];   // fetched from system_logs table
let checkedNotifications  = [];
let selectedLoanIds       = [];   // for Loans Dashboard multi-delete
let selectedPendingMemberIds = []; // for Pending Members bulk approval
let allLoansList          = [];   // cache of all active loans
let generatedMinutesContent = '';

let automationAdmins      = [];   // from automation_admins table
let scheduledMeetings     = [];   // from scheduled_meetings table
let activeHomeSection     = localStorage.getItem('activeHomeSection') || 'members';
let autoRefreshTimer      = null;
let autoRefreshRunning    = false;
let draggedAgendaMemberId = '';
let pointerAgendaDrag     = null;
let suppressAgendaClick   = false;

const AUTO_REFRESH_INTERVAL_MS = 5000;

let trackingMetrics = {
  deletedProfilesLog:    [],
  updatedProfilesHistory: [],
  capitalFloundLimitSetting: 50000,
  activeFilterMode: 'all'
};

let governanceSuiteState = {
  currentSessionRole: 'Treasurer',
  activeSubsidiary: 'eldoret_main',
  subsidiariesList: {},
  agendaAssignedMemberIds: [],
  resolutionVoteRecord: { Approve: 0, Abstain: 0, Reject: 0 }
};

// Cross-tab sync keys
const SYSTEM_SYNC_KEYS = {
  POOL_UPDATED:  'memberPoolUpdatedTrigger',
  NOTIFICATIONS: 'memberNotifications'
};

// a"a" API Base a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"
// Use an explicit API base when available; if opened via file:// fallback to localhost:3000
const API = (function(){
  if (window.__API_BASE__) return window.__API_BASE__;
  try {
    if (window.location && window.location.protocol === 'file:') return 'http://127.0.0.1:3000/api';
  } catch(e) {}
  return '/api';
})();

function getAdminSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem('adminSession') || 'null');
    return session && typeof session === 'object' ? session : null;
  } catch (_) {
    return null;
  }
}

function adminAuthHeaders(extraHeaders = {}) {
  const session = getAdminSession();
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  return headers;
}

async function apiCall(path, options = {}) {
  const url = `${API}/${path}`;
  const headers = adminAuthHeaders(options.headers || {});
  const res  = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `API error: ${path}`);
  return body.data ?? body;
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  BOOT
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
document.addEventListener('DOMContentLoaded', async () => {
  loadCustomStylesFromStorage();
  document.querySelectorAll('.section').forEach(s => { s.style.display = 'none'; });

  await loadVerificationDashboard();   // members
  await loadNotificationsFromDB();     // system logs
  await loadDashboardTiles();          // control sector counts
  await renderRepaymentsLedger();      // repayments
  await renderLoansTableDashboard();   // loans table
  populateLoanAssigneeDropdown();

  renderNotifications();
  showSection(activeHomeSection);

  // Cross-tab sync
  window.addEventListener('storage', async (e) => {
    if ([SYSTEM_SYNC_KEYS.POOL_UPDATED, SYSTEM_SYNC_KEYS.NOTIFICATIONS, 'loans', 'repayments'].includes(e.key)) {
      await loadVerificationDashboard();
      await loadDashboardTiles();
      await renderLoansTableDashboard();
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('adminAccountDropdown');
    if (dd && !e.target.closest('.menu-dropdown')) dd.style.display = 'none';
    if (
      document.body.classList.contains('sidebar-open') &&
      window.matchMedia &&
      window.matchMedia('(max-width: 900px)').matches &&
      !e.target.closest('.sidebar-nav') &&
      !e.target.closest('.sidebar-toggle')
    ) {
      setSidebarNav(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setSidebarNav(false);
  });

  // Responsive auto-fit: scale main content to fit viewport height when needed
  let resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      scaleMainContent();
    }, 120);
  }
  window.addEventListener('resize', onResize);
  // initial fit
  scaleMainContent();
  startHomeAutoRefresh();
});

function scaleMainContent() {
  try {
    const wrapper = document.querySelector('.main-content-wrapper');
    if (!wrapper) return;
    wrapper.style.transform = '';
    wrapper.style.height = '';
  } catch (e) { console.warn('[scaleMainContent]', e.message); }
}

function setSidebarNav(open) {
  document.body.classList.toggle('sidebar-open', Boolean(open));
  const toggle = document.querySelector('.sidebar-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleSidebarNav() {
  setSidebarNav(!document.body.classList.contains('sidebar-open'));
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  NAVIGATION
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
function showSection(id, options = {}) {
  activeHomeSection = id || activeHomeSection;
  try { localStorage.setItem('activeHomeSection', activeHomeSection); } catch (_) {}
  document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
  const target = document.getElementById(id);
  if (target) target.style.display = 'block';

  document.querySelectorAll('.sidebar-nav button').forEach(btn => {
    btn.classList.remove('active');
    btn.removeAttribute('aria-current');
    if ((btn.getAttribute('onclick') || '').includes(`'${id}'`)) {
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'true');
    }
  });

  if (!options.skipLoad) {
    if (id === 'secretaryHub')   syncGovernanceDOM();
    if (id === 'members')        loadVerificationDashboard();
    if (id === 'automation')     { loadAutomationAdmins(); loadAutomationMeetings(); }
    if (id === 'controlSector')  loadDashboardTiles();
    if (id === 'repayments')     renderRepaymentsLedger();
    if (id === 'notifications')  loadNotificationsFromDB().then(renderNotifications);
    if (id === 'loans')          renderLoansTableDashboard().then(populateLoanAssigneeDropdown);
    if (id === 'corporatePortal') loadCorporatePortal();
    if (id === 'secretaryHub')   { loadAuthorizationQueue(); loadMinuteRegistry(); }
  }
  if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
    setSidebarNav(false);
  }
}

function isUserEditingField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

function hasBlockingOverlayOpen() {
  return Array.from(document.querySelectorAll('[id$="Modal"], .modal, dialog')).some(el => {
    if (el.id === 'deletedRecordsModal' || el.id === 'deletedMembersModal' || el.id === 'adminPassModal') return true;
    if (el.tagName === 'DIALOG') return el.open;
    return getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  });
}

function startHomeAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(refreshActiveHomeSection, AUTO_REFRESH_INTERVAL_MS);
}

async function refreshActiveHomeSection() {
  if (autoRefreshRunning || document.hidden || isUserEditingField() || hasBlockingOverlayOpen()) return;
  autoRefreshRunning = true;

  try {
    const refreshers = [loadDashboardTiles({ background: true })];

    if (activeHomeSection === 'members') {
      refreshers.push(loadVerificationDashboard({ background: true }));
    } else if (activeHomeSection === 'automation') {
      refreshers.push(loadAutomationAdmins(), loadAutomationMeetings());
    } else if (activeHomeSection === 'repayments') {
      refreshers.push(renderRepaymentsLedger());
    } else if (activeHomeSection === 'notifications') {
      refreshers.push(loadNotificationsFromDB().then(renderNotifications));
    } else if (activeHomeSection === 'loans') {
      refreshers.push(renderLoansTableDashboard().then(populateLoanAssigneeDropdown));
    } else if (activeHomeSection === 'secretaryHub') {
      refreshers.push(loadAuthorizationQueue(), loadMinuteRegistry());
    } else if (activeHomeSection === 'corporatePortal') {
      refreshers.push(loadCorporatePortal());
    }

    await Promise.allSettled(refreshers);
  } catch (err) {
    console.warn('[autoRefresh]', err.message || err);
  } finally {
    autoRefreshRunning = false;
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  SYSTEM LOGS  (DB-backed: system_logs table)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
async function logNotification(message) {
  const timestamp = new Date().toLocaleString();
  const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
  const notif = { id, message, timestamp };

  notificationsArray.unshift(notif);
  renderNotifications();

  // Persist to DB
  try {
    await apiCall('logs/create', {
      method: 'POST',
      body: JSON.stringify({ id, message, timestamp_str: timestamp })
    });
  } catch (e) {
    console.warn('[logNotification] DB save failed, kept in memory:', e.message);
  }
}

async function loadNotificationsFromDB() {
  try {
    const rows = await apiCall('logs/all', { method: 'GET' });
    notificationsArray = (rows || []).map(r => ({
      id: r.id,
      message: r.message,
      timestamp: r.timestamp_str
    }));
  } catch (e) {
    console.warn('[loadNotificationsFromDB] failed:', e.message);
  }
}

function renderNotifications() {
  const container = document.getElementById('notificationFeed');
  if (!container) return;

  if (notificationsArray.length === 0) {
    container.innerHTML = '<p style="opacity:0.6; font-style:italic;">No transactions or actions recorded yet.</p>';
    return;
  }

  container.innerHTML = notificationsArray.map(n => {
    const checked = checkedNotifications.includes(n.id) ? 'checked' : '';
    return `
      <div class="notification-item" style="display:flex; gap:12px; align-items:flex-start; padding:10px; background:rgba(255,255,255,0.03); border-radius:6px; border-left:4px solid #00e0ff; margin-bottom:6px;">
        <input type="checkbox" style="width:auto; margin-top:4px; cursor:pointer;" ${checked} onchange="toggleNotificationCheck('${n.id}', this.checked)">
        <div>
          <div style="font-size:0.95rem;">${n.message}</div>
          <span style="font-size:12px; opacity:0.5; display:block; margin-top:4px;">Y*' ${n.timestamp}</span>
        </div>
      </div>
    `;
  }).join('');
}

function toggleNotificationCheck(id, isChecked) {
  if (isChecked) { if (!checkedNotifications.includes(id)) checkedNotifications.push(id); }
  else           { checkedNotifications = checkedNotifications.filter(x => x !== id); }
}

async function keepCheckedNotifications() {
  if (checkedNotifications.length === 0) return alert('No log items selected.');
  try {
    await apiCall('logs/keep', { method: 'DELETE', body: JSON.stringify({ ids: checkedNotifications }) });
    notificationsArray = notificationsArray.filter(n => checkedNotifications.includes(n.id));
    checkedNotifications = [];
    renderNotifications();
    alert('Retained only the selected tracking messages.');
  } catch (e) {
    alert('DB error: ' + e.message);
  }
}

async function deleteCheckedNotifications() {
  if (checkedNotifications.length === 0) return alert('No log items selected.');
  try {
    await apiCall('logs/delete', { method: 'DELETE', body: JSON.stringify({ ids: checkedNotifications }) });
    notificationsArray = notificationsArray.filter(n => !checkedNotifications.includes(n.id));
    checkedNotifications = [];
    renderNotifications();
    alert('Deleted selected system message footprints.');
  } catch (e) {
    alert('DB error: ' + e.message);
  }
}

function pushMemberNotification(message) {
  try {
    const raw = localStorage.getItem('memberNotifications');
    const parsed = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(parsed) ? parsed : [];
    arr.unshift({ id: 'SYS-' + Date.now(), message, timestamp: new Date().toLocaleTimeString() });
    localStorage.setItem('memberNotifications', JSON.stringify(arr));
    localStorage.setItem(SYSTEM_SYNC_KEYS.NOTIFICATIONS, Date.now().toString());
  } catch (e) { console.error(e); }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  MEMBERS (dashboard-pools endpoint)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
async function loadVerificationDashboard(options = {}) {
  const background = !!options.background;
  const pendingBody  = document.getElementById('pendingApprovalsTableBody');
  const approvedBody = document.getElementById('approvedMembersTableBody');
  const deniedBody   = document.getElementById('deniedMembersTableBody');
  const setBodyHTML = (el, html) => {
    if (el && el.innerHTML !== html) el.innerHTML = html;
  };

  if (!background) {
    setBodyHTML(pendingBody, '<tr><td colspan="6" style="opacity:0.6; font-style:italic; padding:10px;">Loading pending members...</td></tr>');
    setBodyHTML(approvedBody, '<tr><td colspan="5" style="opacity:0.6; font-style:italic; padding:10px;">Loading approved members...</td></tr>');
    setBodyHTML(deniedBody, '<tr><td colspan="4" style="opacity:0.6; font-style:italic; padding:10px;">Loading denied members...</td></tr>');
  }

  try {
    const data = await apiCall('members/dashboard-pools', { method: 'GET' });

    pendingMembers  = Array.isArray(data?.pending)  ? data.pending  : [];
    membersArray    = Array.isArray(data?.approved) ? data.approved : [];
    deniedMembers   = Array.isArray(data?.denied)   ? data.denied   : [];

    // sort each pool by id descending so newest/approved entries show first
    const compareDesc = (a, b) => Number(b.id || 0) - Number(a.id || 0);
    pendingMembers.sort(compareDesc);
    membersArray.sort(compareDesc);
    deniedMembers.sort(compareDesc);

    // Pending table
    if (pendingBody) {
      const pendingHTML = pendingMembers.length === 0
        ? '<tr><td colspan="6" style="opacity:0.6; font-style:italic; padding:10px;">No pending member signup requests.</td></tr>'
        : pendingMembers.map(m => `
            <tr>
              <td><input type="checkbox" class="pending-checkbox" value="${m.id}" ${selectedPendingMemberIds.includes(String(m.id)) ? 'checked' : ''} onchange="togglePendingMemberSelection('${m.id}', this.checked)"></td>
              <td><code>${m.id}</code></td>
              <td style="word-wrap: break-word;"><strong>${m.full_name || m.name}</strong></td>
              <td style="word-break: break-all;">
                <div>${m.email}</div>
                <div style="font-size:0.85em; opacity:0.8; margin-top:2px;">${m.phone || 'No Phone'}</div>
              </td>
              <td><span style="color:#ff9800; font-weight:600;">Pending</span></td>
              <td>
                <div style="display:flex; gap:6px; justify-content:center;">
                  <button class="action-btn" style="padding:6px 10px; background:#4caf50; border:none; border-radius:6px; color:#fff; cursor:pointer;" onclick="handleApprovalDecision('${m.id}','approve')" title="Approve">
                    <i class="fas fa-check"></i>
                  </button>
                  <button class="btn-del" style="padding:6px 10px; background:#f44336; border:none; border-radius:6px; color:#fff; cursor:pointer;" onclick="handleApprovalDecision('${m.id}','deny')" title="Deny">
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              </td>
            </tr>`).join('');
      setBodyHTML(pendingBody, pendingHTML);
    }

    // Update Notification Bell for Pending
    const badge = document.getElementById('adminAlertBadge');
    const alertList = document.getElementById('adminAlertList');
    if (badge && alertList) {
        if (pendingMembers.length > 0) {
            badge.style.display = 'block';
            badge.innerText = pendingMembers.length;
            alertList.innerHTML = pendingMembers.map(m => `<div style="padding: 5px; border-bottom: 1px solid #333;">New signup: <strong>${m.full_name || m.name}</strong></div>`).join('');
        } else {
            badge.style.display = 'none';
            alertList.innerHTML = 'No new alerts.';
        }
    }

    // Update nav pending badge & sidebar badge
    const navPending = document.getElementById('navPendingBadge');
    const sidebarPending = document.getElementById('sidebarPendingBadge');
    const count = pendingMembers.length;
    if (navPending) {
      navPending.style.display = count > 0 ? 'inline-block' : 'none';
      navPending.textContent = count > 0 ? `${count} Pending` : '0 Pending';
    }
    if (sidebarPending) {
      sidebarPending.style.display = count > 0 ? 'inline-block' : 'none';
      sidebarPending.textContent = count;
    }

    if (typeof renderAnalyticsCharts === 'function') renderAnalyticsCharts();

    // Approved table
    if (approvedBody) {
      const approvedHTML = membersArray.length === 0
        ? '<tr><td colspan="6" style="opacity:0.6; font-style:italic; padding:10px;">No approved members found.</td></tr>'
        : membersArray.map((m, idx) => `
            <tr>
              <td><code>${membersArray.length - idx}</code><br><small style="opacity:0.55;">DB ID: ${m.id}</small></td>
              <td><strong>${m.full_name || m.name}</strong></td>
              <td>${m.email} | ${m.phone || 'No Phone'}</td>
              <td><span style="color:#81c784; font-weight:600;">Approved</span></td>
              <td><code style="color:#ff9800; font-weight:bold;">${m.security_pin || 'N/A'}</code></td>
              <td style="text-align:right;">
                <button class="btn-del" style="padding:5px 12px; font-size:11px; background:#c62828; overflow:auto;" onclick="deleteApprovedMember('${m.id}', '${(m.full_name || m.name || '').replace(/'/g, "\\'")}')">Delete</button>
              </td>
            </tr>`).join('');
      setBodyHTML(approvedBody, approvedHTML);
    }

    // Denied table
    renderDeniedAccounts();

    // Refresh dependent UI
    populateLoanAssigneeDropdown();
    loadDashboardTiles();
  } catch (err) {
    console.error('[loadVerificationDashboard]', err);
    const msg = err.message || 'Unknown error';
    if (pendingBody)  pendingBody.innerHTML  = `<tr><td colspan="6" style="color:#ff9800; padding:10px;">Failed to load pending queue: ${msg}</td></tr>`;
    if (approvedBody) approvedBody.innerHTML = `<tr><td colspan="6" style="color:#ff9800; padding:10px;">Failed to load approved members: ${msg}</td></tr>`;
    if (deniedBody)   deniedBody.innerHTML   = `<tr><td colspan="4" style="color:#ff9800; padding:10px;">Failed to load denied members: ${msg}</td></tr>`;
  }
}

// removed test helper per request

function renderDeniedAccounts() {
  const tbody = document.getElementById('deniedMembersTableBody');
  if (!tbody) return;
  tbody.innerHTML = !deniedMembers || deniedMembers.length === 0
    ? '<tr><td colspan="4" style="text-align:center; opacity:0.6; font-style:italic; padding:12px;">No denied logs recorded</td></tr>'
    : deniedMembers.map(m => `
        <tr>
          <td><strong>${m.full_name || m.name}</strong></td>
          <td>${m.email}</td>
          <td>${m.phone || 'No Phone'}</td>
          <td><span style="color:#f44336; font-weight:600; font-size:12px; background:rgba(244,67,54,0.1); padding:4px 8px; border-radius:4px;">Access Revoked</span></td>
        </tr>`).join('');
}

function copyTextToClipboard(text) {
  if (!text) return Promise.reject(new Error('No text to copy'));
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) return resolve();
      reject(new Error('Copy command was not successful'));
    } catch (err) {
      document.body.removeChild(textarea);
      reject(err);
    }
  });
}

function tableToCSV(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return '';

  const rows = Array.from(table.querySelectorAll('tr'));
  const csv = rows.map(row => {
    const cols = Array.from(row.querySelectorAll('td, th'));
    return cols.map(c => '"' + c.innerText.replace(/"/g, '""').trim() + '"').join(',');
  }).join('\n');
  return csv;
}

function exportPoolToCSV(tableId, poolName) {
  try {
    const csv = tableToCSV(tableId);
    if (!csv) return alert('No data available to export.');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${poolName}_members_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    alert('Export failed: ' + (e.message || e));
  }
}

async function copyPoolToClipboard(tableId, poolName) {
  try {
    const table = document.getElementById(tableId);
    if (!table) return alert('No table found');
    const rows = Array.from(table.querySelectorAll('tr'));
    const text = rows.map(r => Array.from(r.querySelectorAll('td, th')).map(c => c.innerText.trim()).join('\t')).join('\n');
    await copyTextToClipboard(text);
    alert(`Copied ${rows.length} rows from ${poolName} to clipboard.`);
  } catch (e) {
    alert('Copy failed: ' + (e.message || e));
  }
}

async function handleApprovalDecision(memberId, action) {
  try {
    await apiCall('members/process-approval', {
      method: 'POST',
      body: JSON.stringify({ id: memberId, action })
    });
    logNotification(`Verification decision: ${action === 'approve' ? 'a... Approved' : 'Ys Denied'} (Member ID: ${memberId})`);
    pushMemberNotification(`Verification update: ${action === 'approve' ? 'approved' : 'denied'} for registration ID: ${memberId}.`);
    await loadVerificationDashboard();
  } catch (e) {
    alert(e.message || 'Unable to process approval decision.');
  }
}

async function registerMember() {
  const full_name = document.getElementById('memberName').value.trim();
  const email     = document.getElementById('memberEmail').value.trim();
  const phone     = document.getElementById('memberPhone').value.trim();
  const password  = document.getElementById('memberPassword').value.trim();
  const emailRe   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!full_name)          return alert('Please enter a Full Name.');
  if (!emailRe.test(email)) return alert('Please enter a valid email address.');
  if (!password)           return alert('Please enter a Password.');

  const pin = Math.floor(1000 + Math.random() * 9000).toString();

  try {
    await apiCall('members/create', {
      method: 'POST',
      body: JSON.stringify({ full_name, email, phone, password, pin })
    });
    logNotification(`Registered chama member request: <strong>${full_name}</strong> (${email})`);
    alert(`Member request submitted. Security PIN: ${pin}`);
    localStorage.setItem(SYSTEM_SYNC_KEYS.POOL_UPDATED, Date.now().toString());
    await loadVerificationDashboard();
    document.getElementById('memberName').value     = '';
    document.getElementById('memberEmail').value    = '';
    document.getElementById('memberPhone').value    = '';
    document.getElementById('memberPassword').value = '';
  } catch (e) {
    alert(e.message || 'Unable to submit member request.');
  }
}

function renderAllLists() {
  const list = document.getElementById('MemberList');
  if (!list) return;
  if (!membersArray.length) {
    list.innerHTML = '<li style="opacity:0.6; font-style:italic;">No approved members found.</li>';
    return;
  }
  list.innerHTML = membersArray.map(m => `
    <li style="padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.01); margin-bottom:4px; border-radius:6px;">
      <div><strong style="color:#00e0ff;">${m.full_name || m.name}</strong> (${m.email}) a" <small style="color:#81c784;">Phone: ${m.phone || 'N/A'}</small></div>
      <code>ID: ${m.id}</code>
    </li>`).join('');
}

function populateLoanAssigneeDropdown() {
  const sel = document.getElementById('loanAssigneeSelector');
  if (!sel) return;
  sel.innerHTML = membersArray.length === 0
    ? '<option value="">-- No Approved Members Available --</option>'
    : '<option value="">-- Choose an Approved Member --</option>' +
      membersArray.map(m => `<option value="${m.id}|${m.full_name || m.name}">${m.full_name || m.name} (ID: ${m.id})</option>`).join('');
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  LOANS DASHBOARD  (DB-backed: loans table)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
function handleLoanAssigneeChange() {
  const selector = document.getElementById('loanAssigneeSelector');
  const pinInput = document.getElementById('loanAssignPin');
  if (!selector || !pinInput) return;

  const val = selector.value;
  if (!val) {
    pinInput.value = '';
    return;
  }

  const memberId = val.split('|')[0];
  const member = membersArray.find(m => String(m.id) === String(memberId));
  if (member) {
    pinInput.value = member.security_pin || 'N/A';
  } else {
    pinInput.value = 'N/A';
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  LOANS DASHBOARD  (DB-backed: loans table)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
async function executeDirectLoanAssignment() {
  const assigneeVal = document.getElementById('loanAssigneeSelector').value;
  const amtInput    = document.getElementById('loanAssignAmount');
  const amount      = parseFloat(amtInput.value);
  const pin         = document.getElementById('loanAssignPin').value;

  if (!assigneeVal || isNaN(amount) || amount <= 0) return alert('Please map structural parameters accurately before provision allocation run.');
  if (amount > trackingMetrics.capitalFloundLimitSetting) return alert(`Operational Reject: Loan value exceeds locked capital limit (Max: KES ${trackingMetrics.capitalFloundLimitSetting}).`);

  const [memberId, memberName] = assigneeVal.split('|');
  try {
    await apiCall('loans/create', {
      method: 'POST',
      body: JSON.stringify({ member_id: memberId, borrower_name: memberName, amount, pin: pin, admin_override: true })
    });
    logNotification(`Treasurer Action: Assigned direct loan to <strong>${memberName}</strong> a" KES ${amount.toLocaleString()}`);
    pushMemberNotification(`New outstanding balance allocated to your registry: KES ${amount}`);
    amtInput.value = '';
    document.getElementById('loanAssignPin').value = '';
    document.getElementById('loanAssigneeSelector').value = '';
    await renderLoansTableDashboard();
    await loadDashboardTiles();
  } catch (e) {
    alert(e.message || 'Unable to create loan.');
  }
}

async function renderLoansTableDashboard() {
  const tbody = document.getElementById('loansTableBody');
  if (!tbody) return;

  try {
    const loans = await apiCall('loans/all', { method: 'GET' });
    allLoansList = Array.isArray(loans) ? loans : [];

    if (!loans || loans.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.6; padding:15px;">No loan applications compiled.</td></tr>';
      return;
    }

    tbody.innerHTML = loans.map((loan, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td style="min-width:150px;">
          <strong>${loan.borrower_name}</strong><br>
          <small>ID: <code>${loan.id}</code></small>
        </td>
        <td style="width:5%;">
          <input type="checkbox" value="${loan.id}" ${selectedLoanIds.includes(String(loan.id)) ? 'checked' : ''} onchange="toggleLoanSelection('${loan.id}', this.checked)">
        </td>
        <td style="min-width:180px;">
          <span>KES ${parseFloat(loan.amount).toLocaleString()}</span><br>
          <span style="font-weight:bold; color:${loan.status === 'Active' ? '#ff9800' : '#4caf50'}">${loan.status}</span>
        </td>
        <td class="action-button-cell">
          <div class="button-group">
            <button class="action-btn" style="background:#4caf50; padding:5px 8px; font-size:11px;" onclick="settleLoanInstantly('${loan.id}')">Settle</button>
          </div>
        </td>
        <td class="action-button-cell">
          <div class="button-group">
            <button class="btn-del" style="padding:5px 8px; font-size:11px;" onclick="dropLoanFile('${loan.id}')">Drop</button>
          </div>
        </td>
      </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#ff9800; padding:15px;">Error loading loans: ${e.message}</td></tr>`;
  }
}

function toggleLoanSelection(loanId, isChecked) {
  if (isChecked) { if (!selectedLoanIds.includes(String(loanId))) selectedLoanIds.push(String(loanId)); }
  else           { selectedLoanIds = selectedLoanIds.filter(id => id !== String(loanId)); }
}

function toggleAllLoans(isChecked) {
  const boxes = document.querySelectorAll('#loansTableBody input[type="checkbox"]');
  boxes.forEach(cb => {
    cb.checked = isChecked;
    toggleLoanSelection(cb.value, isChecked);
  });
}

function togglePendingMemberSelection(memberId, isChecked) {
  if (isChecked) { if (!selectedPendingMemberIds.includes(String(memberId))) selectedPendingMemberIds.push(String(memberId)); }
  else           { selectedPendingMemberIds = selectedPendingMemberIds.filter(id => id !== String(memberId)); }
}

function toggleAllPendingMembers(isChecked) {
  const boxes = document.querySelectorAll('.pending-checkbox');
  boxes.forEach(b => {
    b.checked = isChecked;
    togglePendingMemberSelection(b.value, isChecked);
  });
}

async function verifyAdminPassword(password) {
  const res = await fetch(`${API}/settings/verify-admin-password`, {
    method: 'POST',
    headers: adminAuthHeaders(),
    body: JSON.stringify({ password })
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    throw new Error(data.message || 'Incorrect admin password.');
  }
  return true;
}

function showAdminPasswordModal(title, onConfirm) {
  const existing = document.getElementById('adminPassModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'adminPassModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:200000;display:flex;justify-content:center;align-items:center;padding:20px;';

  overlay.innerHTML = `
    <div style="background:#1a1a2e;border:1px solid rgba(0,224,255,0.35);border-radius:10px;width:100%;max-width:360px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.65);">
      <h3 style="margin:0 0 8px 0;color:#fff;font-size:18px;">${title}</h3>
      <p style="color:#aaa;font-size:12px;margin:0 0 16px 0;">Enter admin password to continue.</p>
      <div style="position:relative;margin-bottom:10px;">
        <input id="adminPassInput" type="password" placeholder="Admin password" style="width:100%;box-sizing:border-box;padding:11px 40px 11px 12px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.18);border-radius:6px;color:#fff;">
        <i id="adminPassEye" class="fas fa-eye" style="position:absolute;right:12px;top:12px;color:#aaa;cursor:pointer;"></i>
      </div>
      <div id="adminPassError" style="display:none;color:#ff8a80;font-size:12px;margin-bottom:12px;"></div>
      <div style="display:flex;gap:10px;">
        <button id="adminPassCancel" style="flex:1;padding:10px;background:#555;color:#fff;border:none;border-radius:6px;cursor:pointer;overflow:auto;">Cancel</button>
        <button id="adminPassConfirm" style="flex:1;padding:10px;background:#f44336;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;overflow:auto;">Confirm</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const input = overlay.querySelector('#adminPassInput');
  const errorDiv = overlay.querySelector('#adminPassError');
  const confirmBtn = overlay.querySelector('#adminPassConfirm');
  overlay.querySelector('#adminPassCancel').onclick = () => overlay.remove();
  overlay.querySelector('#adminPassEye').onclick = function() {
    input.type = input.type === 'password' ? 'text' : 'password';
    this.className = input.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
  };
  confirmBtn.onclick = async () => {
    const pass = input.value;
    if (!pass) {
      errorDiv.textContent = 'Please enter the admin password.';
      errorDiv.style.display = 'block';
      return;
    }
    confirmBtn.textContent = 'Checking...';
    confirmBtn.disabled = true;
    errorDiv.style.display = 'none';
    try {
      await onConfirm(pass, overlay, errorDiv);
    } catch (err) {
      errorDiv.textContent = err.message || 'Action failed.';
      errorDiv.style.display = 'block';
      confirmBtn.textContent = 'Confirm';
      confirmBtn.disabled = false;
    }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmBtn.click(); });
  input.focus();
}

function executeMainMenuAction(selectEl) {
  const action = selectEl.value;
  const checkboxes = document.querySelectorAll('#loansTableBody input[type="checkbox"]');

  if (action === 'selectAll') {
    selectedLoanIds = [];
    checkboxes.forEach(cb => { cb.checked = true; selectedLoanIds.push(cb.value); });
  } else if (action === 'deselectAll') {
    checkboxes.forEach(cb => cb.checked = false);
    selectedLoanIds = [];
  } else if (action === 'deleteAll') {
    if (allLoansList.length === 0) return alert('No loan records to delete.');
    showAdminPasswordModal('Delete all loan records', async (pass, modal) => {
      await verifyAdminPassword(pass);
      trackingMetrics.deletedProfilesLog.push(...allLoansList.map(l => ({ ...l, dateDeleted: new Date().toLocaleString() })));
      await apiCall('loans/drop-many', { method: 'DELETE', body: JSON.stringify({ ids: allLoansList.map(l => l.id) }) });
      modal.remove();
      selectedLoanIds = [];
      await renderLoansTableDashboard();
      await loadDashboardTiles();
      alert('All loan records deleted successfully.');
    });
  } else if (action === 'viewDeleted') {
    showDeletedRecordsPopup();
  } else if (action === 'viewUpdated') {
    showUpdatedRecordsPopup();
  }
  selectEl.value = '';
}

function showDeletedRecordsPopup() {
  const modal = document.getElementById('deletedRecordsModal');
  const tbody = document.getElementById('deletedRecordsTableBody');
  if (!modal || !tbody) return;
  const header = modal.querySelector('h3')?.parentElement;
  if (header && !document.getElementById('deletedMemberRecoveryShortcut')) {
    const btn = document.createElement('button');
    btn.id = 'deletedMemberRecoveryShortcut';
    btn.type = 'button';
    btn.textContent = 'Open Member Recovery';
    btn.style.cssText = 'margin-left:auto;margin-right:10px;background:#4caf50;color:#fff;border:none;border-radius:6px;padding:8px 12px;font-size:12px;font-weight:bold;cursor:pointer;overflow:auto;white-space:nowrap;box-shadow:0 8px 18px rgba(76,175,80,0.22);';
    btn.onclick = () => {
      modal.style.display = 'none';
      openDeletedMembersModal();
    };
    header.insertBefore(btn, header.lastElementChild);
  }

  if (trackingMetrics.deletedProfilesLog.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; opacity: 0.6; font-style: italic;">No deleted transaction records compiled.</td></tr>';
  } else {
    tbody.innerHTML = trackingMetrics.deletedProfilesLog.map((l, idx) => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
        <td style="padding: 10px 6px;">${idx + 1}</td>
        <td style="padding: 10px 6px;"><code>${l.id || 'N/A'}</code></td>
        <td style="padding: 10px 6px;"><strong>${l.borrower_name || 'N/A'}</strong></td>
        <td style="padding: 10px 6px; color: #81c784;">KES ${(l.amount || 0).toLocaleString()}</td>
        <td style="padding: 10px 6px;"><span style="color: #e57373; font-weight: bold;">Deleted</span><br><small style="font-size: 10px; opacity: 0.5;">${l.dateDeleted || ''}</small></td>
      </tr>
    `).join('');
  }
  modal.style.display = 'flex';
}

function showUpdatedRecordsPopup() {
  const old = document.getElementById('updatedRecordsModal');
  if (old) old.remove();

  const rows = trackingMetrics.updatedProfilesHistory || [];
  const overlay = document.createElement('div');
  overlay.id = 'updatedRecordsModal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:180000;background:rgba(10,18,40,0.88);display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;';
  overlay.innerHTML = `
    <div style="width:min(760px,95vw);max-height:85vh;overflow:auto;background:#111b2f;border:1px solid rgba(0,224,255,0.3);border-radius:12px;padding:24px;box-shadow:0 18px 48px rgba(0,0,0,0.55);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
        <h3 style="margin:0;color:#00e0ff;">Updated Records Tracker</h3>
        <button type="button" onclick="document.getElementById('updatedRecordsModal').remove()" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;overflow:auto;">x</button>
      </div>
      ${
        rows.length === 0
          ? '<div style="padding:24px;text-align:center;color:#aaa;font-style:italic;">No updated records have been logged in this session.</div>'
          : `<table style="width:100%;border-collapse:collapse;color:#ddd;font-size:13px;">
              <thead>
                <tr style="color:#00e0ff;border-bottom:1px solid rgba(0,224,255,0.25);">
                  <th style="padding:10px;text-align:left;">#</th>
                  <th style="padding:10px;text-align:left;">Member ID</th>
                  <th style="padding:10px;text-align:left;">Field</th>
                  <th style="padding:10px;text-align:left;">Value</th>
                  <th style="padding:10px;text-align:left;">Logged</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((r, idx) => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                    <td style="padding:10px;">${idx + 1}</td>
                    <td style="padding:10px;"><code>${r.id || 'N/A'}</code></td>
                    <td style="padding:10px;">${r.field || 'profile'}</td>
                    <td style="padding:10px;color:#81c784;">${r.value ?? ''}</td>
                    <td style="padding:10px;color:#aaa;">${r.loggedAt || r.dateUpdated || new Date().toLocaleString()}</td>
                  </tr>`).join('')}
              </tbody>
            </table>`
      }
    </div>`;
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function generateMeetingMinutes() {
  const date = document.getElementById('minutesMeetingDate')?.value || new Date().toISOString().split('T')[0];
  const nextDate = document.getElementById('minutesNextMeetingDate')?.value || '';
  const title = (document.getElementById('minutesMeetingTitle')?.value || '').trim() || 'Chama General Meeting';
  const venue = (document.getElementById('minutesVenue')?.value || '').trim() || 'Unspecified Venue';
  const chair = (document.getElementById('minutesChairperson')?.value || '').trim() || 'Chairperson';
  const secretary = (document.getElementById('minutesSecretary')?.value || '').trim() || 'Secretary';
  const attendees = (document.getElementById('minutesAttendees')?.value || '').trim() || 'No attendees listed.';
  const agenda = (document.getElementById('minutesAgenda')?.value || '').trim() || 'No agenda items provided.';
  const decisions = (document.getElementById('minutesDecisions')?.value || '').trim() || 'No decisions recorded.';
  const actions = (document.getElementById('minutesActionItems')?.value || '').trim() || 'No action items recorded.';

  generatedMinutesContent = 'CHAMA MEETING MINUTES\n\n' +
    `Meeting Date: ${date}\n` +
    `Next Meeting Date: ${nextDate}\n` +
    `Meeting Title: ${title}\n` +
    `Venue: ${venue}\n` +
    `Chairperson: ${chair}\n` +
    `Secretary: ${secretary}\n\n` +
    `Attendees:\n${attendees}\n\n` +
    `Agenda Items:\n${agenda}\n\n` +
    `Discussions and Decisions:\n${decisions}\n\n` +
    `Action Items:\n${actions}\n\n` +
    `Generated on: ${new Date().toLocaleString()}`;

  const preview = document.getElementById('minutesPreviewContainer');
  const status = document.getElementById('minutesStatusBadge');
  const downloadBtn = document.getElementById('minutesDownloadBtn');
  const shareBtn = document.getElementById('minutesShareBtn');
  if (preview) {
    preview.style.display = 'block';
    preview.textContent = generatedMinutesContent;
  }
  if (status) status.textContent = 'Minutes generated. Download or share below.';
  if (downloadBtn) downloadBtn.style.display = 'inline-flex';
  if (shareBtn) shareBtn.style.display = 'inline-flex';
}

function downloadMeetingMinutes() {
  if (!generatedMinutesContent) generateMeetingMinutes();
  if (!generatedMinutesContent) return;
  const blob = new Blob([generatedMinutesContent], { type: 'text/plain;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Meeting_Minutes_${Date.now()}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function shareMeetingMinutesEmail() {
  if (!generatedMinutesContent) generateMeetingMinutes();
  if (!generatedMinutesContent) return;
  const subject = encodeURIComponent('Chama Meeting Minutes');
  const body = encodeURIComponent(generatedMinutesContent);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

async function openDeletedMembersModal() {
  const old = document.getElementById('deletedMembersModal');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'deletedMembersModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.88);z-index:180000;display:flex;justify-content:center;align-items:flex-start;padding:40px 20px;overflow-y:auto;';
  overlay.innerHTML = `
    <div style="background:#1a1a2e;border:1px solid rgba(0,224,255,0.3);border-radius:12px;width:100%;max-width:860px;padding:28px;box-shadow:0 0 40px rgba(0,224,255,0.15);position:relative;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:14px;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:1.35rem;font-weight:bold;color:#fff;">Deleted Members Tracker</div>
          <div style="font-size:12px;color:#aaa;margin-top:4px;">Restore deleted approved member accounts.</div>
        </div>
        <button onclick="document.getElementById('deletedMembersModal').remove()" style="background:rgba(255,255,255,0.1);border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:16px;overflow:auto;flex:0 0 auto;">x</button>
      </div>
      <div id="deletedMembersContent" style="color:#aaa;text-align:center;padding:20px;font-style:italic;">Loading deleted records...</div>
    </div>`;
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  const content = overlay.querySelector('#deletedMembersContent');
  try {
    await loadVerificationDashboard();
    const rows = await apiCall('members/deleted', { method: 'GET' });
    const list = Array.isArray(rows) ? rows : (Array.isArray(rows && rows.data) ? rows.data : []);
    if (!list.length) {
      content.innerHTML = '<div style="color:#81c784;font-size:14px;padding:20px;">No deleted member records found.</div>';
      return;
    }
    content.innerHTML = `
      <div style="font-size:12px;color:#aaa;margin-bottom:14px;text-align:left;">${list.length} deleted record(s) found</div>
      <table style="width:100%;border-collapse:collapse;text-align:left;color:#fff;font-size:13px;background:rgba(0,0,0,0.4);border-radius:8px;overflow:hidden;">
        <thead style="background:rgba(255,255,255,0.1);font-size:12px;color:#ccc;">
          <tr><th style="padding:12px;">Member Name</th><th style="padding:12px;">Contact</th><th style="padding:12px;">Deleted At</th><th style="padding:12px;">Action</th></tr>
        </thead>
        <tbody>${list.map(m => `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:12px;"><strong>${m.full_name}</strong><br><span style="font-size:10px;color:#aaa;">Original ID: #${m.original_id}</span></td>
            <td style="padding:12px;font-size:12px;color:#aaa;">${m.email}<br>${m.phone || 'N/A'}</td>
            <td style="padding:12px;font-size:12px;color:#ccc;"><strong style="color:#ff9800;">${new Date(m.deleted_at).toLocaleString()}</strong><br><span style="font-size:10px;">By: ${m.deleted_by || 'admin'}</span></td>
            <td style="padding:12px;"><button onclick="restoreDeletedMember(${m.id}, this)" style="padding:8px 14px;background:#4caf50;border:none;border-radius:6px;color:#fff;font-weight:bold;cursor:pointer;font-size:11px;white-space:nowrap;overflow:auto;">Restore</button></td>
          </tr>`).join('')}</tbody>
      </table>`;
  } catch (e) {
    content.innerHTML = `<div style="color:#f44336;padding:20px;">Failed to load deleted records: ${e.message || e}</div>`;
  }
}

async function restoreDeletedMember(deletedId, btn) {
  if (!confirm('Restore this member back to the Approved Members Pool?')) return;
  btn.textContent = 'Restoring...';
  btn.disabled = true;
  try {
    await apiCall('members/restore', { method: 'POST', body: JSON.stringify({ deletedId: Number(deletedId) }) });
    logNotification(`Member Restore: Restored deleted member log ID ${deletedId} back to approved pool.`);
    await loadVerificationDashboard();
    document.getElementById('deletedMembersModal')?.remove();
    await openDeletedMembersModal();
  } catch (e) {
    alert('Restore failed: ' + (e.message || e));
    btn.textContent = 'Restore';
    btn.disabled = false;
  }
}

async function deleteSelectedMembers() {
  if (selectedLoanIds.length === 0) return alert('No tracking rows selected.');
  showAdminPasswordModal(`Delete ${selectedLoanIds.length} selected loan record(s)`, async (pass, modal) => {
    await verifyAdminPassword(pass);
    const selectedLoans = allLoansList.filter(l => selectedLoanIds.includes(String(l.id)));
    trackingMetrics.deletedProfilesLog.push(...selectedLoans.map(l => ({ ...l, dateDeleted: new Date().toLocaleString() })));
    await apiCall('loans/drop-many', { method: 'DELETE', body: JSON.stringify({ ids: selectedLoanIds }) });
    selectedLoanIds = [];
    modal.remove();
    await renderLoansTableDashboard();
    await loadDashboardTiles();
    alert('Selected loan records deleted successfully.');
  });
}

function deleteApprovedMember(memberId, memberName) {
  showAdminPasswordModal(`Delete Member: ${memberName}`, async (pass, modal, errorDiv) => {
    const res = await fetch(`${API}/members/approved/${memberId}`, {
      method: 'DELETE',
      headers: adminAuthHeaders(),
      body: JSON.stringify({ password: pass })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'fail' || data.status === 'error') {
      throw new Error(data.message || 'Incorrect admin password.');
    }
    modal.remove();
    logNotification(`Member Deleted: <strong>${memberName}</strong> (ID: ${memberId}) removed from approved pool.`);
    await loadVerificationDashboard();
    alert(`${memberName} has been deleted and logged to the deleted members tracker.`);
  });
}

async function settleLoanInstantly(loanId) {
  try {
    await apiCall('loans/settle', { method: 'POST', body: JSON.stringify({ id: loanId }) });
    logNotification(`Admin Action: Force-settled loan file <code>${loanId}</code>.`);
    await renderLoansTableDashboard();
  } catch (e) { alert(e.message || 'Settle failed.'); }
}

async function dropLoanFile(loanId) {
  if (!confirm('Drop this transaction track trace entry?')) return;
  try {
    // Log details of specific loan before deletion
    const targetLoan = allLoansList.find(l => String(l.id) === String(loanId));
    if (targetLoan) {
      trackingMetrics.deletedProfilesLog.push({ ...targetLoan, dateDeleted: new Date().toLocaleString() });
    }

    await apiCall('loans/drop', { method: 'DELETE', body: JSON.stringify({ id: loanId }) });
    await renderLoansTableDashboard();
    await loadDashboardTiles();
  } catch (e) { alert(e.message || 'Drop failed.'); }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  REPAYMENTS LEDGER  (DB-backed: approved_members + loans + repayments)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
async function renderRepaymentsLedger() {
  const tbody = document.getElementById('repaymentsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="4" style="opacity:0.6; font-style:italic; padding:14px;">Loading repayments ledger...</td></tr>';

  try {
    const data = await apiCall('repayments/all', { method: 'GET' });
    const memberLedger = Array.isArray(data?.memberLedger) ? data.memberLedger : [];

    if (memberLedger.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="opacity:0.6; font-style:italic; padding:14px;">No approved members found in ledger.</td></tr>';
      return;
    }

    tbody.innerHTML = memberLedger.map((m, idx) => {
      const debt      = Number(m.loanAmount  || 0);
      const savings   = Number(m.savingsAmount || 0);
      const cap       = savings * 3;
      const isOverLimit = debt > cap;
      const hasDebt     = debt > 0;

      let statusBadge = '';
      if (!hasDebt) {
        statusBadge = '<span style="color:#81c784; font-weight:bold;">[No Active Debts]</span>';
      } else if (isOverLimit) {
        statusBadge = '<span style="color:#f44336; font-weight:bold;">as i  REPAYMENT HAZARD: LOAN OVER LIMIT!</span>';
      } else {
        statusBadge = '<span style="color:#ff9800; font-weight:bold;">[Repayment Obligations Pending]</span>';
      }

      return `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${m.full_name}</strong></td>
          <td style="font-size:13px; line-height:1.8;">
            Debt Owed: <strong>KES ${debt.toFixed(2)}</strong> | Net Savings Base: <strong>KES ${savings.toFixed(2)}</strong><br>
            Accumulated Savings: KES ${savings.toFixed(2)}<br>
            Max Policy Cap (3x limit rule): KES ${cap.toFixed(2)}
          </td>
          <td>${statusBadge}</td>
        </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#ff9800; padding:14px;">Error: ${e.message}</td></tr>`;
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  CONTROL SECTOR DASHBOARD TILES  (DB stats)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
async function loadDashboardTiles(options = {}) {
  try {
    const stats = await apiCall('loans/stats', { method: 'GET' });

    const setTile = (id, val) => {
      const el = document.getElementById(id);
      const next = String(val ?? 0);
      if (el && el.innerText !== next) el.innerText = next;
    };

    setTile('tile-loanApplications', stats.loan_applications);
    setTile('tile-approvedLoans',    stats.approved_loans);
    setTile('tile-deniedLoans',      deniedMembers.length);
    setTile('tile-disbursedLoans',   stats.disbursed_loans);
    setTile('tile-repaymentRecords', stats.repayment_records);
    setTile('tile-overdueLoans',     stats.overdue_loans);
    setTile('tile-borrowers',        stats.borrowers);
    setTile('tile-loanProducts',     stats.loan_products);
    setTile('tile-users',            stats.users);
    setTile('tile-activeLoans',      stats.loan_applications); // active = applications

    // backward compat hidden spans
    const ac = document.getElementById('metricApprovedCount');
    if (ac) ac.innerText = membersArray.length;
    const pc = document.getElementById('metricPendingCount');
    if (pc) pc.innerText = pendingMembers.length;
    const lc = document.getElementById('metricLoansCount');
    if (lc) lc.innerText = stats.loan_applications;

    if (!options.background) {
      logNotification(`Dashboard: Refreshed tile counts at ${new Date().toLocaleTimeString()}`);
    }
  } catch (e) {
    console.warn('[loadDashboardTiles] failed:', e.message);
  }
}

function showNewLoanForm() { showSection('loans'); }
async function exportLoansToCSV() {
  try {
    const loans = await apiCall('loans/all', { method: 'GET' });
    if (!loans || loans.length === 0) return alert('No loan data to export.');

    const header = 'ID,Borrower Name,Amount (KES),Status,Date';
    const rows   = loans.map(l => `${l.id},"${l.borrower_name}",${l.amount},${l.status},${new Date(l.timestamp).toLocaleDateString()}`);
    const csv    = [header, ...rows].join('\n');
    const blob   = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link   = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Loans_Export_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logNotification('Export: Loans data exported to CSV file.');
  } catch (e) { alert(e.message); }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  TREASURER CONSOLE  (DB-backed)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
function syncGovernanceDOM() {
  renderSubsidiaryScopeOptions();
  populateSecretaryDropdowns();
  loadTreasurerStats();
  renderVoteResults();
  renderDragAndDropAgendas();
  executeVaultSearch();
  calculateDynamicCapTable();
}

async function renderSubsidiaryScopeOptions() {
  const sel = document.getElementById('subsidiaryScope');
  if (!sel) return;
  try {
    const rows = await apiCall('treasurer/subsidiaries', { method: 'GET' });
    governanceSuiteState.subsidiariesList = {};
    rows.forEach(r => { governanceSuiteState.subsidiariesList[r.slug] = r.display_name; });

    sel.innerHTML = rows.map(r => `<option value="${r.slug}" ${r.slug === governanceSuiteState.activeSubsidiary ? 'selected' : ''}>${r.display_name}</option>`).join('');
  } catch (e) {
    console.warn('[renderSubsidiaryScopeOptions]', e.message);
  }
}

function handleSubsidiarySwitch() {
  const sel = document.getElementById('subsidiaryScope');
  if (!sel) return;
  governanceSuiteState.activeSubsidiary = sel.value;
  logNotification(`Subsidiary: Switched to <strong>${governanceSuiteState.subsidiariesList[sel.value] || sel.value}</strong>`);
  loadTreasurerVotes();
}

async function addNewSubsidiary() {
  const input = document.getElementById('newSubsidiaryInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return alert('Please enter a chama cycle name.');

  const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  try {
    await apiCall('treasurer/subsidiaries/add', { method: 'POST', body: JSON.stringify({ slug, display_name: name }) });
    input.value = '';
    logNotification(`Subsidiary: Added new context <strong>${name}</strong>`);
    await renderSubsidiaryScopeOptions();
  } catch (e) { alert(e.message); }
}

async function deleteCurrentSubsidiary() {
  const sel = document.getElementById('subsidiaryScope');
  if (!sel || !sel.value) return alert('No subsidiary selected.');
  if (!confirm(`Delete subsidiary: "${sel.options[sel.selectedIndex]?.text}"?`)) return;
  try {
    await apiCall('treasurer/subsidiaries/delete', { method: 'DELETE', body: JSON.stringify({ slug: sel.value }) });
    logNotification(`Subsidiary: Deleted context <strong>${sel.value}</strong>`);
    governanceSuiteState.activeSubsidiary = 'eldoret_main';
    await renderSubsidiaryScopeOptions();
  } catch (e) { alert(e.message); }
}

function setAuthRole(role) {
  governanceSuiteState.currentSessionRole = role;
  const badge = document.getElementById('activeRoleBadge');
  if (badge) badge.innerText = role;
  const clearanceTxt = document.getElementById('vaultClearanceTxt');
  if (clearanceTxt) clearanceTxt.innerText = 'Granted';
  logNotification(`Role Change: Workspace operational tracking role shifted to <strong>${role}</strong>.`);
}

async function castResolutionVote(type) {
  try {
    await apiCall('treasurer/vote', {
      method: 'POST',
      body: JSON.stringify({ vote_type: type, subsidiary_slug: governanceSuiteState.activeSubsidiary })
    });
    logNotification(`Vote cast: Logged ballot node inside [${type}] bucket.`);
    await loadTreasurerVotes();
  } catch (e) { alert(e.message); }
}

async function loadTreasurerVotes() {
  try {
    const tally = await apiCall(`treasurer/votes?subsidiary_slug=${encodeURIComponent(governanceSuiteState.activeSubsidiary)}`, { method: 'GET' });
    governanceSuiteState.resolutionVoteRecord = tally;
    renderVoteResults();
  } catch (e) { console.warn('[loadTreasurerVotes]', e.message); }
}

function renderVoteResults() {
  const display = document.getElementById('resolutionStatusSummary');
  if (!display) return;
  const r = governanceSuiteState.resolutionVoteRecord;
  display.innerHTML = `Resolution Ledger a' Approved: <strong>[${r.Approve||0}]</strong> | Abstained: <strong>[${r.Abstain||0}]</strong> | Rejected: <strong>[${r.Reject||0}]</strong>`;
}

function populateSecretaryDropdowns() {
  const dropdowns = ['secContactDropdown', 'secTxDropdown', 'complianceMemberSelect'];
  dropdowns.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = `<option value="">-- Choose an Active Member --</option>`;
    membersArray.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${i + 1}. ${m.full_name || m.name} (${m.email})`;
      el.appendChild(opt);
    });
    if (membersArray.some(m => String(m.id) === prev)) el.value = prev;
  });
  updateContactLink();
  syncComplianceFormView();
}

function updateContactLink() {
  const dropdown  = document.getElementById('secContactDropdown');
  const container = document.getElementById('contactLinkContainer');
  const target = document.getElementById('realtimeMemberTarget');
  const nameInput = document.getElementById('realtimeMemberName');
  const emailInput = document.getElementById('realtimeMemberEmail');
  if (!dropdown || !container) return;
  const mId = dropdown.value;
  if (!mId) {
    container.innerHTML = '';
    if (target) target.textContent = 'Choose an active member above';
    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
    return;
  }
  const member = membersArray.find(m => String(m.id) === mId);
  if (member) {
    const name = member.full_name || member.name || 'Selected member';
    const email = member.email || '';
    container.innerHTML = `<a class="inline-link-btn" href="mailto:${encodeURIComponent(email)}">Open Thread: ${email}</a>`;
    if (target) target.textContent = `Live target: ${name}${email ? ' | ' + email : ''}`;
    if (nameInput) nameInput.value = name;
    if (emailInput) emailInput.value = email;
  }
}

function handleTxDropdownChange() {
  const dropdown = document.getElementById('secTxDropdown');
  if (!dropdown) return;
  const member = membersArray.find(m => String(m.id) === dropdown.value);
  if (member) {
    document.getElementById('secLoanAmount').value    = member.loanAmount    || '';
    document.getElementById('secSavingsAmount').value = member.savingsAmount || '';
    calculateSecEligibility();
  } else {
    document.getElementById('secLoanAmount').value    = '';
    document.getElementById('secSavingsAmount').value = '';
    document.getElementById('secEligibilityOutput').innerText = 'KES 0.00';
  }
}

function calculateSecEligibility() {
  const savings   = parseFloat(document.getElementById('secSavingsAmount').value) || 0;
  const maxLimit  = savings * 3;
  document.getElementById('secEligibilityOutput').innerText = `KES ${maxLimit.toFixed(2)}`;
}

async function submitLoanTx() {
  const dropdown = document.getElementById('secTxDropdown');
  const amount   = parseFloat(document.getElementById('secLoanAmount').value) || 0;
  if (!dropdown.value) return alert('Select a target member profile first.');

  const member = membersArray.find(m => String(m.id) === dropdown.value);
  if (member) {
    const ceiling = (member.savingsAmount || 0) * 3;
    if (amount > ceiling) {
      if (!confirm(`as i  Policy Violation: Requested KES ${amount.toFixed(2)} exceeds 3x savings ceiling of KES ${ceiling.toFixed(2)}.\n\nProceed anyway?`)) return;
    }
  }

  try {
    await apiCall('treasurer/update-balances', {
      method: 'POST',
      body: JSON.stringify({ member_id: dropdown.value, loanAmount: amount })
    });
    logNotification(`Treasurer: Updated loan liability for <strong>${member?.full_name || dropdown.value}</strong> a' KES ${amount.toFixed(2)}`);
    trackingMetrics.updatedProfilesHistory.push({ id: dropdown.value, field: 'loanAmount', value: amount, loggedAt: new Date().toLocaleString() });
    await loadTreasurerStats();
    await renderRepaymentsLedger();
    alert('Loan balance updated and logged to database.');
  } catch (e) { alert(e.message || 'Update failed.'); }
}

async function submitSavingsTx() {
  const dropdown = document.getElementById('secTxDropdown');
  const amount   = parseFloat(document.getElementById('secSavingsAmount').value) || 0;
  if (!dropdown.value) return alert('Select a target member profile first.');

  try {
    await apiCall('treasurer/update-balances', {
      method: 'POST',
      body: JSON.stringify({ member_id: dropdown.value, savingsAmount: amount })
    });
    const member = membersArray.find(m => String(m.id) === dropdown.value);
    logNotification(`Treasurer: Updated savings footprint for <strong>${member?.full_name || dropdown.value}</strong> a' KES ${amount.toFixed(2)}`);
    trackingMetrics.updatedProfilesHistory.push({ id: dropdown.value, field: 'savingsAmount', value: amount, loggedAt: new Date().toLocaleString() });
    calculateSecEligibility();
    await loadTreasurerStats();
    await renderRepaymentsLedger();
    alert('Savings balance updated and logged to database.');
  } catch (e) { alert(e.message || 'Update failed.'); }
}

async function loadTreasurerStats() {
  try {
    const stats = await apiCall('treasurer/stats', { method: 'GET' });
    const elLoans   = document.getElementById('hubTotalLoans');
    const elSavings = document.getElementById('hubTotalSavings');
    const elRisk    = document.getElementById('hubRiskFactor');
    if (elLoans)   elLoans.innerText   = `KES ${Number(stats.totalLoans   || 0).toFixed(2)}`;
    if (elSavings) elSavings.innerText = `KES ${Number(stats.totalSavings || 0).toFixed(2)}`;
    if (elRisk)    elRisk.innerText    = stats.riskFactor || 'Stable';
  } catch (e) { console.warn('[loadTreasurerStats]', e.message); }
}

function syncComplianceFormView() {
  const sel     = document.getElementById('complianceMemberSelect');
  const preview = document.getElementById('pdfPreviewContainer');
  const notice  = document.getElementById('complianceNoticeBox');
  if (!sel || !preview) return;
  const mId     = sel.value;
  if (!mId) {
    preview.innerHTML = '';
    if (notice) notice.innerHTML = '<strong>Validation Status:</strong> Choose a member record below to trigger the policy verification mechanism.';
    return;
  }
  const member = membersArray.find(m => String(m.id) === mId);
  if (!member) return;
  const savings  = Number(member.savingsAmount || 0);
  const loan     = Number(member.loanAmount || 0);
  const cap      = savings * 3;
  const ok       = loan <= cap;
  const memberLoans = (allLoansList || []).filter(l => String(l.borrower_id) === String(mId));
  const loanStatus = memberLoans.length > 0
    ? memberLoans.map(l => `${l.status} (KES ${Number(l.amount).toLocaleString()})`).join(', ')
    : 'No Active Loans';
  if (notice) notice.innerHTML = ok
    ? `<strong>Validation Status:</strong> Policy check PASSED for <strong>${member.full_name || member.name}</strong>. Loan within 3x savings ceiling.`
    : `<strong>Validation Status:</strong> POLICY VIOLATION detected for <strong>${member.full_name || member.name}</strong>. Loan exceeds 3x savings limit!`;
    preview.innerHTML = `
    <div style="font-family:monospace; font-size:12px; line-height:1.8;">
      <strong><h4 style=" text-align: center; text-decoration: underline;">OFFICIAL REGISTRY SHEET</h4></strong><br>
      <br>
      Member: ${member.full_name || member.name}<br>
      Email: <a href="mailto:${member.email}">${member.email}</a><br>
      Phone: ${member.phone || 'N/A'}<br>
      ID:     ${member.id}<br>
    -----------------------------------------<br>
      Loan Balance:   KES ${loan.toFixed(2)}<br>
      Loan Status:    ${loanStatus}<br>
      Savings:        KES ${savings.toFixed(2)}<br>
      3x Cap:         KES ${cap.toFixed(2)}<br>
    -----------------------------------------<br>
      Status: ${ok ? 'COMPLIANT' : 'OVER LIMIT'}
    </div>`;
}

function executeVaultSearch() {
  const input   = document.getElementById('vaultSearchInput');
  const results = document.getElementById('vaultSearchResults');
  if (!input || !results) return;
  const q = (input.value || '').toLowerCase().trim();
  if (!q) { results.innerHTML = ''; return; }

  const matches = membersArray.filter(m =>
    (m.full_name || m.name || '').toLowerCase().includes(q) ||
    (m.email || '').toLowerCase().includes(q) ||
    String(m.loanAmount || '').includes(q) ||
    String(m.savingsAmount || '').includes(q)
  );

  results.innerHTML = matches.length === 0
    ? '<p style="padding:8px; opacity:0.6;">No records matched search parameters.</p>'
    : matches.map(m => `
        <div style="padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.06);">
          <strong>${m.full_name || m.name}</strong> | ${m.email}<br>
          <small style="opacity:0.7;">Loan: KES ${Number(m.loanAmount||0).toFixed(2)} | Savings: KES ${Number(m.savingsAmount||0).toFixed(2)}</small>
        </div>`).join('');
}

function calculateDynamicCapTable() {
  const bar       = document.getElementById('dynamicCapBar');
  const labelsBox = document.getElementById('capLabelsContainer');
  if (!bar || !labelsBox) return;

  const totalSavings = membersArray.reduce((s, m) => s + Number(m.savingsAmount || 0), 0);
  if (totalSavings === 0 || membersArray.length === 0) {
    bar.innerHTML    = '<div style="height:30px; background:rgba(255,255,255,0.08); border-radius:6px; display:flex; align-items:center; padding:0 12px; font-size:12px; opacity:0.5;">No savings data</div>';
    labelsBox.innerHTML = '';
    return;
  }

  const colors = ['#00e0ff','#4caf50','#ff9800','#9c27b0','#e91e63','#00bcd4','#ffc107','#f44336'];
  let barHTML = '', labelHTML = '';

  membersArray.forEach((m, i) => {
    const savings = Number(m.savingsAmount || 0);
    const pct     = ((savings / totalSavings) * 100).toFixed(1);
    const color   = colors[i % colors.length];
    barHTML  += `<div style="width:${pct}%; background:${color}; height:30px; display:inline-block;" title="${m.full_name || m.name}: ${pct}%"></div>`;
    labelHTML += `<div style="display:flex; align-items:center; gap:5px;"><span style="display:inline-block; width:12px; height:12px; background:${color}; border-radius:2px;"></span><span>${m.full_name || m.name}: ${pct}%</span></div>`;
  });

  bar.innerHTML       = `<div style="display:flex; height:30px; border-radius:6px; overflow:hidden;">${barHTML}</div>`;
  labelsBox.innerHTML = labelHTML;
}

function renderDragAndDropAgendas() {
  const pool   = document.getElementById('documentPool');
  const agenda = document.getElementById('agendaTimeline');
  if (!pool || !agenda) return;

  const poolMembers   = membersArray.filter(m => !governanceSuiteState.agendaAssignedMemberIds.includes(String(m.id)));
  const agendaMembers = membersArray.filter(m =>  governanceSuiteState.agendaAssignedMemberIds.includes(String(m.id)));

  const renderBox = (el, items, boxType) => {
    el.dataset.dropTarget = boxType;
    el.innerHTML = `<div class="drag-box-header">${boxType === 'pool' ? 'Member Pool' : 'Agenda Timeline'}</div>`;
    if (items.length === 0) {
      el.innerHTML += `<div class="drag-empty">Drop members here</div>`;
      return;
    }
    items.forEach(m => {
      const div = document.createElement('div');
      div.className = 'drag-item';
      div.draggable = true;
      div.dataset.id = String(m.id);
      div.dataset.sourceBox = boxType;
      div.innerHTML = `
        <span class="drag-item-copy"><strong>${m.full_name || m.name}</strong><small>${m.email || ''}</small></span>
        <button type="button" class="drag-move-btn" title="${boxType === 'pool' ? 'Move to agenda timeline' : 'Return to member pool'}" aria-label="${boxType === 'pool' ? 'Move to agenda timeline' : 'Return to member pool'}">${boxType === 'pool' ? 'Add' : 'Return'}</button>`;
      div.addEventListener('dragstart', e => {
        draggedAgendaMemberId = String(m.id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(m.id));
        e.dataTransfer.setData('application/x-member-id', String(m.id));
        div.classList.add('dragging');
      });
      div.addEventListener('dragend', () => {
        draggedAgendaMemberId = '';
        div.classList.remove('dragging');
        clearAgendaDropHighlights();
      });
      div.addEventListener('pointerdown', e => beginAgendaPointerDrag(e, String(m.id), boxType, div));
      div.addEventListener('pointermove', updateAgendaPointerDrag);
      div.addEventListener('pointerup', finishAgendaPointerDrag);
      div.addEventListener('pointercancel', cancelAgendaPointerDrag);
      div.addEventListener('dblclick', () => moveAgendaMember(String(m.id), boxType === 'pool' ? 'agenda' : 'pool'));
      div.querySelector('.drag-move-btn')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        moveAgendaMember(String(m.id), boxType === 'pool' ? 'agenda' : 'pool');
      });
      // selection for copy/paste
      div.addEventListener('click', (ev) => {
        if (suppressAgendaClick) {
          suppressAgendaClick = false;
          return;
        }
        if (ev.ctrlKey || ev.metaKey) {
          div.classList.toggle('selected');
        } else {
          // single select
          Array.from(el.querySelectorAll('.drag-item.selected')).forEach(x => x.classList.remove('selected'));
          div.classList.add('selected');
        }
      });
      el.appendChild(div);
    });
  };

  renderBox(pool,   poolMembers,   'pool');
  renderBox(agenda, agendaMembers, 'agenda');
  bindAgendaDropZone(pool, 'pool');
  bindAgendaDropZone(agenda, 'agenda');
}

function bindAgendaDropZone(el, targetBox) {
  if (!el) return;
  el.ondragover = (e) => allowDrop(e);
  el.ondragenter = (e) => handleDragEnter(e, el.id);
  el.ondragleave = (e) => handleDragLeave(e, el.id);
  el.ondrop = (e) => handleDocumentDrop(e, targetBox);
}

function allowDrop(e) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e, boxId) {
  e.preventDefault();
  try { document.getElementById(boxId)?.classList.add('drop-over'); } catch(e){}
}

function handleDragLeave(e, boxId) {
  const box = document.getElementById(boxId);
  if (box && e.relatedTarget && box.contains(e.relatedTarget)) return;
  try { document.getElementById(boxId)?.classList.remove('drop-over'); } catch(e){}
}

function handleDocumentDrop(e, targetBox) {
  e.preventDefault();
  const memberId = e.dataTransfer.getData('application/x-member-id') || e.dataTransfer.getData('text/plain') || draggedAgendaMemberId;
  if (!memberId) return;
  moveAgendaMember(memberId, targetBox);
}

function moveAgendaMember(memberId, targetBox) {
  if (targetBox === 'agenda') {
    if (!governanceSuiteState.agendaAssignedMemberIds.includes(memberId))
      governanceSuiteState.agendaAssignedMemberIds.push(memberId);
  } else {
    governanceSuiteState.agendaAssignedMemberIds = governanceSuiteState.agendaAssignedMemberIds.filter(id => id !== memberId);
  }
  draggedAgendaMemberId = '';
  clearAgendaDropHighlights();
  renderDragAndDropAgendas();
}

function clearAgendaDropHighlights() {
  try { document.getElementById('documentPool')?.classList.remove('drop-over'); } catch(e){}
  try { document.getElementById('agendaTimeline')?.classList.remove('drop-over'); } catch(e){}
}

function beginAgendaPointerDrag(e, memberId, sourceBox, itemEl) {
  if (e.button !== 0 || e.target.closest('.drag-move-btn')) return;
  pointerAgendaDrag = {
    memberId,
    sourceBox,
    itemEl,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    ghost: null
  };
  try { itemEl.setPointerCapture(e.pointerId); } catch (_) {}
}

function updateAgendaPointerDrag(e) {
  if (!pointerAgendaDrag || pointerAgendaDrag.pointerId !== e.pointerId) return;
  const dx = Math.abs(e.clientX - pointerAgendaDrag.startX);
  const dy = Math.abs(e.clientY - pointerAgendaDrag.startY);

  if (!pointerAgendaDrag.active && dx + dy > 8) {
    pointerAgendaDrag.active = true;
    suppressAgendaClick = true;
    pointerAgendaDrag.itemEl.classList.add('dragging');
    pointerAgendaDrag.ghost = pointerAgendaDrag.itemEl.cloneNode(true);
    pointerAgendaDrag.ghost.classList.add('agenda-drag-ghost');
    pointerAgendaDrag.ghost.querySelector('.drag-move-btn')?.remove();
    document.body.appendChild(pointerAgendaDrag.ghost);
  }

  if (!pointerAgendaDrag.active) return;
  e.preventDefault();
  moveAgendaGhost(e.clientX, e.clientY);
  setAgendaDragOverFromPoint(e.clientX, e.clientY);
}

function finishAgendaPointerDrag(e) {
  if (!pointerAgendaDrag || pointerAgendaDrag.pointerId !== e.pointerId) return;
  const dragState = pointerAgendaDrag;
  const wasActive = dragState.active;
  const dropBox = getAgendaDropBoxFromPoint(e.clientX, e.clientY);

  cancelAgendaPointerDrag(e);

  if (wasActive && dropBox) {
    moveAgendaMember(dragState.memberId, dropBox.dataset.dropTarget || (dropBox.id === 'agendaTimeline' ? 'agenda' : 'pool'));
  }
}

function cancelAgendaPointerDrag(e) {
  if (!pointerAgendaDrag) return;
  try { pointerAgendaDrag.itemEl.releasePointerCapture(e?.pointerId); } catch (_) {}
  pointerAgendaDrag.itemEl.classList.remove('dragging');
  pointerAgendaDrag.ghost?.remove();
  pointerAgendaDrag = null;
  clearAgendaDropHighlights();
}

function moveAgendaGhost(x, y) {
  if (!pointerAgendaDrag?.ghost) return;
  pointerAgendaDrag.ghost.style.left = `${x + 12}px`;
  pointerAgendaDrag.ghost.style.top = `${y + 12}px`;
}

function getAgendaDropBoxFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest?.('#documentPool, #agendaTimeline') || null;
}

function setAgendaDragOverFromPoint(x, y) {
  clearAgendaDropHighlights();
  const box = getAgendaDropBoxFromPoint(x, y);
  box?.classList.add('drop-over');
}

function sendEmail(event) {
  if (event) event.preventDefault();
  const dropdown = document.getElementById('secContactDropdown');
  const member   = membersArray.find(m => String(m.id) === (dropdown?.value || ''));
  if (!member) {
    alert('Please select a member from the Contact dropdown first.');
    return;
  }

  const nameInput = document.getElementById('realtimeMemberName');
  const emailInput = document.getElementById('realtimeMemberEmail');
  const subjectInput = document.getElementById('realtimeMemberSubject');
  const messageInput = document.getElementById('realtimeMemberMessage');
  const toEmail = (member.email || emailInput?.value || '').trim();
  const fullName = (nameInput?.value || member.full_name || member.name || 'Member').trim();
  const subject = (subjectInput?.value || '').trim();
  const message = (messageInput?.value || '').trim();

  if (!toEmail) return alert('Selected member does not have an email address.');
  if (!subject) return alert('Please enter a subject.');
  if (!message) return alert('Please write a message first.');

  const body = `Hello ${fullName},\n\n${message}`;
  window.location.href = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (subjectInput) subjectInput.value = '';
  if (messageInput) messageInput.value = '';
}

// Copy/Paste buffer for drag items (IDs)
const dragCopyBuffer = [];

// Global keyboard handlers: Ctrl+C to copy selected drag-items, Ctrl+V to paste duplicates into pool
document.addEventListener('keydown', async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    // copy selected drag items
    const selected = Array.from(document.querySelectorAll('.drag-item.selected'));
    if (selected.length === 0) return;
    const text = selected.map(s => s.innerText.trim()).join('\n');
    try { await navigator.clipboard.writeText(text); } catch (err) {}
    // store ids in buffer
    dragCopyBuffer.length = 0;
    selected.forEach(s => dragCopyBuffer.push(s.dataset.id));
    // user feedback
    console.info(`Copied ${dragCopyBuffer.length} items to buffer.`);
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
    // paste buffer into documentPool
    if (dragCopyBuffer.length === 0) return;
    const pool = document.getElementById('documentPool');
    if (!pool) return;
    // find member objects and append visuals
    dragCopyBuffer.forEach(id => {
      const member = membersArray.find(m => String(m.id) === String(id));
      if (!member) return;
      const div = document.createElement('div');
      div.className = 'drag-item';
      div.draggable = true;
      div.dataset.id = String(member.id);
      div.innerHTML = `<strong>${member.full_name || member.name}</strong><br><small style="opacity:0.65;">${member.email}</small>`;
      pool.appendChild(div);
    });
    console.info('Pasted', dragCopyBuffer.length, 'items into pool');
  }
});

// Registry export/download/share/copy
function buildRegistryText(memberId) {
  if (memberId) {
    const m = (membersArray || []).find(x => String(x.id) === String(memberId));
    if (!m) return '';
    const savings = Number(m.savingsAmount || 0);
    const loan = Number(m.loanAmount || 0);
    const cap = savings * 3;
    const memberLoans = (allLoansList || []).filter(l => String(l.borrower_id) === String(memberId));
    const loanStatus = memberLoans.length > 0
      ? memberLoans.map(l => `${l.status} (KES ${Number(l.amount).toLocaleString()})`).join(', ')
      : 'No Active Loans';
    return `CHAMA OFFICIAL REGISTRY\nMember: ${m.full_name || m.name}\nEmail: ${m.email}\nPhone: ${m.phone || 'N/A'}\nID: ${m.id}\nLoan Balance: KES ${loan.toFixed(2)}\nLoan Status: ${loanStatus}\nSavings: KES ${savings.toFixed(2)}\n3x Cap: KES ${cap.toFixed(2)}\nStatus: ${loan <= cap ? 'COMPLIANT' : 'OVER LIMIT'}`;
  }

  const header = ['id','full_name','email','phone','status'].join(',');
  const rows = (membersArray || []).map(m => [m.id, (m.full_name||m.name), (m.email||''), (m.phone||''), (m.status||'')].map(c => '"'+String(c).replace(/"/g,'""')+'"').join(','));
  return [header, ...rows].join('\n');
}

function normalizeSmsPhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw || raw.toLowerCase() === 'n/a' || raw.toLowerCase() === 'no phone') return '';
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (!cleaned || cleaned.length < 7) return '';
  return cleaned.startsWith('+') ? '+' + cleaned.slice(1).replace(/\+/g, '') : cleaned.replace(/\+/g, '');
}

function getRegistryShareMembers(memberId) {
  if (memberId) {
    const one = (membersArray || []).find(x => String(x.id) === String(memberId));
    return one ? [one] : [];
  }
  return membersArray || [];
}

function buildSmsUri(numbers, body) {
  const recipients = numbers.join(',');
  const encodedBody = encodeURIComponent(body.slice(0, 1400));
  return `sms:${recipients}?body=${encodedBody}`;
}

function downloadRegistry() {
  try {
    const sel = document.getElementById('complianceMemberSelect');
    const selId = sel?.value || '';
    const txt = buildRegistryText(selId || undefined);
    if (!txt) return alert('No registry data available');
    const blob = new Blob([txt], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `chama_registry_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) { alert('Download failed: ' + (e.message || e)); }
}

async function shareRegistry() {
  try {
    const sel = document.getElementById('complianceMemberSelect');
    const selId = sel?.value || '';
    const txt = buildRegistryText(selId || undefined);
    if (!txt) return alert('No registry data to share');
    const shareMembers = getRegistryShareMembers(selId || undefined);
    const phones = [...new Set(shareMembers.map(m => normalizeSmsPhone(m.phone)).filter(Boolean))];
    if (phones.length > 0) {
      window.location.href = buildSmsUri(phones, txt);
      return;
    }
    if (navigator.share) {
      const file = new File([txt], `chama_registry_${Date.now()}.csv`, { type: 'text/csv' });
      await navigator.share({ files: [file], title: 'Chama Registry', text: 'Chama registry export' });
      return;
    }
    await copyTextToClipboard(txt);
    alert('No member phone numbers were found. Registry copied to clipboard instead.');
  } catch (e) { alert('Share failed: ' + (e.message || e)); }
}

function copyRegistryToClipboard() {
  try {
    const sel = document.getElementById('complianceMemberSelect');
    const selId = sel?.value || '';
    const txt = buildRegistryText(selId || undefined);
    if (!txt) return alert('No registry data');
    copyTextToClipboard(txt)
      .then(() => alert('Registry copied to clipboard.'))
      .catch(err => alert('Copy failed: ' + (err.message || err)));
  } catch (e) { alert('Copy failed: ' + (e.message || e)); }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  AUTOMATION  (DB-backed: automation_admins + scheduled_meetings)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
async function loadAutomationAdmins() {
  try {
    const rows = await apiCall('automation/admins', { method: 'GET' });
    automationAdmins = (rows || []).map(r => r.email);
    renderAdmins();
  } catch (e) { console.warn('[loadAutomationAdmins]', e.message); }
}

function renderAdmins() {
  const ul = document.getElementById('automationAdminList');
  if (!ul) return;
  ul.innerHTML = automationAdmins.length === 0
    ? '<li style="opacity:0.6; font-style:italic;">No admins registered.</li>'
    : automationAdmins.map(a => `<li>${a}</li>`).join('');
}

async function addAutomationAdmin() {
  const input = document.getElementById('automationEmail');
  if (!input) return;
  const email = input.value.trim();
  if (!email) return alert('Please enter an email address.');

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return alert('Please enter a valid email address.');

  try {
    await apiCall('automation/admins/add', { method: 'POST', body: JSON.stringify({ email }) });
    logNotification(`Automation: Registered admin <strong>${email}</strong>`);
    input.value = '';
    await loadAutomationAdmins();
  } catch (e) { alert(e.message || 'Error adding admin.'); }
}

function clearAutomationAdminInput() {
  const input = document.getElementById('automationEmail');
  if (input) input.value = '';
}

function saveAutomationPrefs() {
  const emailToggle = document.getElementById('emailNotificationToggle');
  const smsToggle   = document.getElementById('telSmsToggle');
  localStorage.setItem('autoEmailToggle', emailToggle?.checked ? '1' : '0');
  localStorage.setItem('autoSmsToggle',   smsToggle?.checked   ? '1' : '0');
}

async function loadAutomationMeetings() {
  try {
    const rows = await apiCall('automation/meetings', { method: 'GET' });
    scheduledMeetings = rows || [];
    renderMeetingsList();
  } catch (e) { console.warn('[loadAutomationMeetings]', e.message); }
}

function renderMeetingsList() {
  const container = document.getElementById('scheduledMeetingsList');
  if (!container) return;
  container.innerHTML = scheduledMeetings.length === 0
    ? '<div style="opacity:0.6; font-style:italic; font-size:13px;">No meetings scheduled yet.</div>'
    : scheduledMeetings.map(m => `
        <div style="background:rgba(0,224,255,0.06); border:1px solid rgba(0,224,255,0.15); border-radius:8px; padding:10px 14px;">
          <strong>${m.title}</strong>
          <span style="margin-left:10px; font-size:12px; color:#00e0ff;">[${m.platform}]</span><br>
          <small style="opacity:0.7;">Y"... ${m.meeting_date} at ${m.meeting_time} | Group: ${m.target_group}</small>
          ${m.location ? `<br><small style="opacity:0.6;">Y"- ${m.location}</small>` : ''}
        </div>`).join('');
}

async function createBroadcastMeeting() {
  const title       = (document.getElementById('meetingTitle')?.value       || '').trim();
  const date        = document.getElementById('meetingDate')?.value          || '';
  const time        = document.getElementById('meetingTime')?.value          || '';
  const location    = document.getElementById('meetingLocation')?.value      || '';
  const platform    = document.getElementById('meetingPlatformType')?.value  || 'Email Engine';
  const targetGroup = document.getElementById('meetingTargetGroup')?.value   || 'all';

  if (!title) return alert('Please enter a meeting title.');
  if (!date)  return alert('Please select a meeting date.');
  if (!time)  return alert('Please select a meeting time.');

  try {
    await apiCall('automation/meetings/create', {
      method: 'POST',
      body: JSON.stringify({
        title, meeting_date: date, meeting_time: time, location,
        platform, target_group: targetGroup,
        subsidiary_slug: governanceSuiteState.activeSubsidiary
      })
    });
    logNotification(`Automation: Scheduled broadcast meeting a" <strong>${title}</strong> on ${date} at ${time}`);
    pushMemberNotification(`New ${platform} Meeting Scheduled: ${title} on ${date} at ${time}`);

    // Clear form
    ['meetingTitle','meetingDate','meetingTime','meetingLocation'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    await loadAutomationMeetings();
  } catch (e) { alert(e.message || 'Error scheduling meeting.'); }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  SETTINGS  (UI preferences a' localStorage only)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
function changeBackground() {
  const url = (document.getElementById('bgImage')?.value || '').trim();
  if (!url) return alert('Please enter a background image URL.');
  document.body.style.background    = `url('${url}') no-repeat center center fixed`;
  document.body.style.backgroundSize = 'cover';
  localStorage.setItem('sys_bg', url);
  logNotification('Settings: Applied custom background wallpaper URL.');
}

function changeFont() {
  const font = document.getElementById('fontSelect')?.value;
  if (!font) return;
  document.body.style.fontFamily = font;
  localStorage.setItem('sys_font', font);
  logNotification(`Settings: Font family updated to <strong>${font}</strong>.`);
}

function changeFontSize() {
  const size = document.getElementById('fontSize')?.value;
  if (!size) return alert('Please enter a font size value in pixels.');
  document.body.style.fontSize = `${size}px`;
  localStorage.setItem('sys_size', size);
  logNotification(`Settings: Interface scale set to <strong>${size}px</strong>.`);
}

const THEMES = {
  gradient:    { '--bg-base': 'transparent',  '--text-main': '#e8eaf6' },
  light:       { '--bg-base': '#ffffff',  '--text-main': '#222222' },
  dark:        { '--bg-base': '#121212',  '--text-main': '#f5f5f5' },
  emerald:     { '--bg-base': '#0b2914',  '--text-main': '#e8f5e9' },
  ocean:       { '--bg-base': '#002233',  '--text-main': '#e0f7fa' },
  sunset:      { '--bg-base': '#1a0033',  '--text-main': '#ffe0f0' },
  royal:       { '--bg-base': '#1a0044',  '--text-main': '#f3e5f5' },
  monochrome:  { '--bg-base': '#000000',  '--text-main': '#ffffff' },
  nordic:      { '--bg-base': '#eceff4',  '--text-main': '#2e3440' },
  chocolate:   { '--bg-base': '#1c0f00',  '--text-main': '#ffe0b2' }
};

function applyTheme() {
  const theme = document.getElementById('themeSelect')?.value || 'gradient';
  const map   = THEMES[theme] || THEMES.gradient;
  const root  = document.documentElement;
  Object.entries(map).forEach(([k, v]) => root.style.setProperty(k, v));
  localStorage.setItem('sys_theme', theme);
  logNotification(`Settings: Theme palette switched to <strong>${theme}</strong>.`);
}

function loadCustomStylesFromStorage() {
  const font  = localStorage.getItem('sys_font');
  const size  = localStorage.getItem('sys_size');
  const bg    = localStorage.getItem('sys_bg');
  const theme = localStorage.getItem('sys_theme');

  if (font)  { document.body.style.fontFamily = font; const el = document.getElementById('fontSelect');  if (el) el.value = font;  }
  if (size)  { document.body.style.fontSize = `${size}px`; const el = document.getElementById('fontSize'); if (el) el.value = size;  }
  if (bg)    { document.body.style.background = `url('${bg}') no-repeat center center fixed`; document.body.style.backgroundSize = 'cover'; const el = document.getElementById('bgImage'); if (el) el.value = bg; }
  if (theme) { const el = document.getElementById('themeSelect'); if (el) el.value = theme; applyTheme(); }

  // Restore automation checkboxes
  const et = localStorage.getItem('autoEmailToggle');
  const st = localStorage.getItem('autoSmsToggle');
  const etEl = document.getElementById('emailNotificationToggle');
  const stEl = document.getElementById('telSmsToggle');
  if (etEl && et) etEl.checked = et === '1';
  if (stEl && st) stEl.checked = st === '1';
}

function resetSettings() {
  if (confirm('as i  This operation clears all local cache and preferences.\n\nProceed to reset app environment?')) {
    localStorage.clear();
    location.reload();
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  UTILITY / MISC
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
function filterMemberGridDisplay(filterMode) {
  trackingMetrics.activeFilterMode = filterMode;
  renderAllLists();
}

function toggleHushedMenu() {
  const menu = document.getElementById('adminAccountDropdown');
  if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function openTileDetail(tileId) {
  const sectionMap = {
    loanApplications: 'loans',
    approvedLoans:    'loans',
    deniedLoans:      'members',
    disbursedLoans:   'loans',
    repaymentRecords: 'repayments',
    overdueLoans:     'loans',
    borrowers:        'members',
    loanProducts:     'loans',
    users:            'secretaryHub'
  };
  const target = sectionMap[tileId] || 'controlSector';
  showSection(target);
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  CORPORATE PORTAL INTERACTIVITY & FEEDBACK
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
function logCorporateAction(message) {
  logNotification(`Corporate Portal: ${message}`);
  showToast(`Action Triggered: ${message}`, 'success');
}

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 10000;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: rgba(15, 32, 39, 0.95);
    color: #fff;
    padding: 14px 20px;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    font-size: 13px;
    min-width: 280px;
    max-width: 400px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(0, 224, 255, 0.15);
    border-left: 4px solid #00e0ff;
    transform: translateX(120%);
    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    pointer-events: auto;
    font-family: 'Poppins', sans-serif;
  `;

  if (type === 'success') {
    toast.style.borderLeftColor = '#81c784';
    toast.style.borderRightColor = 'transparent';
  } else if (type === 'warning') {
    toast.style.borderLeftColor = '#ff9800';
  }

  toast.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:16px;">
      <span style="font-weight:500; letter-spacing:0.3px;">${message}</span>
      <span style="cursor:pointer; opacity:0.6; font-weight:bold; font-size:16px; transition: opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" onclick="this.parentElement.parentElement.remove()">A-</span>
    </div>
  `;
  container.appendChild(toast);

  // Trigger reflow & slide-in
  setTimeout(() => {
    toast.style.transform = 'translateX(0)';
  }, 10);

  // Auto remove after 4.5 seconds
  setTimeout(() => {
    toast.style.transform = 'translateX(120%)';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  CORPORATE PORTAL DATA FETCHING & RENDERING
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
let corpUsers = [];
let corpRooms = [];
let corpTravels = [];

async function loadCorporatePortal() {
  await loadCorporateUsers();
  await loadCorporateRooms();
  await loadCorporateTasks();
  await loadCorporateBookings();
  await loadCorporateDocuments();
  await loadCorporateCommunications();
  await loadCorporateTravelAndExpenses();
  await loadPerformanceTelemetry();
}

async function loadCorporateUsers() {
  try {
    const data = await apiCall('corporate/users');
    corpUsers = data || [];

    // Populate user selectors
    ['taskCreator', 'bookingOrganizer', 'travelExec'].forEach(selId => {
      const select = document.getElementById(selId);
      if (!select) return;
      select.innerHTML = corpUsers.map(u =>
        `<option value="${u.id}">${u.role === 'Executive' ? 'Executive' : 'Secretary'} - ${u.full_name} (${u.role})</option>`
      ).join('');
    });
  } catch (e) {
    console.error('Error loading corporate users:', e);
  }
}

async function loadCorporateRooms() {
  try {
    const data = await apiCall('corporate/rooms');
    corpRooms = data || [];

    const select = document.getElementById('bookingRoomSelect');
    if (!select) return;
    select.innerHTML = corpRooms.map(r =>
      `<option value="${r.id}">Y ${r.name} (Cap: ${r.capacity})</option>`
    ).join('');
  } catch (e) {
    console.error('Error loading corporate rooms:', e);
  }
}

async function loadCorporateTasks() {
  try {
    const data = await apiCall('corporate/tasks');
    const container = document.getElementById('corpTaskList');
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = `<p style="opacity:0.6; font-style:italic; margin:0;">No active tasks.</p>`;
      return;
    }

    const secretaries = corpUsers.filter(u => u.role === 'Secretary');

    container.innerHTML = data.map(t => {
      const priorityColor = t.priority === 'Critical' ? '#f44336' : t.priority === 'High' ? '#ff9800' : '#00e0ff';
      const isAssigned = t.status === 'Assigned';

      let delegateHtml = '';
      if (secretaries.length > 0) {
        delegateHtml = `
          <select style="width:auto; font-size:10px; padding:2px; margin:0; display:inline-block;" onchange="delegateCorporateTask(${t.id}, this.value)">
            <option value="">-- Reassign --</option>
            ${secretaries.map(s => `<option value="${s.id}">${s.full_name}</option>`).join('')}
          </select>
        `;
      }

      return `
        <div style="background:rgba(255,255,255,0.03); border-left:3px solid ${priorityColor}; padding:8px; border-radius:4px; margin-bottom:6px; position:relative;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>${t.title}</strong>
            <span style="font-size:9px; background:${priorityColor}; color:#000; padding:2px 4px; border-radius:3px; font-weight:bold;">${t.priority}</span>
          </div>
          <div style="opacity:0.8; margin-top:2px;">${t.description}</div>
          <div style="margin-top:6px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:5px; font-size:10px;">
            <div>
              <span>Assigned: <strong style="color:#81c784;">${t.assignee_name || 'Unassigned'}</strong></span>
              <span style="margin-left:8px; opacity:0.6;">SLA: ${new Date(t.sla_deadline).toLocaleString()}</span>
            </div>
            <div>${delegateHtml}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading corporate tasks:', e);
  }
}

async function loadCorporateBookings() {
  try {
    const data = await apiCall('corporate/bookings');
    const container = document.getElementById('corpBookingList');
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = `<p style="opacity:0.6; font-style:italic; margin:0;">No upcoming meetings.</p>`;
      return;
    }

    container.innerHTML = data.map(b => {
      const start = new Date(b.start_time).toLocaleString([], {hour: '2-digit', minute:'2-digit', month:'short', day:'numeric'});
      const end = new Date(b.end_time).toLocaleString([], {hour: '2-digit', minute:'2-digit'});
      return `
        <div style="padding:6px; background:rgba(255,255,255,0.03); border-radius:4px; border-left:3px solid #4caf50; margin-bottom:6px;">
          <div style="font-weight:600;">${b.title}</div>
          <div style="opacity:0.8; font-size:10px; margin-top:2px;">
            <span>Y ${b.room_name}</span> | Y*' ${start} - ${end} (${b.timezone})
          </div>
          <div style="opacity:0.6; font-size:9px;">Host: ${b.organizer_name}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading corporate bookings:', e);
  }
}

async function loadCorporateDocuments() {
  try {
    const data = await apiCall('corporate/documents');
    const container = document.getElementById('corpDocList');
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = `<p style="opacity:0.6; font-style:italic; margin:0; font-size:11px;">No documents in S3 vault.</p>`;
      return;
    }

    container.innerHTML = data.map(d => {
      const isLocked = d.is_locked === 1 || d.is_locked === true;
      const lockBadge = isLocked
        ? `<span class="badge" style="background:#f44336; font-size:9px;">Locked by ${d.locked_by_name || 'Admin'}</span>`
        : `<span class="badge" style="background:#4caf50; font-size:9px;">Unlocked</span>`;

      const lockButtonText = isLocked ? 'Unlock' : 'Lock';

      return `
        <div class="hub-module-card" style="padding:10px; margin-bottom:0; background:rgba(255,255,255,0.03); display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:18px;">DOC</span>
              <div>
                <strong>${d.filename}</strong>
                <div style="font-size:9px; opacity:0.5;">s3://${d.s3_bucket}/${d.s3_key}</div>
              </div>
            </div>
            ${lockBadge}
          </div>
          <div style="display:flex; gap:6px; margin-top:4px;">
            <button class="action-btn" style="flex:1; font-size:10px; padding:4px 8px; background:rgba(255,255,255,0.1);" onclick="toggleCorpDocumentLock(${d.id}, ${isLocked ? 1 : 0})">${lockButtonText}</button>
            <button class="action-btn" style="flex:1; font-size:10px; padding:4px 8px; background:#9c27b0;" ${isLocked ? 'disabled style="opacity:0.5;"' : ''} onclick="signCorpDocument(${d.id})">Digital Sign</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading corporate documents:', e);
  }
}

async function loadCorporateCommunications() {
  try {
    const data = await apiCall('corporate/communications');
    const container = document.getElementById('corpCommList');
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = `<p style="opacity:0.6; font-style:italic; margin:0;">No communication entries logged.</p>`;
      return;
    }

    container.innerHTML = data.map(c => {
      let icon = 'Email';
      let color = '#00bcd4';
      if (c.source === 'Phone') { icon = 'Phone'; color = '#ff9800'; }
      if (c.source === 'Visitor') { icon = 'Visitor'; color = '#81c784'; }
      if (c.source === 'Chat') { icon = 'Chat'; color = '#e91e63'; }

      return `
        <div style="padding:6px; background:rgba(255,255,255,0.02); border-radius:4px; border-left:3px solid ${color}; display:flex; gap:8px; align-items:center;">
          <span style="font-size:16px;">${icon}</span>
          <div style="flex:1;">
            <div><strong>${c.sender}</strong> <span style="opacity:0.6; font-size:9px;">(${c.source})</span></div>
            ${c.subject ? `<div style="font-weight:500;">${c.subject}</div>` : ''}
            <div style="opacity:0.8; font-size:10px;">${c.content}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading corporate communications:', e);
  }
}

async function loadCorporateTravelAndExpenses() {
  try {
    // 1. Fetch Travel Bookings
    const travels = await apiCall('corporate/travel');
    corpTravels = travels || [];

    // Populate travel context dropdown in expense report
    const select = document.getElementById('expenseTravelId');
    if (select) {
      select.innerHTML = `<option value="">-- Link to Trip --</option>` + corpTravels.map(t =>
        `<option value="${t.id}">${t.executive_name} to ${t.destination}</option>`
      ).join('');
    }

    // 2. Fetch Expenses
    const expenses = await apiCall('corporate/expenses');
    const expenseContainer = document.getElementById('corpExpenseList');
    if (expenseContainer) {
      if (!expenses || expenses.length === 0) {
        expenseContainer.innerHTML = `<p style="opacity:0.6; font-style:italic; margin:0;">No expenses reported.</p>`;
        return;
      }

      expenseContainer.innerHTML = expenses.map(e => {
        const dest = e.destination ? `Trip to ${e.destination}` : 'General Expense';
        return `
          <div style="background:rgba(255,255,255,0.03); padding:6px; border-radius:4px; margin-bottom:4px; border-left:3px solid #e91e63;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>KES ${Number(e.amount).toLocaleString()}</strong>
              <span class="badge" style="background:#81c784; font-size:8px; color:#000;">${e.status}</span>
            </div>
            <div style="font-size:10px; opacity:0.8; margin-top:2px;">
              <span>${dest} | Exec: ${e.executive_name || 'Admin'}</span>
            </div>
            <div style="font-size:9px; opacity:0.5; margin-top:2px;">S3 Key: ${e.receipt_s3_key || 'No receipt'}</div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    console.error('Error loading travel and expenses:', e);
  }
}

async function loadPerformanceTelemetry() {
  try {
    const data = await apiCall('corporate/performance');
    if (!data) return;

    // Render Workload Bars
    const workloadContainer = document.getElementById('workloadBarsContainer');
    if (workloadContainer) {
      if (!data.workload || data.workload.length === 0) {
        workloadContainer.innerHTML = `<p style="opacity:0.6; font-style:italic; font-size:11px;">No secretaries registered.</p>`;
      } else {
        workloadContainer.innerHTML = data.workload.map(w => {
          // Cap workload visualization at 10 tasks for 100% capacity
          const percentage = Math.min(100, (w.current_workload / 10) * 100);
          const barColor = percentage > 80 ? '#f44336' : percentage > 50 ? '#ff9800' : '#4caf50';
          return `
            <div>
              <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                <span><strong>${w.full_name}</strong></span>
                <span>${w.current_workload} Active Tasks (Capacity: ${percentage}%)</span>
              </div>
              <div style="height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden;">
                <div style="width:${percentage}%; height:100%; background:${barColor}; border-radius:4px; transition:width 0.3s;"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Render Avg Response Time
    const performanceContainer = document.getElementById('performanceList');
    if (performanceContainer) {
      if (!data.avgResponse || data.avgResponse.length === 0) {
        performanceContainer.innerHTML = `<p style="opacity:0.6; font-style:italic; font-size:11px;">No completed tasks logged yet.</p>`;
      } else {
        performanceContainer.innerHTML = data.avgResponse.map(a => {
          const avgSec = Math.round(a.avg_response_time);
          const minutes = Math.floor(avgSec / 60);
          const seconds = avgSec % 60;
          const displayTime = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
          return `
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.05); padding:6px 0;">
              <span><strong>${a.secretary_name}</strong></span>
              <span>Avg SLA Response: <strong style="color:#81c784;">${displayTime}</strong> (${a.completed_count} tasks done)</span>
            </div>
          `;
        }).join('');
      }
    }
  } catch (e) {
    console.error('Error loading performance telemetry:', e);
  }
}

// ==========================================
// FORM SUBMISSION EVENT HANDLERS
// ==========================================

async function submitCorporateTask() {
  const title = (document.getElementById('taskTitle')?.value || '').trim();
  const description = (document.getElementById('taskDesc')?.value || '').trim();
  const priority = document.getElementById('taskPriority')?.value || 'Medium';
  const creator_id = document.getElementById('taskCreator')?.value;
  const deadline = document.getElementById('taskDeadline')?.value;

  if (!title) return alert('Please enter a task title.');
  if (!creator_id) return alert('Please choose a task creator.');

  const idempotency_key = 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  try {
    const result = await apiCall('corporate/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title, description, priority, creator_id: Number(creator_id),
        sla_deadline: deadline || null, idempotency_key
      })
    });

    // Clear input fields
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDesc').value = '';
    document.getElementById('taskDeadline').value = '';

    showToast(`Task successfully routed! Status: ${result.status}`, 'success');
    logNotification(`Corporate Portal: Submitted and routed administrative task a" "${title}"`);
    await loadCorporatePortal();
  } catch (e) {
    alert(e.message || 'Error routing task.');
  }
}

async function delegateCorporateTask(taskId, secretaryId) {
  if (!secretaryId) return;
  try {
    await apiCall('corporate/tasks/delegate', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId, secretary_id: Number(secretaryId) })
    });
    showToast('Task successfully delegated!', 'success');
    logNotification(`Corporate Portal: Delegated task ID [${taskId}] to secretary ID [${secretaryId}]`);
    await loadCorporatePortal();
  } catch (e) {
    alert(e.message || 'Error delegating task.');
  }
}

async function submitCorporateBooking() {
  const title = (document.getElementById('bookingTitle')?.value || '').trim();
  const room_id = document.getElementById('bookingRoomSelect')?.value;
  const organizer_id = document.getElementById('bookingOrganizer')?.value;
  const timezone = document.getElementById('bookingTimezone')?.value;
  const start = document.getElementById('bookingStart')?.value;
  const end = document.getElementById('bookingEnd')?.value;

  if (!title) return alert('Please enter a meeting title.');
  if (!room_id || !organizer_id) return alert('Please select a room and organizer.');
  if (!start || !end) return alert('Please enter start and end dates/times.');

  try {
    await apiCall('corporate/bookings', {
      method: 'POST',
      body: JSON.stringify({
        room_id: Number(room_id), title, organizer_id: Number(organizer_id),
        start_time: start, end_time: end, timezone
      })
    });

    document.getElementById('bookingTitle').value = '';
    document.getElementById('bookingStart').value = '';
    document.getElementById('bookingEnd').value = '';

    showToast('Boardroom reservation confirmed!', 'success');
    logNotification(`Corporate Portal: Confirmed boardroom booking a" "${title}"`);
    await loadCorporatePortal();
  } catch (e) {
    alert(e.message || 'Booking conflict encountered.');
  }
}

async function uploadCorporateDocument() {
  const filename = (document.getElementById('docUploadName')?.value || '').trim();
  if (!filename) return alert('Please enter a document filename.');

  try {
    const result = await apiCall('corporate/documents/upload', {
      method: 'POST',
      body: JSON.stringify({ filename })
    });

    document.getElementById('docUploadName').value = '';

    showToast('Document uploaded to AWS S3 bucket!', 'success');
    logNotification(`Corporate Portal: Uploaded document "${filename}" to S3 storage bucket "${result.s3_bucket}"`);
    await loadCorporatePortal();
  } catch (e) {
    alert(e.message || 'Error uploading document.');
  }
}

async function toggleCorpDocumentLock(docId, currentLockState) {
  const action = currentLockState === 1 ? 'unlock' : 'lock';
  // Simulate active user ID = 1 (Chairman Peter)
  const user_id = 1;

  try {
    await apiCall('corporate/documents/lock', {
      method: 'POST',
      body: JSON.stringify({ document_id: docId, user_id, action })
    });
    showToast(`Document successfully ${action}ed!`, 'success');
    logNotification(`Corporate Portal: Document ID [${docId}] was ${action}ed by user ID [${user_id}]`);
    await loadCorporateDocuments();
  } catch (e) {
    alert(e.message || 'Lock conflict occurred.');
  }
}

async function signCorpDocument(docId) {
  const signature_payload = prompt('Enter crypto signature password / pin code to confirm digital sign:');
  if (!signature_payload) return;

  const signer_id = 1; // Simulate Executive Chairman

  try {
    await apiCall('corporate/documents/sign', {
      method: 'POST',
      body: JSON.stringify({ document_id: docId, signer_id, signature_payload })
    });
    showToast('Cryptographic signature applied!', 'success');
    logNotification(`Corporate Portal: Applied digital signature to document ID [${docId}]`);
    await loadCorporatePortal();
  } catch (e) {
    alert(e.message || 'Error signing document.');
  }
}

async function submitCorporateComm() {
  const source = document.getElementById('commSource')?.value;
  const sender = (document.getElementById('commSender')?.value || '').trim();
  const subject = (document.getElementById('commSubject')?.value || '').trim();
  const content = (document.getElementById('commContent')?.value || '').trim();

  if (!sender) return alert('Please enter a sender/guest name.');

  try {
    await apiCall('corporate/communications', {
      method: 'POST',
      body: JSON.stringify({ source, sender, subject, content })
    });

    document.getElementById('commSender').value = '';
    document.getElementById('commSubject').value = '';
    document.getElementById('commContent').value = '';

    showToast('Communication notification logged!', 'success');
    logNotification(`Corporate Portal: Logged incoming ${source} from "${sender}"`);
    await loadCorporatePortal();
  } catch (e) {
    alert(e.message || 'Error logging communication.');
  }
}

async function submitCorporateTravel() {
  const executive_id = document.getElementById('travelExec')?.value;
  const destination = (document.getElementById('travelDest')?.value || '').trim();
  const notes = (document.getElementById('travelNotes')?.value || '').trim();

  if (!destination) return alert('Please enter a travel destination.');

  try {
    await apiCall('corporate/travel', {
      method: 'POST',
      body: JSON.stringify({
        executive_id: Number(executive_id), destination,
        itinerary_details: { notes }
      })
    });

    document.getElementById('travelDest').value = '';
    document.getElementById('travelNotes').value = '';

    showToast('Travel itinerary registered successfully!', 'success');
    logNotification(`Corporate Portal: Logged travel plan to ${destination} for executive ID [${executive_id}]`);
    await loadCorporatePortal();
  } catch (e) {
    alert(e.message || 'Error saving travel plan.');
  }
}

async function submitCorporateExpense() {
  const travel_id = document.getElementById('expenseTravelId')?.value;
  const amount = document.getElementById('expenseAmount')?.value;
  const receipt_s3_key = document.getElementById('expenseReceiptKey')?.value;

  if (!amount) return alert('Please enter an expense amount.');

  try {
    await apiCall('corporate/expenses', {
      method: 'POST',
      body: JSON.stringify({
        travel_id: travel_id ? Number(travel_id) : null,
        amount: Number(amount),
        currency: 'KES',
        receipt_s3_key
      })
    });

    document.getElementById('expenseAmount').value = '';

    showToast('Expense claim submitted for review!', 'success');
    logNotification(`Corporate Portal: Submitted reimbursement claim of KES ${Number(amount).toLocaleString()} with S3 attachment`);
    await loadCorporatePortal();
  } catch (e) {
    alert(e.message || 'Error submitting expense.');
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  MAIN SAFEGUARD a" TREASURER FINANCIAL OVERSIGHT ENGINE
//  All 6 modules + charts + gauges + AGM mode + audit trail
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*

// a"a" In-memory Safeguard state a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"
const SG = {
  budgets:    [],
  compliance: [],
  funding:    [],
  forecasts:  [],
  ledgers:    [],
  assets:     [],
  activeTab:  'oversight',
  agmMode:    false,
  chartInstances: {},
};

// a"a" Panel Toggle a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"
function toggleSafeguardPanel() {
  const panel = document.getElementById('safeguardPanel');
  const btn   = document.getElementById('safeguardTriggerBtn');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  btn.textContent = isOpen
    ? 'Yi  Main Safeguard a" Financial Oversight System'
    : 'a* Close Main Safeguard Panel';
  btn.style.background = isOpen
    ? 'linear-gradient(135deg, #e91e63, #ff5722, #ff9800)'
    : 'linear-gradient(135deg, #333, #555)';
  if (!isOpen) {
    loadSafeguardStats();
    loadSafeguardBudgets();
    loadComplianceLogs();
    loadFundingSources();
    loadRevisedForecasts();
    loadBankLedgers();
    loadFlaggedRecords();
    loadFixedAssets();
    loadInsuranceAlerts();
    runWhatIfSimulation();
    logNotification('Safeguard: Main Safeguard Panel opened.');
  }
}

// a"a" Tab Switching a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"
function switchSafeguardTab(tabName) {
  SG.activeTab = tabName;
  document.querySelectorAll('.safeguard-tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.safeguard-tab-btn').forEach(el => el.classList.remove('active'));
  const content = document.getElementById(`sgTab_${tabName}`);
  const btn     = document.getElementById(`sgTabBtn_${tabName}`);
  if (content) content.classList.add('active');
  if (btn)     btn.classList.add('active');

  // Lazy-load charts when switching to their tabs
  if (tabName === 'funding')   { loadFundingSources(); }
  if (tabName === 'planning')  { loadRevisedForecasts(); }
  if (tabName === 'reporting') { renderReservesGauge(); }
  if (tabName === 'banking')   { loadBankLedgers(); loadFlaggedRecords(); }
  if (tabName === 'assets')    { loadFixedAssets(); loadInsuranceAlerts(); }
}

// a"a" Stats Tiles a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"
async function loadSafeguardStats() {
  try {
    const data = await apiCall('safeguard/stats', { method: 'GET' });
    const s = data;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? 'a"'; };
    set('sgStatBudgets', s.budgets?.total_budgets   ?? 0);
    set('sgStatFunding', s.funding?.total_sources   ?? 0);
    set('sgStatTxns',    s.ledgers?.total_transactions ?? 0);
    set('sgStatFlags',   s.ledgers?.flagged_count   ?? 0);
    set('sgStatAssets',  s.assets?.total_assets     ?? 0);
    set('sgStatExpIns',  s.assets?.expired_insurance_count ?? 0);
  } catch (e) {
    console.warn('[loadSafeguardStats]', e.message);
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
// TAB 1: FINANCIAL OVERSIGHT
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*

// Live budget variance preview
function sgUpdateBudgetVariance() {
  const allocated = parseFloat(document.getElementById('sgBudgetAllocated')?.value) || 0;
  const spend     = parseFloat(document.getElementById('sgBudgetSpend')?.value)     || 0;
  const variance  = allocated - spend;
  const pct       = allocated > 0 ? ((variance / allocated) * 100).toFixed(1) : 0;
  const el        = document.getElementById('sgBudgetVarianceDisplay');
  if (!el) return;
  el.textContent  = `KES ${variance.toLocaleString('en-KE', {minimumFractionDigits:2})} (${pct}%)`;
  el.style.color  = variance >= 0 ? '#81c784' : '#f44336';
}

async function loadSafeguardBudgets() {
  const container = document.getElementById('sgBudgetsTable');
  if (!container) return;
  try {
    const data = await apiCall('safeguard/budgets', { method: 'GET' });
    SG.budgets = data;
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="opacity:0.5;font-style:italic;font-size:12px;padding:8px;">No budget entries yet. Add one above.</p>';
      return;
    }
    container.innerHTML = `
      <table class="sg-table">
        <thead><tr>
          <th>Budget Name</th><th>Category</th><th>FY</th>
          <th>Allocated (KES)</th><th>Spent (KES)</th><th>Variance</th><th>Approval</th>
        </tr></thead>
        <tbody>
          ${data.map(b => {
            const v = parseFloat(b.allocated_budget) - parseFloat(b.actual_spend);
            const pct = b.allocated_budget > 0 ? ((v / b.allocated_budget) * 100).toFixed(1) : 0;
            const statusClass = {
              Approved:'compliant', Rejected:'non-compliant', Draft:'pending', Pending_Review:'review'
            }[b.committee_approval] || 'pending';
            return `<tr>
              <td><strong>${b.budget_name}</strong></td>
              <td>${b.category}</td>
              <td>${b.fiscal_year}</td>
              <td>KES ${Number(b.allocated_budget).toLocaleString()}</td>
              <td>KES ${Number(b.actual_spend).toLocaleString()}</td>
              <td style="color:${v>=0?'#81c784':'#f44336'}"><strong>KES ${v.toLocaleString()} (${pct}%)</strong></td>
              <td><span class="sg-badge ${statusClass}">${b.committee_approval.replace('_',' ')}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<div class="sg-alert danger"><span>as i </span><span>Failed to load budgets: ${e.message}</span></div>`;
  }
}

async function saveSafeguardBudget() {
  const name      = document.getElementById('sgBudgetName')?.value.trim();
  const category  = document.getElementById('sgBudgetCategory')?.value;
  const year      = document.getElementById('sgBudgetYear')?.value;
  const allocated = document.getElementById('sgBudgetAllocated')?.value;
  const spend     = document.getElementById('sgBudgetSpend')?.value;
  const income    = document.getElementById('sgBudgetIncome')?.value;
  if (!name) return alert('Please enter a budget name.');
  try {
    await apiCall('safeguard/budgets', {
      method: 'POST',
      body: JSON.stringify({ budget_name: name, category, fiscal_year: year,
        allocated_budget: allocated || 0, actual_spend: spend || 0, projected_income: income || 0 })
    });
    ['sgBudgetName','sgBudgetAllocated','sgBudgetSpend','sgBudgetIncome'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('sgBudgetVarianceDisplay').textContent = 'KES 0.00 (0.00%)';
    showToast('Budget entry saved successfully!', 'success');
    logNotification(`Safeguard: New budget entry a" "${name}" (${category}, FY${year})`);
    await loadSafeguardBudgets();
    await loadSafeguardStats();
  } catch (e) { alert(e.message || 'Failed to save budget.'); }
}

async function loadComplianceLogs() {
  try {
    const data = await apiCall('safeguard/compliance', { method: 'GET' });
    SG.compliance = data;
    renderStaffLogs(data.filter(d => d.log_type === 'Staff_Note'));
    renderAuditorLogs(data.filter(d => d.log_type === 'Audit_Check'));
  } catch (e) { console.warn('[loadComplianceLogs]', e.message); }
}

function renderStaffLogs(logs) {
  const el = document.getElementById('sgStaffLogs');
  if (!el) return;
  if (!logs || logs.length === 0) { el.innerHTML = '<p style="opacity:0.5;font-style:italic;font-size:12px;padding:8px;">No staff notes yet.</p>'; return; }
  el.innerHTML = logs.map(l => {
    const sClass = { Low:'compliant', Medium:'pending', High:'review', Critical:'critical' }[l.severity] || 'pending';
    return `<div style="padding:10px;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <strong style="font-size:13px;">${l.subject}</strong>
        <span class="sg-badge ${sClass}">${l.severity}</span>
      </div>
      <div style="font-size:11px;opacity:0.7;">${l.staff_member_name || 'Staff'} A ${l.staff_email || ''} A ${new Date(l.created_at).toLocaleDateString()}</div>
      ${l.details ? `<div style="font-size:12px;margin-top:4px;opacity:0.85;">${l.details}</div>` : ''}
    </div>`;
  }).join('');
}

function renderAuditorLogs(logs) {
  const el = document.getElementById('sgAuditorLogs');
  if (!el) return;
  if (!logs || logs.length === 0) { el.innerHTML = '<p style="opacity:0.5;font-style:italic;font-size:12px;padding:8px;">No audit correspondence yet.</p>'; return; }
  el.innerHTML = logs.map(l => `
    <div style="padding:10px;border-bottom:1px solid rgba(255,255,255,0.05);">
      <strong style="font-size:13px;">${l.subject}</strong>
      <div style="font-size:11px;opacity:0.7;margin-top:2px;">Auditor: ${l.funder_name || l.staff_member_name || 'N/A'} A ${new Date(l.created_at).toLocaleDateString()}</div>
      ${l.details ? `<div style="font-size:12px;margin-top:4px;">${l.details}</div>` : ''}
    </div>`).join('');
}

async function sgLogStaffNote() {
  const name    = document.getElementById('sgStaffName')?.value.trim();
  const email   = document.getElementById('sgStaffEmail')?.value.trim();
  const subject = document.getElementById('sgStaffSubject')?.value.trim();
  const details = document.getElementById('sgStaffDetails')?.value.trim();
  const severity= document.getElementById('sgStaffSeverity')?.value;
  if (!subject) return alert('Please enter a subject for the staff communication.');
  try {
    await apiCall('safeguard/compliance', {
      method: 'POST',
      body: JSON.stringify({ log_type: 'Staff_Note', staff_member_name: name, staff_email: email,
        subject, details, severity, compliance_status: 'Pending' })
    });
    ['sgStaffName','sgStaffEmail','sgStaffSubject','sgStaffDetails'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    showToast(`Staff note logged: "${subject}"`, 'success');
    logNotification(`Safeguard: Staff liaison note logged a" "${subject}" (${severity})`);
    await loadComplianceLogs();
  } catch (e) { alert(e.message || 'Failed to log staff note.'); }
}

async function sgLogAuditQuery() {
  const auditor = document.getElementById('sgAuditorName')?.value.trim();
  const subject = document.getElementById('sgAuditorSubject')?.value.trim();
  const msg     = document.getElementById('sgAuditorMessage')?.value.trim();
  if (!subject) return alert('Please enter a subject for the auditor query.');
  try {
    await apiCall('safeguard/compliance', {
      method: 'POST',
      body: JSON.stringify({ log_type: 'Audit_Check', staff_member_name: auditor, funder_name: auditor,
        subject, details: msg, severity: 'Medium', compliance_status: 'Under_Review' })
    });
    ['sgAuditorName','sgAuditorSubject','sgAuditorMessage'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    showToast('Auditor query submitted!', 'success');
    logNotification(`Safeguard: Auditor query logged a" "${subject}"`);
    await loadComplianceLogs();
  } catch (e) { alert(e.message || 'Failed to log auditor query.'); }
}

function updateAuditScore() {
  const checkboxes = document.querySelectorAll('#sgAuditChecklist input[type="checkbox"]');
  const total   = checkboxes.length;
  const checked = [...checkboxes].filter(c => c.checked).length;
  const pct     = total > 0 ? Math.round((checked / total) * 100) : 0;
  const bar  = document.getElementById('sgAuditScoreBar');
  const text = document.getElementById('sgAuditScoreText');
  if (bar)  bar.style.width = `${pct}%`;
  if (text) { text.textContent = `${pct}%`; text.style.color = pct >= 80 ? '#81c784' : pct >= 50 ? '#ff9800' : '#f44336'; }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
// TAB 2: FUNDING & FUNDRAISING
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
function sgUpdateFundProgress() {
  const target   = parseFloat(document.getElementById('sgFundTarget')?.value)   || 0;
  const received = parseFloat(document.getElementById('sgFundReceived')?.value) || 0;
  const pct      = target > 0 ? Math.min(100, Math.round((received / target) * 100)) : 0;
  const bar = document.getElementById('sgFundProgressBar');
  const pEl = document.getElementById('sgFundProgressPct');
  if (bar) bar.style.width = `${pct}%`;
  if (pEl) { pEl.textContent = `${pct}%`; pEl.style.color = pct >= 80 ? '#81c784' : pct >= 50 ? '#ff9800' : '#e91e63'; }
}

async function loadFundingSources() {
  const tableEl = document.getElementById('sgFundingTable');
  const alertEl = document.getElementById('sgFunderAlerts');
  try {
    const data = await apiCall('safeguard/funding', { method: 'GET' });
    SG.funding = data;

    if (!data || data.length === 0) {
      if (tableEl) tableEl.innerHTML = '<p style="opacity:0.5;font-style:italic;font-size:12px;padding:8px;">No funding sources registered yet.</p>';
      if (alertEl) alertEl.innerHTML = '<p style="opacity:0.5;font-style:italic;font-size:12px;padding:8px;">No conditions to check yet.</p>';
      renderFundingChart([]);
      return;
    }

    // Render table
    if (tableEl) {
      tableEl.innerHTML = `
        <table class="sg-table">
          <thead><tr>
            <th>Source Name</th><th>Type</th><th>Funder</th>
            <th>Awarded</th><th>Received</th><th>Spent</th><th>Progress</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${data.map(f => {
              const raised = parseFloat(f.campaign_raised) || parseFloat(f.amount_received) || 0;
              const target = parseFloat(f.campaign_target) || parseFloat(f.amount_awarded) || 0;
              const pct    = target > 0 ? Math.round((raised / target) * 100) : 0;
              const sClass = { Active:'compliant', Completed:'compliant', Suspended:'non-compliant', Pending_Approval:'pending' }[f.status] || 'pending';
              return `<tr>
                <td><strong>${f.source_name}</strong></td>
                <td>${f.source_type.replace('_',' ')}</td>
                <td>${f.funder_body || 'a"'}</td>
                <td>KES ${Number(f.amount_awarded).toLocaleString()}</td>
                <td>KES ${Number(f.amount_received).toLocaleString()}</td>
                <td>KES ${Number(f.amount_spent).toLocaleString()}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px;">
                    <div style="width:60px;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
                      <div style="width:${pct}%;height:100%;background:#81c784;border-radius:3px;"></div>
                    </div>
                    <span style="font-size:10px;">${pct}%</span>
                  </div>
                </td>
                <td><span class="sg-badge ${sClass}">${f.status.replace('_',' ')}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    }

    // Funder conditions alerts
    if (alertEl) {
      const alerts = data.filter(f => !f.restriction_compliant || !f.legislative_check);
      if (alerts.length === 0) {
        alertEl.innerHTML = '<div class="sg-alert success"><span>a...</span><span>All funding sources are compliant with their conditions and legislative requirements.</span></div>';
      } else {
        alertEl.innerHTML = alerts.map(f => `
          <div class="sg-alert danger">
            <span>Ys </span>
            <div><strong>${f.source_name}</strong> (${f.funder_body || f.source_type})<br>
            <span style="font-size:11px;">${!f.restriction_compliant ? 'Usage restriction violated. ' : ''}${!f.legislative_check ? 'Legislative compliance check failed.' : ''}</span>
            </div>
          </div>`).join('');
      }
    }

    renderFundingChart(data);
  } catch (e) {
    if (tableEl) tableEl.innerHTML = `<div class="sg-alert danger"><span>as i </span><span>Failed to load funding: ${e.message}</span></div>`;
  }
}

async function addFundingSource() {
  const name     = document.getElementById('sgFundName')?.value.trim();
  const type     = document.getElementById('sgFundType')?.value;
  const body     = document.getElementById('sgFundBody')?.value.trim();
  const awarded  = document.getElementById('sgFundAwarded')?.value;
  const target   = document.getElementById('sgFundTarget')?.value;
  const received = document.getElementById('sgFundReceived')?.value;
  if (!name) return alert('Please enter a funding source name.');
  try {
    await apiCall('safeguard/funding', {
      method: 'POST',
      body: JSON.stringify({ source_name: name, source_type: type, funder_body: body,
        amount_awarded: awarded || 0, campaign_target: target || 0, amount_received: received || 0 })
    });
    ['sgFundName','sgFundBody','sgFundAwarded','sgFundTarget','sgFundReceived'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('sgFundProgressBar').style.width = '0%';
    document.getElementById('sgFundProgressPct').textContent = '0%';
    showToast(`Funding source registered: "${name}"`, 'success');
    logNotification(`Safeguard: Funding source registered a" "${name}" (${type})`);
    await loadFundingSources();
    await loadSafeguardStats();
  } catch (e) { alert(e.message || 'Failed to add funding source.'); }
}

function renderFundingChart(data) {
  const canvas = document.getElementById('sgFundingChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (SG.chartInstances.funding) { SG.chartInstances.funding = null; }

  // Group by source type
  const groups = {};
  (data || []).forEach(f => {
    const t = f.source_type || 'Other';
    groups[t] = (groups[t] || 0) + parseFloat(f.amount_received || 0);
  });
  const labels  = Object.keys(groups);
  const values  = Object.values(groups);
  const colors  = ['#e91e63','#ff5722','#ff9800','#4caf50','#00e0ff','#9c27b0','#ffc107','#00bcd4'];

  if (labels.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px Poppins, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No funding data to display', canvas.width / 2, 80);
    return;
  }

  // Simple bar chart (no external library)
  const w = canvas.offsetWidth || 400;
  const h = 180;
  canvas.width  = w;
  canvas.height = h;
  const maxVal   = Math.max(...values, 1);
  const barW     = Math.floor((w - 40) / labels.length) - 6;
  const baseline = h - 30;
  ctx.clearRect(0, 0, w, h);

  labels.forEach((label, i) => {
    const barH = Math.round(((values[i] / maxVal)) * (h - 50));
    const x    = 20 + i * (barW + 6);
    const y    = baseline - barH;

    // Bar gradient
    const grad = ctx.createLinearGradient(x, y, x, baseline);
    grad.addColorStop(0, colors[i % colors.length]);
    grad.addColorStop(1, colors[i % colors.length] + '55');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]) : ctx.rect(x, y, barW, barH);
    ctx.fill();

    // Value label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px Poppins, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`KES ${Math.round(values[i]/1000)}K`, x + barW/2, y - 4);

    // Category label
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '9px Poppins, sans-serif';
    const short = label.replace('_',' ').substring(0, 8);
    ctx.fillText(short, x + barW/2, baseline + 14);
  });

  // Baseline
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(15, baseline); ctx.lineTo(w - 10, baseline);
  ctx.stroke();
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
// TAB 3: FINANCIAL PLANNING & BUDGETING
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
async function addForecast() {
  const name     = document.getElementById('sgForecastName')?.value.trim();
  const type     = document.getElementById('sgForecastType')?.value;
  const year     = document.getElementById('sgForecastYear')?.value;
  const quarter  = document.getElementById('sgForecastQuarter')?.value;
  const budget   = document.getElementById('sgForecastBudget')?.value;
  const spend    = document.getElementById('sgForecastSpend')?.value;
  const income   = document.getElementById('sgForecastIncome')?.value;
  const reserves = document.getElementById('sgForecastReserves')?.value;
  const resTarget= document.getElementById('sgForecastResTarget')?.value;
  if (!name) return alert('Please enter a forecast name.');
  try {
    await apiCall('safeguard/forecasts', {
      method: 'POST',
      body: JSON.stringify({ forecast_name: name, forecast_type: type, fiscal_year: year,
        quarter, allocated_budget: budget || 0, actual_spend: spend || 0,
        projected_income: income || 0, current_reserves: reserves || 0,
        reserves_target: resTarget || 0 })
    });
    ['sgForecastName','sgForecastBudget','sgForecastSpend','sgForecastIncome','sgForecastReserves','sgForecastResTarget'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    showToast('Forecast entry created!', 'success');
    logNotification(`Safeguard: Forecast created a" "${name}" (${type}, FY${year} ${quarter})`);
    await loadRevisedForecasts();
    renderReservesGauge();
  } catch (e) { alert(e.message || 'Failed to create forecast.'); }
}

async function loadRevisedForecasts() {
  const el = document.getElementById('sgForecastsTable');
  if (!el) return;
  try {
    const data = await apiCall('safeguard/forecasts/revised', { method: 'GET' });
    SG.forecasts = data;
    if (!data || data.length === 0) {
      el.innerHTML = '<p style="opacity:0.5;font-style:italic;font-size:12px;padding:8px;">No forecast entries yet. Create one using the Budget Preparer grid above.</p>';
      return;
    }
    el.innerHTML = `
      <table class="sg-table">
        <thead><tr>
          <th>Forecast Name</th><th>Type</th><th>Period</th>
          <th>Initial Budget</th><th>Actual Spend</th>
          <th>Revised Forecast</th><th>Variance</th><th>Var %</th><th>Risk</th>
        </tr></thead>
        <tbody>
          ${data.map(f => {
            const v = parseFloat(f.variance_amount);
            const riskClass = { Low:'compliant', Medium:'pending', High:'review', Critical:'critical' }[f.risk_factor] || 'pending';
            return `<tr>
              <td><strong>${f.forecast_name}</strong></td>
              <td>${f.forecast_type}</td>
              <td>${f.fiscal_year} ${f.quarter.replace('_',' ')}</td>
              <td>KES ${Number(f.allocated_budget).toLocaleString()}</td>
              <td>KES ${Number(f.actual_spend).toLocaleString()}</td>
              <td style="color:#00e0ff;font-weight:700;">KES ${Number(f.revised_forecast).toLocaleString()}</td>
              <td style="color:${v>=0?'#81c784':'#f44336'};font-weight:600;">KES ${v.toLocaleString()}</td>
              <td style="color:${parseFloat(f.variance_pct)>=0?'#81c784':'#f44336'};">${f.variance_pct}%</td>
              <td><span class="sg-badge ${riskClass}">${f.risk_factor}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    // Update gauge with first forecast's reserve data
    if (data[0]) renderReservesGaugeFromData(data[0]);
  } catch (e) {
    el.innerHTML = `<div class="sg-alert danger"><span>as i </span><span>Failed to load forecasts: ${e.message}</span></div>`;
  }
}

// What-If Simulation
function runWhatIfSimulation() {
  const revSlider  = document.getElementById('sgWhatIfRevenue');
  const costSlider = document.getElementById('sgWhatIfCost');
  const resSlider  = document.getElementById('sgWhatIfReserve');
  const baseInput  = document.getElementById('sgWhatIfBase');
  if (!revSlider) return;

  const revRate  = parseInt(revSlider.value);
  const costRate = parseInt(costSlider.value);
  const resRate  = parseInt(resSlider.value);
  const base     = parseFloat(baseInput?.value) || 500000;

  document.getElementById('sgWhatIfRevenueVal').textContent  = `${revRate >= 0 ? '+' : ''}${revRate}%`;
  document.getElementById('sgWhatIfCostVal').textContent     = `${costRate >= 0 ? '+' : ''}${costRate}%`;
  document.getElementById('sgWhatIfReserveVal').textContent  = `${resRate}%`;

  const projRevenue  = base * (1 + revRate  / 100);
  const projCosts    = base * (1 + costRate / 100) * 0.8; // assume 80% cost base
  const net          = projRevenue - projCosts;
  const reserveContr = Math.max(0, net * (resRate / 100));

  const fmt = n => `KES ${Math.abs(n).toLocaleString('en-KE', {minimumFractionDigits:2})}`;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('sgWIFRevenue', fmt(projRevenue));
  set('sgWIFCosts',   fmt(projCosts));
  const netEl = document.getElementById('sgWIFNet');
  if (netEl) { netEl.textContent = (net < 0 ? '-' : '') + fmt(net); netEl.style.color = net >= 0 ? '#81c784' : '#f44336'; }
  set('sgWIFReserve', fmt(reserveContr));

  const riskEl = document.getElementById('sgWIFRisk');
  if (riskEl) {
    const ratio = net / projRevenue;
    if (ratio >= 0.2)       { riskEl.textContent = 'Low Risk';      riskEl.className = 'sg-badge compliant'; }
    else if (ratio >= 0.05) { riskEl.textContent = 'Moderate Risk'; riskEl.className = 'sg-badge pending'; }
    else if (ratio >= -0.1) { riskEl.textContent = 'High Risk';     riskEl.className = 'sg-badge review'; }
    else                    { riskEl.textContent = 'Critical Risk';  riskEl.className = 'sg-badge critical'; }
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
// TAB 4: FINANCIAL REPORTING TOOLKIT
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
async function generateFinancialPositionReport() {
  const btn = document.querySelector('[onclick="generateFinancialPositionReport()"]');
  if (btn) { btn.textContent = 'a3 Compiling Report...'; btn.disabled = true; }
  try {
    // Gather all safeguard data
    const [budgets, funding, forecasts, ledgers, assets, stats] = await Promise.all([
      apiCall('safeguard/budgets',          { method: 'GET' }),
      apiCall('safeguard/funding',          { method: 'GET' }),
      apiCall('safeguard/forecasts/revised',{ method: 'GET' }),
      apiCall('safeguard/bank-ledgers',     { method: 'GET' }),
      apiCall('safeguard/assets',           { method: 'GET' }),
      apiCall('safeguard/stats',            { method: 'GET' }),
    ]);

    const totalBudget   = (budgets  || []).reduce((s,b) => s + parseFloat(b.allocated_budget||0), 0);
    const totalSpent    = (budgets  || []).reduce((s,b) => s + parseFloat(b.actual_spend||0), 0);
    const totalFunding  = (funding  || []).reduce((s,f) => s + parseFloat(f.amount_received||0), 0);
    const totalAssets   = (assets   || []).reduce((s,a) => s + parseFloat(a.purchase_cost||0), 0);
    const totalPayments = (ledgers  || []).filter(l => l.transaction_type === 'Payment').reduce((s,l) => s + parseFloat(l.amount||0), 0);
    const totalLodge    = (ledgers  || []).filter(l => l.transaction_type === 'Lodgement').reduce((s,l) => s + parseFloat(l.amount||0), 0);
    const flagged       = stats?.ledgers?.flagged_count ?? 0;
    const now           = new Date().toLocaleDateString('en-KE', { day:'2-digit', month:'long', year:'numeric' });

    const report = `
MAIN SAFEGUARD a" FINANCIAL POSITION REPORT
a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"
Generated : ${now}
System    : Eldoret Chama Table-Banking Portal
a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"

I. BUDGET POSITION
   Total Allocated Budget  : KES ${totalBudget.toLocaleString()}
   Total Actual Spend      : KES ${totalSpent.toLocaleString()}
   Budget Variance         : KES ${(totalBudget - totalSpent).toLocaleString()}
   Budget Count            : ${(budgets||[]).length} entries

II. FUNDING & INCOME
   Total Funding Received  : KES ${totalFunding.toLocaleString()}
   Active Sources          : ${(funding||[]).filter(f=>f.status==='Active').length}
   Total Sources Logged    : ${(funding||[]).length}

III. BANKING & TRANSACTIONS
   Total Payments Out      : KES ${totalPayments.toLocaleString()}
   Total Lodgements In     : KES ${totalLodge.toLocaleString()}
   Net Cash Position       : KES ${(totalLodge - totalPayments).toLocaleString()}
   Transactions Logged     : ${stats?.ledgers?.total_transactions ?? 0}
   Audit-Flagged Records   : ${flagged} ${flagged > 0 ? 'as i  REQUIRES REVIEW' : 'a...'}

IV. ASSETS & INSURANCE
   Total Asset Book Value  : KES ${totalAssets.toLocaleString()}
   Total Assets Logged     : ${(assets||[]).length}
   Expired Insurance Count : ${stats?.assets?.expired_insurance_count ?? 0} ${(stats?.assets?.expired_insurance_count ?? 0) > 0 ? 'as i  IMMEDIATE ACTION REQUIRED' : 'a...'}

V. FORECASTS
   Forecast Entries        : ${(forecasts||[]).length}
   Latest Revised Forecast : ${forecasts?.[0] ? `KES ${Number(forecasts[0].revised_forecast).toLocaleString()} (${forecasts[0].forecast_name})` : 'N/A'}
   Variance Coverage       : ${forecasts?.[0] ? `${forecasts[0].variance_pct}%` : 'N/A'}
   Reserves Coverage       : ${forecasts?.[0] ? `${forecasts[0].reserves_coverage_pct}%` : 'N/A'}

a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"
END OF REPORT a" Generated by Main Safeguard System
a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"a"
    `.trim();

    const reportDiv = document.getElementById('sgFinancialReport');
    const reportPre = document.getElementById('sgFinancialReportContent');
    if (reportPre) reportPre.textContent = report;
    if (reportDiv) reportDiv.style.display = 'block';
    showToast('Financial Position Report compiled!', 'success');
    logNotification('Safeguard: Financial Position Report generated.');
  } catch (e) {
    alert('Report generation failed: ' + e.message);
  } finally {
    if (btn) { btn.textContent = 'Generate Position Report'; btn.disabled = false; }
  }
}

// AGM Presenter Mode
function toggleAGMPresenterMode() {
  const toggle = document.getElementById('sgAGMToggle');
  const label  = document.getElementById('sgAGMLabel');
  const hub    = document.getElementById('secretaryHub');
  SG.agmMode   = toggle?.checked ?? false;
  if (hub) { hub.classList.toggle('agm-presenter-mode', SG.agmMode); }
  if (label) label.textContent = SG.agmMode ? 'a... AGM Mode Active a" Disable' : 'Enable AGM Mode';
  showToast(SG.agmMode ? 'AGM Presenter Mode enabled. Clean view active.' : 'AGM Presenter Mode disabled.', 'success');
  logNotification(`Safeguard: AGM Presenter Mode ${SG.agmMode ? 'ENABLED' : 'DISABLED'}.`);
}

// Reserves Gauge
function renderReservesGauge() {
  if (SG.forecasts.length > 0) renderReservesGaugeFromData(SG.forecasts[0]);
}

function renderReservesGaugeFromData(f) {
  const currentReserves  = parseFloat(f.current_reserves  || 0);
  const reservesTarget   = parseFloat(f.reserves_target   || 0);
  const investTarget     = parseFloat(f.investment_policy_target || 0);
  const coveragePct      = parseFloat(f.reserves_coverage_pct    || 0);

  const fmt = n => `KES ${n.toLocaleString('en-KE', {minimumFractionDigits:2})}`;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('sgReservesCurrentVal', fmt(currentReserves));
  set('sgReservesTargetVal',  fmt(reservesTarget));
  set('sgInvestmentTargetVal',fmt(investTarget));
  set('sgReservesPct',        `${Math.round(coveragePct)}%`);

  // Update SVG gauge fill (circumference = 2Ir = 314 for r=50)
  const circumference = 314;
  const offset = circumference - (coveragePct / 100) * circumference;
  const fillEl = document.getElementById('sgReservesGaugeFill');
  if (fillEl) {
    fillEl.style.strokeDashoffset = Math.max(0, offset).toFixed(1);
    fillEl.style.stroke = coveragePct >= 100 ? '#4caf50' : coveragePct >= 75 ? '#ff9800' : '#f44336';
  }
  const pctEl = document.getElementById('sgReservesPct');
  if (pctEl) pctEl.style.color = coveragePct >= 100 ? '#81c784' : coveragePct >= 75 ? '#ff9800' : '#f44336';

  const badgeEl  = document.getElementById('sgReservesCoverage');
  const adviceEl = document.getElementById('sgReservesAdvice');
  if (badgeEl) {
    if      (coveragePct >= 100) { badgeEl.textContent = 'Target Met';       badgeEl.className = 'sg-badge compliant'; }
    else if (coveragePct >= 75)  { badgeEl.textContent = 'Near Target';      badgeEl.className = 'sg-badge pending'; }
    else if (coveragePct >= 50)  { badgeEl.textContent = 'Below Target';     badgeEl.className = 'sg-badge review'; }
    else                         { badgeEl.textContent = 'Critical Shortfall'; badgeEl.className = 'sg-badge critical'; }
  }
  if (adviceEl) {
    if (coveragePct >= 100) adviceEl.textContent = 'a... Reserves policy fully met. Consider reviewing investment allocation for surplus funds.';
    else if (coveragePct >= 75) adviceEl.textContent = `Y" Reserves ${Math.round(coveragePct)}% of target. KES ${(reservesTarget - currentReserves).toLocaleString()} needed to reach full policy.`;
    else adviceEl.textContent = `as i  Reserve shortfall: KES ${(reservesTarget - currentReserves).toLocaleString()} required. Recommend reducing discretionary spend and increasing contributions.`;
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
// TAB 5: BANKING & BOOK-KEEPING CONTROLS
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
async function loadBankLedgers() {
  const el = document.getElementById('sgBankLedgerTable');
  if (!el) return;
  try {
    const data = await apiCall('safeguard/bank-ledgers', { method: 'GET' });
    SG.ledgers = data;
    if (!data || data.length === 0) {
      el.innerHTML = '<p style="opacity:0.5;font-style:italic;font-size:12px;padding:8px;">No transactions recorded yet.</p>';
      return;
    }
    const txColors = { Payment:'#f44336', Lodgement:'#4caf50', Transfer:'#00e0ff',
      Petty_Cash_Out:'#ff5722', Petty_Cash_In:'#81c784', Bank_Charge:'#ff9800', Interest:'#9c27b0' };
    el.innerHTML = `
      <table class="sg-table">
        <thead><tr>
          <th>Date</th><th>Account</th><th>Type</th><th>Amount (KES)</th>
          <th>Payee/Payer</th><th>Handled By</th><th>Receipt Ref</th><th>Audit Status</th>
        </tr></thead>
        <tbody>
          ${data.map(t => {
            const flagged = t.requires_audit_review == 1 || t.requires_audit_review === true;
            return `<tr style="background:${flagged ? 'rgba(244,67,54,0.06)' : ''};">
              <td>${new Date(t.transaction_date).toLocaleDateString()}</td>
              <td>${t.account_name}</td>
              <td><span style="color:${txColors[t.transaction_type]||'#ccc'};font-weight:600;">${t.transaction_type.replace(/_/g,' ')}</span></td>
              <td><strong>KES ${Number(t.amount).toLocaleString()}</strong></td>
              <td>${t.payee_or_payer || 'a"'}</td>
              <td>${t.handled_by}</td>
              <td>${t.receipt_reference || '<span style="color:#ff9800;font-size:10px;">MISSING</span>'}</td>
              <td>${flagged ? '<span class="sg-badge critical">as i  Flagged</span>' : '<span class="sg-badge compliant">a... Clear</span>'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = `<div class="sg-alert danger"><span>as i </span><span>Failed to load ledger: ${e.message}</span></div>`;
  }
}

async function addBankLedgerEntry() {
  const accName   = document.getElementById('sgBankAccName')?.value.trim();
  const txType    = document.getElementById('sgBankTxType')?.value;
  const amount    = document.getElementById('sgBankAmount')?.value;
  const date      = document.getElementById('sgBankDate')?.value;
  const handler   = document.getElementById('sgBankHandler')?.value.trim();
  const receipt   = document.getElementById('sgBankReceipt')?.value.trim();
  const doc       = document.getElementById('sgBankDoc')?.value.trim();
  if (!accName)  return alert('Please enter an account name.');
  if (!amount)   return alert('Please enter a transaction amount.');
  if (!handler)  return alert('Please enter the name of the person handling this transaction.');
  try {
    await apiCall('safeguard/bank-ledgers', {
      method: 'POST',
      body: JSON.stringify({
        account_name:    accName,
        account_number:  document.getElementById('sgBankAccNo')?.value.trim()  || null,
        bank_name:       document.getElementById('sgBankName')?.value.trim()   || null,
        transaction_type: txType,
        transaction_date: date || new Date().toISOString().slice(0,10),
        amount, running_balance: 0,
        description:     document.getElementById('sgBankDesc')?.value.trim()  || null,
        payee_or_payer:  document.getElementById('sgBankPayee')?.value.trim() || null,
        handled_by:      handler,
        receipt_reference:   receipt  || null,
        supporting_doc_ref:  doc      || null,
      })
    });
    // Clear form
    ['sgBankAccName','sgBankAccNo','sgBankName','sgBankAmount','sgBankDate',
     'sgBankDesc','sgBankPayee','sgBankHandler','sgBankReceipt','sgBankDoc'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const noticedFlagged = !receipt || !doc;
    const notice = document.getElementById('sgBankTriggerNotice');
    if (notice) notice.style.display = 'none';
    showToast(
      noticedFlagged ? 'as i  Transaction recorded a" auto-flagged for audit review!' : 'a... Transaction recorded successfully.',
      noticedFlagged ? 'warning' : 'success'
    );
    logNotification(`Safeguard: Bank transaction recorded a" ${txType} of KES ${Number(amount).toLocaleString()} by ${handler}${noticedFlagged ? ' [AUTO-FLAGGED]' : ''}`);
    await loadBankLedgers();
    await loadFlaggedRecords();
    await loadSafeguardStats();
  } catch (e) { alert(e.message || 'Failed to record transaction.'); }
}

// Show/hide trigger notice when receipt fields change
['sgBankReceipt','sgBankDoc','sgBankTxType'].forEach(id => {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', sgPreviewTriggerFlag);
    el.addEventListener('change', sgPreviewTriggerFlag);
  });
});

function sgPreviewTriggerFlag() {
  const txType  = document.getElementById('sgBankTxType')?.value;
  const receipt = (document.getElementById('sgBankReceipt')?.value || '').trim();
  const doc     = (document.getElementById('sgBankDoc')?.value || '').trim();
  const flagTypes = ['Payment','Lodgement','Transfer','Petty_Cash_Out','Petty_Cash_In'];
  const notice = document.getElementById('sgBankTriggerNotice');
  if (!notice) return;
  notice.style.display = (flagTypes.includes(txType) && (!receipt || !doc)) ? 'flex' : 'none';
}

async function loadFlaggedRecords() {
  const el       = document.getElementById('sgFlaggedRecords');
  const alertEl  = document.getElementById('sgAuditTrailAlert');
  const emptyEl  = document.getElementById('sgAuditTrailEmpty');
  if (!el) return;
  try {
    const data = await apiCall('safeguard/bank-ledgers/flagged', { method: 'GET' });
    const hasFlagged = data && data.length > 0;
    if (alertEl) alertEl.style.display  = hasFlagged ? 'flex' : 'none';
    if (emptyEl) emptyEl.style.display  = hasFlagged ? 'none' : 'flex';
    if (!hasFlagged) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <table class="sg-table">
        <thead><tr>
          <th>Date</th><th>Account</th><th>Type</th><th>Amount</th>
          <th>Handled By</th><th>Audit Flag Reason</th>
        </tr></thead>
        <tbody>
          ${data.map(t => `
            <tr style="background:rgba(244,67,54,0.08);">
              <td>${new Date(t.transaction_date).toLocaleDateString()}</td>
              <td>${t.account_name}</td>
              <td style="color:#ff5722;font-weight:600;">${t.transaction_type.replace(/_/g,' ')}</td>
              <td><strong style="color:#f44336;">KES ${Number(t.amount).toLocaleString()}</strong></td>
              <td>${t.handled_by}</td>
              <td style="font-size:11px;color:#ffcc80;">${t.audit_flag_reason || 'Missing documentation'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = `<div class="sg-alert danger"><span>as i </span><span>Failed to load flagged records: ${e.message}</span></div>`;
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
// TAB 6: FIXED ASSETS & STOCK CONTROL
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
function sgCalcNetBookValue() {
  const cost   = parseFloat(document.getElementById('sgAssetCost')?.value)   || 0;
  const accDep = parseFloat(document.getElementById('sgAssetAccDep')?.value) || 0;
  const nbv    = Math.max(0, cost - accDep);
  const el     = document.getElementById('sgAssetNBV');
  if (el) { el.textContent = `KES ${nbv.toLocaleString('en-KE', {minimumFractionDigits:2})}`; el.style.color = nbv > 0 ? '#81c784' : '#ff9800'; }
}

function sgCheckInsuranceExpiry() {
  const expiryInput = document.getElementById('sgAssetInsExpiry');
  const warningEl   = document.getElementById('sgInsExpiryWarning');
  const msgEl       = document.getElementById('sgInsExpiryMsg');
  if (!expiryInput || !warningEl) return;
  const expiry = new Date(expiryInput.value);
  const today  = new Date();
  const days   = Math.ceil((expiry - today) / 86400000);
  if (!expiryInput.value) { warningEl.style.display = 'none'; return; }
  if (days <= 0)      { warningEl.style.display = 'flex'; warningEl.className = 'sg-alert danger';  if (msgEl) msgEl.textContent = `a" Insurance EXPIRED ${Math.abs(days)} day(s) ago! Immediate renewal required.`; }
  else if (days <= 30){ warningEl.style.display = 'flex'; warningEl.className = 'sg-alert warning'; if (msgEl) msgEl.textContent = `as i  Insurance expires in ${days} day(s). Schedule renewal now.`; }
  else                { warningEl.style.display = 'none'; }
}

async function loadFixedAssets() {
  const el = document.getElementById('sgAssetsTable');
  if (!el) return;
  try {
    const data = await apiCall('safeguard/assets', { method: 'GET' });
    SG.assets = data;
    if (!data || data.length === 0) {
      el.innerHTML = '<p style="opacity:0.5;font-style:italic;font-size:12px;padding:8px;">No assets registered yet.</p>';
      renderAssetChart([]);
      return;
    }
    const insColors = { Active:'compliant', Expired:'non-compliant', Pending_Renewal:'pending', Not_Insured:'review' };
    el.innerHTML = `
      <table class="sg-table">
        <thead><tr>
          <th>Asset Name</th><th>Category</th><th>Tag</th>
          <th>Cost (KES)</th><th>Net Book Value</th><th>Qty</th>
          <th>Condition</th><th>Insurance Expiry</th><th>Ins Status</th>
        </tr></thead>
        <tbody>
          ${data.map(a => {
            const nbv = parseFloat(a.net_book_value || a.purchase_cost || 0);
            const expiry = a.insurance_expiry_date ? new Date(a.insurance_expiry_date) : null;
            const daysLeft = expiry ? Math.ceil((expiry - new Date()) / 86400000) : null;
            const expiryDisplay = expiry
              ? `<span style="color:${daysLeft <= 0 ? '#f44336' : daysLeft <= 30 ? '#ff9800' : '#81c784'};">${expiry.toLocaleDateString()}${daysLeft <= 30 ? ` (${daysLeft}d)` : ''}</span>`
              : '<span style="opacity:0.5;">a"</span>';
            return `<tr>
              <td><strong>${a.asset_name}</strong></td>
              <td>${a.asset_category}</td>
              <td><code style="font-size:10px;">${a.asset_tag || 'a"'}</code></td>
              <td>KES ${Number(a.purchase_cost).toLocaleString()}</td>
              <td style="color:#81c784;font-weight:600;">KES ${nbv.toLocaleString()}</td>
              <td>${a.stock_quantity || 0}</td>
              <td>${a.condition_status}</td>
              <td>${expiryDisplay}</td>
              <td><span class="sg-badge ${insColors[a.insurance_status]||'pending'}">${a.insurance_status.replace('_',' ')}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    renderAssetChart(data);
  } catch (e) {
    el.innerHTML = `<div class="sg-alert danger"><span>as i </span><span>Failed to load assets: ${e.message}</span></div>`;
  }
}

async function addFixedAsset() {
  const name = document.getElementById('sgAssetName')?.value.trim();
  if (!name) return alert('Please enter an asset name.');
  try {
    const cost   = document.getElementById('sgAssetCost')?.value;
    const accDep = document.getElementById('sgAssetAccDep')?.value;
    await apiCall('safeguard/assets', {
      method: 'POST',
      body: JSON.stringify({
        asset_name:              name,
        asset_category:          document.getElementById('sgAssetCategory')?.value,
        asset_tag:               document.getElementById('sgAssetTag')?.value.trim()     || null,
        purchase_cost:           cost || 0,
        depreciation_rate:       document.getElementById('sgAssetDepRate')?.value        || 0,
        accumulated_depreciation: accDep || 0,
        stock_quantity:          document.getElementById('sgAssetQty')?.value            || 1,
        location:                document.getElementById('sgAssetLocation')?.value.trim()|| null,
        insurance_provider:      document.getElementById('sgAssetInsurer')?.value.trim() || null,
        insurance_policy_no:     document.getElementById('sgAssetPolicyNo')?.value.trim()|| null,
        insurance_start_date:    document.getElementById('sgAssetInsStart')?.value       || null,
        insurance_expiry_date:   document.getElementById('sgAssetInsExpiry')?.value      || null,
        insurance_premium:       document.getElementById('sgAssetPremium')?.value        || 0,
        insurance_status:        document.getElementById('sgAssetInsStatus')?.value,
      })
    });
    ['sgAssetName','sgAssetTag','sgAssetCost','sgAssetDepRate','sgAssetAccDep',
     'sgAssetQty','sgAssetLocation','sgAssetInsurer','sgAssetPolicyNo',
     'sgAssetInsStart','sgAssetInsExpiry','sgAssetPremium'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('sgAssetNBV').textContent = 'KES 0.00';
    document.getElementById('sgInsExpiryWarning').style.display = 'none';
    showToast(`Asset registered: "${name}"`, 'success');
    logNotification(`Safeguard: Asset registered a" "${name}" (${document.getElementById('sgAssetCategory')?.value})`);
    await loadFixedAssets();
    await loadInsuranceAlerts();
    await loadSafeguardStats();
  } catch (e) { alert(e.message || 'Failed to register asset.'); }
}

async function loadInsuranceAlerts() {
  const el = document.getElementById('sgInsuranceAlerts');
  if (!el) return;
  try {
    const data = await apiCall('safeguard/insurance-alerts', { method: 'GET' });
    if (!data || data.length === 0) {
      el.innerHTML = '<div class="sg-alert success"><span>a...</span><span>No insurance policies expiring soon. All active policies are current.</span></div>';
      return;
    }
    el.innerHTML = data.map(a => {
      const days = parseInt(a.days_until_expiry);
      const cls  = days <= 0 ? 'danger' : days <= 30 ? 'warning' : 'info';
      const icon = days <= 0 ? 'Ys ' : days <= 30 ? 'as i ' : 'a"1i ';
      const msg  = days <= 0
        ? `EXPIRED ${Math.abs(days)} day(s) ago! Policy: ${a.insurance_policy_no || 'N/A'} a" IMMEDIATE renewal required.`
        : `Expires in ${days} day(s) (${new Date(a.insurance_expiry_date).toLocaleDateString()}) a" Policy: ${a.insurance_policy_no || 'N/A'}. Provider: ${a.insurance_provider || 'N/A'}.`;
      return `<div class="sg-alert ${cls}"><span>${icon}</span><div><strong>${a.asset_name}</strong> (${a.asset_category})<br><span style="font-size:11px;">${msg}</span></div></div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = `<div class="sg-alert danger"><span>as i </span><span>Failed to load insurance alerts: ${e.message}</span></div>`;
  }
}

function renderAssetChart(data) {
  const canvas    = document.getElementById('sgAssetChart');
  const legendEl  = document.getElementById('sgAssetChartLegend');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Group by category
  const groups = {};
  (data || []).forEach(a => {
    const cat = a.asset_category || 'Other';
    groups[cat] = (groups[cat] || 0) + parseFloat(a.purchase_cost || 0);
  });
  const labels  = Object.keys(groups);
  const values  = Object.values(groups);
  const colors  = ['#e91e63','#ff5722','#ff9800','#4caf50','#00e0ff','#9c27b0','#ffc107','#00bcd4','#81c784'];
  const total   = values.reduce((s, v) => s + v, 0);

  const size = Math.min(canvas.offsetWidth || 300, 260);
  canvas.width  = size;
  canvas.height = size;
  ctx.clearRect(0, 0, size, size);

  if (labels.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font      = '12px Poppins,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No asset data', size / 2, size / 2);
    if (legendEl) legendEl.innerHTML = '';
    return;
  }

  // Draw donut chart
  const cx = size / 2, cy = size / 2, outerR = size * 0.42, innerR = size * 0.24;
  let startAngle = -Math.PI / 2;
  values.forEach((val, i) => {
    const slice = (val / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,14,26,0.6)';
    ctx.lineWidth   = 2;
    ctx.stroke();
    startAngle += slice;
  });

  // Inner hole
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,14,26,0.85)';
  ctx.fill();

  // Center label
  ctx.fillStyle = '#fff';
  ctx.font      = `bold ${Math.round(size*0.07)}px Poppins,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`KES`, cx, cy - 4);
  ctx.font      = `bold ${Math.round(size*0.06)}px Poppins,sans-serif`;
  ctx.fillStyle = '#81c784';
  ctx.fillText(`${(total/1000).toFixed(0)}K`, cx, cy + size*0.07);

  // Legend
  if (legendEl) {
    legendEl.innerHTML = labels.map((l, i) => {
      const pct = total > 0 ? ((values[i]/total)*100).toFixed(1) : 0;
      return `<div style="display:flex;align-items:center;gap:5px;padding:3px 6px;background:rgba(0,0,0,0.15);border-radius:4px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${colors[i%colors.length]};display:inline-block;flex-shrink:0;"></span>
        <span>${l}: ${pct}%</span>
      </div>`;
    }).join('');
  }
}


/* ==========================================
   DATA EXPORT MODULE
   ========================================== */
function exportTableToCSV(tableId, filename) {
    const table = document.getElementById(tableId);
    if (!table) return;
    let csv = [];
    const rows = table.querySelectorAll('tr');
    for (let i = 0; i < rows.length; i++) {
        const row = [], cols = rows[i].querySelectorAll('td, th');
        for (let j = 0; j < cols.length; j++) row.push('"' + cols[j].innerText.replace(/"/g, '""') + '"');
        csv.push(row.join(','));
    }
    const csvFile = new Blob([csv.join('\n')], {type: 'text/csv'});
    const downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

/* ==========================================
   ADMIN ANALYTICS CHART
   ========================================== */
let adminChartInstance = null;
function renderAnalyticsCharts() {
    const canvas = document.getElementById('adminAnalyticsChart');
    if (!canvas) return;
    const pending = Array.isArray(pendingMembers) ? pendingMembers.length : 0;
    const approved = Array.isArray(membersArray) ? membersArray.length : 0;
    const denied = Array.isArray(deniedMembers) ? deniedMembers.length : 0;

    const ctx = canvas.getContext('2d');
    if (adminChartInstance) adminChartInstance.destroy();

    adminChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Approved', 'Pending', 'Denied'],
            datasets: [{
                label: 'Member Status Distribution',
                data: [approved, pending, denied],
                backgroundColor: ['#4caf50', '#00e0ff', '#f44336'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { color: '#ccc' } }, x: { ticks: { color: '#ccc' } } },
            plugins: { legend: { labels: { color: '#fff' } } }
        }
    });
}



/* ==========================================
   BULK APPROVE MEMBERS
   ========================================== */
async function bulkApproveMembers() {
    if (selectedPendingMemberIds.length === 0) {
        alert('No pending members selected.');
        return;
    }
    if (!confirm('Approve ' + selectedPendingMemberIds.length + ' members?')) return;
    for (let id of selectedPendingMemberIds) {
        try {
            await apiCall('members/process-approval', {
                method: 'POST',
                body: JSON.stringify({ id: id, action: 'approve' })
            });
        } catch(e) { console.error('Failed to approve member', id, e); }
    }
    selectedPendingMemberIds = [];
    await loadVerificationDashboard();
}


/* ==========================================================================
 * AUTHORIZATION & RECONCILIATION QUEUE MODULE
 * ==========================================================================
 */

async function loadAuthorizationQueue() {
  // ------ CONTRIBUTIONS ------
  const contribLoading = document.getElementById('contributionsQueueLoading');
  const contribTable   = document.getElementById('contributionsQueueTable');
  const contribBody    = document.getElementById('contributionsQueueBody');
  const contribEmpty   = document.getElementById('contributionsQueueEmpty');

  if (contribLoading) contribLoading.style.display = 'block';
  if (contribTable)   contribTable.style.display   = 'none';
  if (contribEmpty)   contribEmpty.style.display   = 'none';

  try {
    const contributions = await apiCall('contributions/all', { method: 'GET' });
    if (contribLoading) contribLoading.style.display = 'none';

    if (!contributions || contributions.length === 0) {
      if (contribEmpty) contribEmpty.style.display = 'block';
    } else {
      if (contribTable) contribTable.style.display = 'table';
      if (contribBody) {
        contribBody.innerHTML = contributions.map(c => {
          const isPending = c.status === 'Pending Head Treasurer Reconciliation';
          const statusColor = c.status === 'Reconciled' ? '#4caf50' : c.status === 'Rejected' ? '#f44336' : '#fbbf24';
          const receiptLink = c.receipt_url
            ? `<a href="${c.receipt_url}" target="_blank" style="color:#00e0ff; font-size:12px;">View</a>`
            : '<span style="color:#555; font-size:12px;">None</span>';
          const actionBtns = isPending
            ? `<div style="display:flex; gap:5px;">
                 <button class="action-btn" style="padding:4px 8px; font-size:11px; background:#4caf50;" onclick="reconcileContribution(${c.id},'approve')">Approve</button>
                 <button class="btn-del"    style="padding:4px 8px; font-size:11px;" onclick="reconcileContribution(${c.id},'reject')">Reject</button>
               </div>`
            : `<span style="font-size:11px; color:${statusColor};">${c.status}</span>`;

          return `<tr style="border-bottom:1px solid #222; font-size:13px;">
            <td style="padding:8px 6px;"><code>#${c.id}</code></td>
            <td style="padding:8px 6px;">${c.member_name}</td>
            <td style="padding:8px 6px; font-weight:bold;">Ksh ${parseFloat(c.amount).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
            <td style="padding:8px 6px;">${c.payment_method}</td>
            <td style="padding:8px 6px;">${receiptLink}</td>
            <td style="padding:8px 6px;"><span style="color:${statusColor}; font-size:11px;">${c.status}</span></td>
            <td style="padding:8px 6px;">${actionBtns}</td>
          </tr>`;
        }).join('');
      }
    }
  } catch (e) {
    if (contribLoading) contribLoading.innerHTML = '<span style="color:#f44336;">Failed to load contributions.</span>';
    console.error('[loadAuthorizationQueue] contributions error:', e);
  }

  // ------ EXPENSE CLAIMS ------
  const expLoading = document.getElementById('expensesQueueLoading');
  const expTable   = document.getElementById('expensesQueueTable');
  const expBody    = document.getElementById('expensesQueueBody');
  const expEmpty   = document.getElementById('expensesQueueEmpty');

  if (expLoading) expLoading.style.display = 'block';
  if (expTable)   expTable.style.display   = 'none';
  if (expEmpty)   expEmpty.style.display   = 'none';

  try {
    const expenses = await apiCall('expenses/all', { method: 'GET' });
    if (expLoading) expLoading.style.display = 'none';

    if (!expenses || expenses.length === 0) {
      if (expEmpty) expEmpty.style.display = 'block';
    } else {
      if (expTable) expTable.style.display = 'table';
      if (expBody) {
        expBody.innerHTML = expenses.map(e => {
          const isPending = e.status === 'Pending Authorization';
          const statusColor = e.status === 'Authorized' ? '#4caf50' : e.status === 'Rejected' ? '#f44336' : '#fbbf24';
          const receiptLink = e.receipt_url
            ? `<a href="${e.receipt_url}" target="_blank" style="color:#00e0ff; font-size:12px;">View</a>`
            : '<span style="color:#555;">None</span>';
          const actionBtns = isPending
            ? `<div style="display:flex; gap:5px;">
                 <button class="action-btn" style="padding:4px 8px; font-size:11px; background:#4caf50;" onclick="authorizeExpense(${e.id},'approve')">Approve</button>
                 <button class="btn-del"    style="padding:4px 8px; font-size:11px;" onclick="authorizeExpense(${e.id},'reject')">Reject</button>
               </div>`
            : `<span style="font-size:11px; color:${statusColor};">${e.status}</span>`;

          return `<tr style="border-bottom:1px solid #222; font-size:13px;">
            <td style="padding:8px 6px;"><code>#${e.id}</code></td>
            <td style="padding:8px 6px;">${e.category}</td>
            <td style="padding:8px 6px; font-weight:bold;">Ksh ${parseFloat(e.amount).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
            <td style="padding:8px 6px;">${receiptLink}</td>
            <td style="padding:8px 6px;"><span style="color:${statusColor}; font-size:11px;">${e.status}</span></td>
            <td style="padding:8px 6px;">${actionBtns}</td>
          </tr>`;
        }).join('');
      }
    }
  } catch (e) {
    if (expLoading) expLoading.innerHTML = '<span style="color:#f44336;">Failed to load expense claims.</span>';
    console.error('[loadAuthorizationQueue] expenses error:', e);
  }
}

async function reconcileContribution(id, action) {
  const label = action === 'approve' ? 'Reconcile (Approve)' : 'Reject';
  if (!confirm(`${label} Contribution #${id}?`)) return;
  try {
    await apiCall('contributions/reconcile', {
      method: 'POST',
      body: JSON.stringify({ id, action })
    });
    await logNotification(`Contribution #${id} has been ${action === 'approve' ? 'Reconciled' : 'Rejected'} by Head Treasurer.`);
    loadAuthorizationQueue();
  } catch (e) {
    alert('Action failed: ' + e.message);
  }
}

async function authorizeExpense(id, action) {
  const label = action === 'approve' ? 'Authorize' : 'Reject';
  if (!confirm(`${label} Expense Claim #${id}?`)) return;
  try {
    await apiCall('expenses/authorize', {
      method: 'POST',
      body: JSON.stringify({ id, action })
    });
    await logNotification(`Expense Claim #${id} has been ${action === 'approve' ? 'Authorized' : 'Rejected'} by Head Treasurer.`);
    loadAuthorizationQueue();
  } catch (e) {
    alert('Action failed: ' + e.message);
  }
}

// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  SESSION TIMEOUT (10 MIN INACTIVITY / 30 MIN WITH BLUR LOCK)
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
(function() {
    let inactivityTimer;
    const TIMEOUT_BLUR_OFF = 10 * 60 * 1000; // 10 minutes when blur is off
    const TIMEOUT_BLUR_ON = 30 * 60 * 1000;  // 30 minutes when blur is on

    function getTimeout() {
        try {
            var blurOn = document.body.classList.contains('home-admin-locked') ||
                         sessionStorage.getItem('homeSessionTimedOut') === 'true';
            return blurOn ? TIMEOUT_BLUR_ON : TIMEOUT_BLUR_OFF;
        } catch (e) {
            return TIMEOUT_BLUR_OFF;
        }
    }

    function resetTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(logoutDueToInactivity, getTimeout());
    }

    function logoutDueToInactivity() {
        sessionStorage.removeItem('homeSessionTimedOut');
        localStorage.removeItem('disableBlurEffect');
        sessionStorage.removeItem('adminSession');
        window.location.href = 'login.html';
    }

    // Use addEventListener to avoid overwriting existing handlers
    window.addEventListener('load', resetTimer);
    document.addEventListener('mousemove', resetTimer);
    document.addEventListener('keypress', resetTimer);
    document.addEventListener('click', resetTimer);
    document.addEventListener('scroll', resetTimer);
})();


//
//  ADMIN ACCOUNT WIDGET
//

function toggleAdminDropdown() {
  const dd = document.getElementById('adminAccountDropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
}


// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*
//  MEETING MINUTES REGISTRY
// a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*

let allMinuteRecords = [];
let selectedMinuteIds = new Set();
let activeDetailMinuteId = null;

async function saveMinuteRecord() {
  const title     = (document.getElementById('minuteTitle')?.value || '').trim();
  const date      = (document.getElementById('minuteDate')?.value || '').trim();
  const venue     = (document.getElementById('minuteVenue')?.value || '').trim();
  const chair     = (document.getElementById('minuteChair')?.value || '').trim();
  const attendees = (document.getElementById('minuteAttendees')?.value || '').trim();
  const agenda    = (document.getElementById('minuteAgenda')?.value || '').trim();
  const body      = (document.getElementById('minuteBody')?.value || '').trim();
  const nextDate  = (document.getElementById('minuteNextDate')?.value || '').trim();
  const secretary = (document.getElementById('minuteSecretary')?.value || '').trim();

  if (!title || !date || !body) {
    alert('Please fill in at minimum: Meeting Title, Date, and Minutes/Notes.');
    return;
  }

  try {
    await apiCall('minutes/save', {
      method: 'POST',
      body: JSON.stringify({ title, date, venue, chair, attendees, agenda, body, next_meeting_date: nextDate, secretary })
    });

    ['minuteTitle','minuteDate','minuteVenue','minuteChair','minuteAttendees',
     'minuteAgenda','minuteBody','minuteNextDate','minuteSecretary'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    alert('Meeting minutes saved successfully!');
    loadMinuteRegistry();
  } catch (err) {
    console.error('[saveMinuteRecord]', err);
    alert('Failed to save minutes: ' + (err.message || 'Unknown error'));
  }
}

async function loadMinuteRegistry() {
  const tbody = document.getElementById('minutesTableBody');
  try {
    const data = await apiCall('minutes/list', { method: 'GET' });
    allMinuteRecords = Array.isArray(data) ? data : (Array.isArray(data && data.data) ? data.data : []);
    selectedMinuteIds.clear();
    activeDetailMinuteId = null;
    updateSelectedCount();

    const selectAllCb = document.getElementById('selectAllMinutes');
    if (selectAllCb) selectAllCb.checked = false;

    if (!tbody) return;
    if (!allMinuteRecords.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="opacity:0.5; font-style:italic; padding:20px; text-align:center;">No meeting minutes recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = allMinuteRecords.map(function(r, i) {
      const urlBadge = r.meeting_url
        ? '<span style="background:#4caf50; color:#fff; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold;" title="' + r.meeting_url + '"><i class="fas fa-link"></i> Yes</span>'
        : '<span style="opacity:0.3; font-size:10px;">No</span>';
      return '<tr style="border-bottom:1px solid rgba(255,255,255,0.06); cursor:pointer; transition:background 0.15s;" ' +
        'onmouseover="this.style.background=\'rgba(0,224,255,0.06)\'" onmouseout="this.style.background=\'transparent\'" ' +
        'onclick="onMinuteRowClick(event, ' + r.id + ')">' +
        '<td style="padding:10px 8px; text-align:center;"><input type="checkbox" class="minute-row-cb" data-id="' + r.id + '" onclick="event.stopPropagation(); toggleMinuteSelection(' + r.id + ', this.checked)" ' + (selectedMinuteIds.has(r.id) ? 'checked' : '') + '></td>' +
        '<td style="padding:10px 8px; font-size:12px; opacity:0.5;">' + (i + 1) + '</td>' +
        '<td style="padding:10px 8px; font-weight:600; color:#e8eaf6;">' + (r.title || 'Untitled') + '</td>' +
        '<td style="padding:10px 8px; font-size:13px; color:#aaa;">' + (r.date || '-') + '</td>' +
        '<td style="padding:10px 8px; text-align:center;">' + urlBadge + '</td>' +
        '<td style="padding:10px 8px; text-align:right;">' +
          '<button class="action-btn" style="font-size:11px; padding:4px 8px; background:#0077ff; margin:0 2px;" onclick="event.stopPropagation(); viewMinuteDetail(' + r.id + ')"><i class="fas fa-eye"></i></button>' +
          '<button class="btn-del" style="font-size:11px; padding:4px 8px; margin:0 2px;" onclick="event.stopPropagation(); deleteMinuteRecord(' + r.id + ')"><i class="fas fa-trash"></i></button>' +
        '</td></tr>';
    }).join('');
  } catch (err) {
    console.error('[loadMinuteRegistry]', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="color:#ff9800; padding:16px; text-align:center;">Failed to load: ' + err.message + '</td></tr>';
  }
}

function onMinuteRowClick(event, id) {
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.closest('button')) return;
  showMinuteDetailCard(id);
}

function showMinuteDetailCard(id) {
  const detailCard = document.getElementById('minuteDetailCard');
  const r = allMinuteRecords.find(function(m) { return m.id === id; });
  if (!r || !detailCard) return;

  activeDetailMinuteId = id;
  detailCard.style.display = 'block';
  detailCard.style.animation = 'none';
  detailCard.offsetHeight;
  detailCard.style.animation = '';

  document.getElementById('detailMinuteTitle').textContent = r.title || 'Untitled Meeting';
  document.getElementById('detailMinuteMeta').textContent = 'Date: ' + (r.date || '-') + ' | Venue: ' + (r.venue || '-') + ' | Recorded: ' + (r.created_at ? new Date(r.created_at).toLocaleDateString() : '-');
  document.getElementById('detailMinuteBody').textContent = r.body || 'No minutes recorded.';
  document.getElementById('detailMinuteChair').textContent = r.chair || '-';
  document.getElementById('detailMinuteSecretary').textContent = r.secretary || '-';
  document.getElementById('detailMinuteNextDate').textContent = r.next_meeting_date || '-';
  document.getElementById('detailMinuteAttendees').textContent = r.attendees || '-';

  var agendaSection = document.getElementById('detailMinuteAgendaSection');
  if (r.agenda && r.agenda.trim()) {
    agendaSection.style.display = 'block';
    document.getElementById('detailMinuteAgenda').textContent = r.agenda;
  } else {
    agendaSection.style.display = 'none';
  }

  var urlInput = document.getElementById('meetingUrlInput');
  if (urlInput) urlInput.value = r.meeting_url || '';

  detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function toggleAllMinutes(checked) {
  selectedMinuteIds.clear();
  if (checked) {
    allMinuteRecords.forEach(function(r) { selectedMinuteIds.add(r.id); });
  }
  document.querySelectorAll('.minute-row-cb').forEach(function(cb) { cb.checked = checked; });
  updateSelectedCount();
}

function toggleMinuteSelection(id, checked) {
  if (checked) { selectedMinuteIds.add(id); } else { selectedMinuteIds.delete(id); }
  var allCb = document.getElementById('selectAllMinutes');
  if (allCb) allCb.checked = selectedMinuteIds.size === allMinuteRecords.length && allMinuteRecords.length > 0;
  updateSelectedCount();
}

function updateSelectedCount() {
  var el = document.getElementById('minuteSelectedCount');
  if (el) el.textContent = selectedMinuteIds.size > 0 ? selectedMinuteIds.size + ' selected' : '';
}

function deleteSelectedMinutes() {
  if (!selectedMinuteIds.size) { alert('No records selected. Use the checkboxes to select minutes.'); return; }
  if (!confirm('Delete ' + selectedMinuteIds.size + ' selected minute record(s)?')) return;
  apiCall('minutes/delete-many', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.from(selectedMinuteIds) })
  }).then(function() {
    selectedMinuteIds.clear();
    document.getElementById('minuteDetailCard').style.display = 'none';
    loadMinuteRegistry();
  }).catch(function(err) {
    alert('Delete failed: ' + (err.message || 'Unknown error'));
  });
}

function deleteAllMinutes() {
  if (!allMinuteRecords.length) { alert('No records to delete.'); return; }
  if (!confirm('PERMANENTLY DELETE ALL ' + allMinuteRecords.length + ' MEETING MINUTES? This cannot be undone.')) return;
  if (!confirm('Are you absolutely sure? All meeting minutes will be lost.')) return;
  apiCall('minutes/delete-all', {
    method: 'DELETE'
  }).then(function() {
    selectedMinuteIds.clear();
    document.getElementById('minuteDetailCard').style.display = 'none';
    loadMinuteRegistry();
  }).catch(function(err) {
    alert('Delete all failed: ' + (err.message || 'Unknown error'));
  });
}

function viewMinuteDetailFromDropdown() {
  if (activeDetailMinuteId) viewMinuteDetail(activeDetailMinuteId);
}

function deleteMinuteFromDropdown() {
  if (activeDetailMinuteId) deleteMinuteRecord(activeDetailMinuteId);
}

async function sendMeetingLinkToMembers() {
  const urlInput = document.getElementById('meetingUrlInput');
  const statusEl = document.getElementById('meetingUrlStatus');

  if (!activeDetailMinuteId) {
    if (statusEl) { statusEl.style.color = '#f44336'; statusEl.textContent = 'Please select a meeting minute from the table first.'; }
    return;
  }

  const meetingUrl = (urlInput?.value || '').trim();
  if (!meetingUrl) {
    if (statusEl) { statusEl.style.color = '#f44336'; statusEl.textContent = 'Please enter a meeting URL.'; }
    return;
  }

  try {
    await apiCall('minutes/update-url', {
      method: 'POST',
      body: JSON.stringify({ id: activeDetailMinuteId, meeting_url: meetingUrl })
    });

    var r = allMinuteRecords.find(function(m) { return m.id === activeDetailMinuteId; });
    if (r) r.meeting_url = meetingUrl;

    if (statusEl) { statusEl.style.color = '#4caf50'; statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Meeting link sent! Members will see it in their Activities panel.'; }
    loadMinuteRegistry();
    setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 5000);
  } catch (err) {
    if (statusEl) { statusEl.style.color = '#f44336'; statusEl.textContent = 'Failed to send link: ' + (err.message || 'Unknown error'); }
  }
}

function viewMinuteDetail(id) {
  const r = allMinuteRecords.find(function(m) { return m.id === id; });
  if (!r) return;
  const win = window.open('', '_blank', 'width=780,height=700,scrollbars=yes');
  win.document.write('<!DOCTYPE html><html><head><title>Meeting Minutes</title><style>body{font-family:Segoe UI,sans-serif;padding:40px;color:#111;max-width:740px;margin:auto;}h1{font-size:20px;border-bottom:2px solid #009688;padding-bottom:8px;}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin:16px 0;background:#f5f5f5;padding:12px;border-radius:6px;}h2{font-size:14px;text-transform:uppercase;color:#009688;border-bottom:1px solid #ddd;padding-bottom:4px;}pre{white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.7;}@media print{button{display:none;}}</style></head><body>');
  win.document.write('<h1>ELDORET CHAMA TABLE-BANKING</h1>');
  win.document.write('<h1>' + (r.title || 'Meeting Minutes') + '</h1>');
  win.document.write('<div class="meta">');
  win.document.write('<div><strong>Date:</strong> ' + (r.date || '-') + '</div>');
  win.document.write('<div><strong>Venue:</strong> ' + (r.venue || '-') + '</div>');
  win.document.write('<div><strong>Chairperson:</strong> ' + (r.chair || '-') + '</div>');
  win.document.write('<div><strong>Secretary:</strong> ' + (r.secretary || '-') + '</div>');
  win.document.write('<div><strong>Next Meeting:</strong> ' + (r.next_meeting_date || '-') + '</div>');
  if (r.meeting_url) {
    win.document.write('<div><strong>Meeting Link:</strong> <a href="' + r.meeting_url + '" target="_blank">' + r.meeting_url + '</a></div>');
  }
  win.document.write('</div>');
  win.document.write('<h2>Members Present</h2><pre>' + (r.attendees || '-') + '</pre>');
  win.document.write('<h2>Agenda</h2><pre>' + (r.agenda || '-') + '</pre>');
  win.document.write('<h2>Minutes / Discussion Notes</h2><pre>' + (r.body || '-') + '</pre>');
  win.document.write('<br><button onclick="window.print()" style="background:#009688;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px;">Print / Save as PDF</button>');
  win.document.write('</body></html>');
  win.document.close();
}

async function deleteMinuteRecord(id) {
  if (!confirm('Are you sure you want to permanently delete this minute record?')) return;
  try {
    await apiCall('minutes/delete/' + id, { method: 'DELETE' });
    const detailCard = document.getElementById('minuteDetailCard');
    if (detailCard) detailCard.style.display = 'none';
    activeDetailMinuteId = null;
    loadMinuteRegistry();
  } catch (err) {
    alert('Delete failed: ' + (err.message || 'Unknown error'));
  }
}

function downloadMinutesReport() {
  if (!allMinuteRecords.length) {
    alert('No minutes to compile. Load the registry first.');
    return;
  }
  const now = new Date().toLocaleDateString('en-KE', { day:'2-digit', month:'long', year:'numeric' });
  const win = window.open('', '_blank', 'width=820,height=750,scrollbars=yes');
  win.document.write('<!DOCTYPE html><html><head><title>Minutes Compilation</title><style>body{font-family:Segoe UI,sans-serif;padding:40px;color:#111;max-width:760px;margin:auto;}pre{white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.7;}@media print{.no-print{display:none;}}</style></head><body>');
  win.document.write('<div style="text-align:center;border-bottom:3px double #009688;margin-bottom:24px;padding-bottom:12px;"><h1>ELDORET CHAMA TABLE-BANKING</h1><div>Complete Meeting Minutes Registry - Compiled ' + now + '</div><div style="font-size:12px;color:#999;">Total Records: ' + allMinuteRecords.length + '</div></div>');
  allMinuteRecords.forEach(function(r, i) {
    if (i > 0) win.document.write('<hr style="margin:24px 0;">');
    win.document.write('<h2>' + (i+1) + '. ' + (r.title || 'Meeting') + '</h2>');
    win.document.write('<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;background:#f5f5f5;padding:10px;border-radius:6px;margin-bottom:12px;">');
    win.document.write('<div><strong>Date:</strong> ' + (r.date || '-') + '</div>');
    win.document.write('<div><strong>Venue:</strong> ' + (r.venue || '-') + '</div>');
    win.document.write('<div><strong>Chairperson:</strong> ' + (r.chair || '-') + '</div>');
    win.document.write('<div><strong>Secretary:</strong> ' + (r.secretary || '-') + '</div>');
    win.document.write('<div><strong>Next Meeting:</strong> ' + (r.next_meeting_date || '-') + '</div>');
    if (r.meeting_url) win.document.write('<div><strong>Meeting Link:</strong> <a href="' + r.meeting_url + '" target="_blank">' + r.meeting_url + '</a></div>');
    win.document.write('</div>');
    win.document.write('<p><strong>Members Present:</strong><br>' + (r.attendees || '-').replace(/,/g, '<br>') + '</p>');
    win.document.write('<p><strong>Agenda:</strong></p><pre>' + (r.agenda || '-') + '</pre>');
    win.document.write('<p><strong>Minutes / Notes:</strong></p><pre>' + (r.body || '-') + '</pre>');
  });
  win.document.write('<br><div class="no-print"><button onclick="window.print()" style="background:#009688;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px;">Print / Save as PDF</button></div>');
  win.document.write('</body></html>');
  win.document.close();
}

function adminLogout() {
    if (!confirm('Are you sure you want to logout?')) return;
    sessionStorage.clear();
    localStorage.removeItem('adminToken');
    localStorage.removeItem('homeSessionTimedOut');
    window.location.href = 'login.html';
}

