// utils/sessionTimeout.js
// Reusable session timeout module
// Tracks user activity (mouse, keyboard, touch) and triggers a callback after inactivity.

(function () {
  const DEFAULT_TIMEOUT_MINUTES = 5; // Changed to 5 minutes for inactivity

  function initSessionTimeout(options) {
    const timeoutMinutes = options && typeof options.timeoutMinutes === 'number' ? options.timeoutMinutes : DEFAULT_TIMEOUT_MINUTES;
    const onTimeout = typeof options.onTimeout === 'function' ? options.onTimeout : function () { console.warn('Session timed out'); };
    const timeoutMs = timeoutMinutes * 60 * 1000;
    let timeoutHandle;

    function resetTimer() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      // Store last activity time
      localStorage.setItem('lastActivityTime', Date.now().toString());
      timeoutHandle = setTimeout(onTimeout, timeoutMs);
    }

    const activityEvents = ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll'];
    activityEvents.forEach(ev => window.addEventListener(ev, resetTimer, true));
    resetTimer();
  }

  // Expose globally
  window.initSessionTimeout = initSessionTimeout;
})();
