/**
 * home-listeners.js - Cross-tab storage sync listeners
 * All primary data is now DB-backed; this file handles lightweight
 * localStorage signals to trigger DB re-fetches.
 */
window.addEventListener('storage', async (e) => {
  if (e.key === 'memberPoolUpdatedTrigger' || e.key === 'memberNotifications') {
    // Re-fetch from DB on cross-tab signal
    if (typeof loadVerificationDashboard === 'function') await loadVerificationDashboard();
    if (typeof renderNotifications       === 'function') renderNotifications();
  }
});