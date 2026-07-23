// utils/security.js
// FULL ANTI-DEVTOOLS PROTECTION - disables all inspect/debug access permanently
// Covers: right-click, F12, keyboard shortcuts, DevTools window detection,
//         debugger loop, console override, and input auto-clear on action.

(function () {
    'use strict';

    function hasApprovedMemberSession() {
        try {
            var raw = localStorage.getItem('memberSession');
            if (!raw) return false;
            var session = JSON.parse(raw);
            var status = String(session && session.status || '').toLowerCase();
            return Boolean(session && (session.approved === true || status === 'approved' || status === 'active'));
        } catch (e) {
            return false;
        }
    }

    function hasAdminSession() {
        try {
            var raw = sessionStorage.getItem('adminSession');
            if (!raw) return false;
            var session = JSON.parse(raw);
            return Boolean(session && session.token && session.role === 'admin');
        } catch (e) {
            return false;
        }
    }

    function shouldProtectCurrentPage() {
        var protectedPages = ['home.html'];
        var currentPage = window.location.pathname.split('/').pop() || 'index.html';
        return protectedPages.indexOf(currentPage) !== -1;
    }

    function installAccessGate() {
        if (!shouldProtectCurrentPage() || hasApprovedMemberSession() || hasAdminSession() || document.getElementById('publicAccessGate')) return;
        var gate = document.createElement('div');
        gate.id = 'publicAccessGate';
        gate.setAttribute('role', 'dialog');
        gate.setAttribute('aria-modal', 'true');
        gate.innerHTML = [
            '<div class="public-access-card">',
            '<div class="public-access-lock">ADMIN CONSOLE</div>',
            '<h2>Authentication Required</h2>',
            '<p>This is the administrative panel. Please sign in with an authorized admin account to continue.</p>',
            '<a class="public-access-btn" href="login.html">Admin Login</a>',
            '<a class="public-access-link" href="member.html#access">Member Portal</a>',
            '</div>'
        ].join('');
        var style = document.createElement('style');
        style.textContent = [
            '#publicAccessGate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(7,12,26,.72);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}',
            '.public-access-card{width:min(420px,92vw);background:rgba(15,23,42,.96);border:1px solid rgba(0,224,255,.34);border-radius:16px;padding:30px 28px;text-align:center;color:#f8fafc;box-shadow:0 24px 70px rgba(0,0,0,.58);font-family:system-ui,-apple-system,Segoe UI,sans-serif;}',
            '.public-access-lock{display:inline-flex;align-items:center;justify-content:center;min-width:86px;height:34px;border-radius:999px;background:rgba(0,224,255,.12);color:#7defff;font-weight:800;letter-spacing:.14em;font-size:11px;margin-bottom:16px;}',
            '.public-access-card h2{font-size:28px;margin:0 0 10px;}',
            '.public-access-card p{color:#b8c2d8;line-height:1.55;margin:0 0 22px;}',
            '.public-access-btn{display:block;width:100%;padding:13px 18px;border-radius:10px;background:#ff9500;color:#fff;text-decoration:none;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;}',
            '.public-access-link{color:#7defff;text-decoration:none;font-size:13px;font-weight:700;}',
            'body.access-locked>*:not(#publicAccessGate){filter:blur(8px);pointer-events:none;user-select:none;}'
        ].join('');
        document.head.appendChild(style);
        document.body.classList.add('access-locked');
        document.body.appendChild(gate);
    }

    document.addEventListener('DOMContentLoaded', installAccessGate);
    window.addEventListener('storage', function (e) {
        if (e.key === 'memberSession' || e.key === 'adminSession') {
            var gate = document.getElementById('publicAccessGate');
            if (hasApprovedMemberSession() || hasAdminSession()) {
                if (gate) gate.remove();
                document.body.classList.remove('access-locked');
            } else {
                installAccessGate();
            }
        }
    });

    //  1. Disable Right-Click Context Menu 
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }, true);

    //  2. Block All DevTools Keyboard Shortcuts 
    document.addEventListener('keydown', function (e) {
        // F12
        if (e.key === 'F12' || e.keyCode === 123) {
            e.preventDefault(); e.stopPropagation(); return false;
        }
        // Ctrl+Shift+I / J / C  (DevTools panels)
        // Ctrl+U  (View Source)
        // Ctrl+S  (Save page)
        // Ctrl+P  (Print - exposes source layout)
        if (e.ctrlKey) {
            if (e.shiftKey && [73, 74, 67].includes(e.keyCode)) {
                e.preventDefault(); e.stopPropagation(); return false;
            }
            if ([85, 83, 80].includes(e.keyCode)) {
                e.preventDefault(); e.stopPropagation(); return false;
            }
        }
        // Mac: Cmd+Opt+I / J / C / U
        if (e.metaKey && e.altKey && [73, 74, 67, 85].includes(e.keyCode)) {
            e.preventDefault(); e.stopPropagation(); return false;
        }
    }, true);

    //  3. Continuous Debugger Loop (disabled for testing) 
    // setInterval(function () { debugger; }, 50);

    //  4. Detect DevTools Window Size (disabled to prevent false-positive blank pages) 
    /*
    var _devtools = { open: false };
    var _threshold = 160;
    function _detectDevtools() {
        var widthDiff  = window.outerWidth  - window.innerWidth;
        var heightDiff = window.outerHeight - window.innerHeight;
        if (widthDiff > _threshold || heightDiff > _threshold) {
            if (!_devtools.open) {
                _devtools.open = true;
                // Close tab / redirect away when DevTools opens
                document.body.innerHTML = '';
                window.location.replace('about:blank');
            }
        } else {
            _devtools.open = false;
        }
    }
    setInterval(_detectDevtools, 500);
    window.addEventListener('resize', _detectDevtools);
    */

    //  5. Override console (disabled to allow debug logs) 
    /*
    (function () {
        var noop = function () {};
        var methods = ['log', 'debug', 'info', 'warn', 'error', 'dir',
                       'dirxml', 'table', 'trace', 'group', 'groupCollapsed',
                       'groupEnd', 'time', 'timeEnd', 'timeLog', 'profile',
                       'profileEnd', 'count', 'countReset', 'clear', 'assert'];
        methods.forEach(function (m) {
            try { console[m] = noop; } catch (ex) {}
        });
        try {
            Object.defineProperty(window, 'console', {
                get: function () { return { log: noop, error: noop, warn: noop, debug: noop, info: noop }; },
                set: function () {},
                configurable: false
            });
        } catch (ex) {}
    })();
    */

    //  6. Block drag-to-select and drag source code out 
    document.addEventListener('dragstart', function (e) {
        if (e.target.closest('[draggable="true"], .drag-item, #documentPool, #agendaTimeline')) return;
        e.preventDefault();
    }, true);
    document.addEventListener('selectstart', function (e) {
        // Allow selection inside inputs/textareas only
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
            e.preventDefault();
        }
    }, true);

    //  7. Auto-clear input boxes after form submit or button click 
    function clearInputsInContainer(container) {
        var clearable = ['text','password','tel','number','search','url','date','datetime-local','month','week','time'];
        var inputs = container.querySelectorAll('input, textarea');
        inputs.forEach(function (el) {
            var type = (el.getAttribute('type') || 'text').toLowerCase();
            if (!el.readOnly && !el.disabled && (el.tagName.toLowerCase() === 'textarea' || clearable.includes(type))) {
                el.value = '';
            }
        });
    }
    document.addEventListener('submit', function (e) {
        setTimeout(function () { clearInputsInContainer(e.target); }, 100);
    });
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('button, input[type="button"], input[type="submit"]');
        if (btn) {
            setTimeout(function () {
                var container = btn.closest('form') || btn.closest('.form-inputs') || btn.closest('.auth-card') || btn.closest('.popup-box') || btn.closest('.error-card');
                if (container) clearInputsInContainer(container);
            }, 100);
        }
    });

    // Define Global API Base URL
    var defaultRailwayUrl = 'https://new-lm-pages-production.up.railway.app';
    var apiBase = '/api';
    if (typeof window !== 'undefined' && window.location) {
        try {
            var urlParams = new URLSearchParams(window.location.search);
            var backendParam = urlParams.get('backend');
            if (backendParam) {
                localStorage.setItem('railway_backend_url', backendParam.trim().replace(/\/$/, ''));
            }
        } catch (e) {}

        if (window.location.protocol === 'file:') {
            apiBase = 'http://127.0.0.1:3000/api';
        } else {
            var customBackend = localStorage.getItem('railway_backend_url');
            if (customBackend) {
                apiBase = customBackend.replace(/\/$/, '') + '/api';
            } else if (window.location.hostname.endsWith('github.io')) {
                // Try Railway backend, but allow fallback if it fails
                apiBase = defaultRailwayUrl + '/api';
                // Store for potential manual override
                if (!localStorage.getItem('railway_backend_url')) {
                    localStorage.setItem('railway_backend_url', defaultRailwayUrl);
                }
            }
        }
    }
    window.__API_BASE__ = apiBase;

})();
