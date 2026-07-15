/**
 * ==========================================================================
 * DATA STRUCTURE INITIALIZER MATRIX & STATE STORAGE
 * ==========================================================================
 */
const API_BASE_URL = window.__API_BASE__ || '/api'; 
const STORAGE_KEYS = {
    SESSION: 'memberSession',
    NOTIFICATIONS: 'memberNotifications',
    MEMBERS_POOL: 'membersPool'
};

const WHATSAPP_CACHE_KEY = 'whatsappMessageCache';
const DEFAULT_WHATSAPP_MESSAGE = 'Hello Admin, I need assistance with my account. Please respond when available.';
let CURRENT_SESSION = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION)) || null;
let ADMIN_PHONE = '';
let WHATSAPP_MESSAGE_CACHE = localStorage.getItem(WHATSAPP_CACHE_KEY) || '';
let WHATSAPP_FRAME_LOADED = false;
let WHATSAPP_FRAME_TIMER = null;
let WHATSAPP_FAIL_TIMER = null;
let MEMBER_DB_STATE = { loans: [], repayments: [], meetings: [] };

function readStoredArray(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(value) ? value : [];
    } catch (error) {
        localStorage.setItem(key, '[]');
        return [];
    }
}

function readStoredObject(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch (error) {
        localStorage.removeItem(key);
        return null;
    }
}

function isApprovedMemberSession(session) {
    if (!session) return false;
    const statusStr = String(session.status || '').toLowerCase();
    return statusStr === 'approved' || statusStr === 'active' || session.approved === true;
}

function applyMemberAccessBodyState(session) {
    const isLoggedIn = !!session;
    const isApproved = isApprovedMemberSession(session);
    document.body.classList.toggle('not-logged-in', !isLoggedIn);
    document.body.classList.toggle('not-approved', isLoggedIn && !isApproved);
    document.body.classList.toggle('member-approved', isApproved);
}

function ensureAuthGateVisible() {
    let gate = document.getElementById('authBlurGate');
    if (!gate) {
        gate = document.createElement('div');
        gate.id = 'authBlurGate';
        gate.setAttribute('role', 'dialog');
        gate.setAttribute('aria-modal', 'true');
        gate.setAttribute('aria-label', 'Authentication required');
        gate.innerHTML = `
            <div class="blur-gate-card">
                <i class="fas fa-lock blur-gate-icon"></i>
                <h2>Access Restricted</h2>
                <p>This portal is secured. Please sign in with your approved membership credentials to access the dashboard and services.</p>
                <a href="#" class="blur-gate-btn" id="gateLoginBtn" onclick="openAuthPortal(event,'authSection', 'loginForm')">
                    <i class="fas fa-sign-in-alt"></i>&nbsp; Sign In to Portal
                </a>
                <a href="#" class="blur-gate-btn-secondary" id="gateRegisterBtn" onclick="openAuthPortal(event,'authSection', 'registerForm')">
                    <i class="fas fa-user-plus"></i>&nbsp; New Member? Register Here
                </a>
                <div class="blur-gate-badge">
                    <i class="fas fa-shield-alt"></i>
                    End-to-end encrypted &bull; Session token verified &bull; Admin-approved access only
                </div>
            </div>
        `;
        document.body.prepend(gate);
    }
    gate.classList.remove('gate-dissolving');
    gate.style.display = 'flex';
    return gate;
}

function forceAuthOnlyView(message) {
    CURRENT_SESSION = null;
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    localStorage.removeItem('disableBlurEffect');
    localStorage.removeItem('memberAccessGranted');
    applyMemberAccessBodyState(null);
    setFunctionalSectionsLock(true);
    openAuthPortal(null, 'authSection');
    if (message) console.warn(message);
}

function getCachedWhatsAppMessage() {
    return WHATSAPP_MESSAGE_CACHE || localStorage.getItem(WHATSAPP_CACHE_KEY) || DEFAULT_WHATSAPP_MESSAGE;
}

/**
 * ==========================================================================
 * INITIALIZATION ENGINE RUNNER
 * ==========================================================================
 */
let IS_DEV_MODE = false;

/* ==========================================================================
   DARK MODE TOGGLE
   ========================================================================== */
function toggleMemberTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('member_light_mode', isLight);
    const icon = document.getElementById('themeIcon');
    if (icon) {
        icon.className = isLight ? 'fas fa-moon' : 'fas fa-sun';
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Check if session timed out and persist the timeout gate across refreshes
    const sessionTimedOut = localStorage.getItem('sessionTimedOut') === 'true';
    const timeoutTime = parseInt(localStorage.getItem('sessionTimeoutTime') || '0');
    const now = Date.now();
    const TIMEOUT_GATE_DURATION = 30 * 60 * 1000; // Keep gate active for 30 minutes
    
    if (sessionTimedOut && (now - timeoutTime) < TIMEOUT_GATE_DURATION) {
        // Session timed out and gate is still valid - show it
        const gate = document.getElementById('authBlurGate');
        if (gate) {
            showSessionTimeoutGate();
        }
        // Don't proceed with normal initialization
        return;
    } else if (sessionTimedOut && (now - timeoutTime) >= TIMEOUT_GATE_DURATION) {
        // Timeout gate expired, clear the flag
        localStorage.removeItem('sessionTimedOut');
        localStorage.removeItem('sessionTimeoutTime');
    }
    
    // Restore light mode state
    if (localStorage.getItem('member_light_mode') === 'true') {
        document.body.classList.add('light-mode');
        const icon = document.getElementById('themeIcon');
        if (icon) icon.className = 'fas fa-moon';
    } else {
        const icon = document.getElementById('themeIcon');
        if (icon) icon.className = 'fas fa-sun'; // default icon since base is dark
    }
    // Initialize session timeout (5 minutes) with logout redirect
    if (typeof initSessionTimeout === 'function') {
        initSessionTimeout({ timeoutMinutes: 5, onTimeout: logoutMember });
    }
    applyMemberAccessBodyState(CURRENT_SESSION);
    initializeNavigationEngine();
    synchronizeNotificationStreams();
    evaluateSessionUIModifications();
    loadMemberPortalData().then(rebuildMetricsDashboard);
    loadAdminPhoneNumber();
    loadDefaultBrowserShell();

    if (window.location.hash === '#access') {
        openAuthPortal(null, 'authSection');
    }

    // Check for password reset token in URL
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset_token');
    if (resetToken) {
        showRecoveryUI(new Event('load'));
        document.getElementById('recoveryStep1').style.display = 'none';
        document.getElementById('recoveryStep3').style.display = 'block';
        window.activeResetToken = resetToken;
    }

    // Listen across tab domains for real-time administrative approvals from home.html
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEYS.SESSION || e.key === STORAGE_KEYS.MEMBERS_POOL || e.key === 'loans' || e.key === 'repayments' || e.key === 'disableBlurEffect') {
            refreshStateSync();
        }
    });
});

/**
 * ==========================================================================
 * MENU NAVIGATION ENGINE & RESPONSIVE TOGGLER
 * ==========================================================================
 */
function initializeNavigationEngine() {
    const menuToggleBtn = document.getElementById("menuToggleBtn");
    const sidebarMenu = document.getElementById("sidebarMenu");
    const mainContent = document.querySelector(".main-content");

    if (menuToggleBtn && sidebarMenu) {
        menuToggleBtn.addEventListener("click", () => {
            if (window.innerWidth > 992) {
                sidebarMenu.classList.toggle("collapsed");
                if (mainContent) mainContent.classList.toggle("expanded");
            } else {
                sidebarMenu.classList.toggle("active");
            }
        });
    }

    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
            if (item.id === "navAuthLink" && CURRENT_SESSION) {
                // If logged in, the auth link acts as a logout button. Do not switch tabs.
                return;
            }
            e.preventDefault();
            const targetSectionId = item.getAttribute("data-target");
            if (targetSectionId !== 'authSection' && !isApprovedMemberSession(CURRENT_SESSION)) {
                openAuthPortal(null, 'authSection');
                return;
            }

            document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
            item.classList.add("active");

            document.querySelectorAll(".content-section").forEach(sec => sec.style.display = "none");
            const targetSec = document.getElementById(targetSectionId);
            if (targetSec) targetSec.style.display = "block";

            if (window.innerWidth <= 992 && sidebarMenu) {
                sidebarMenu.classList.remove("active");
            }
        });
    });
}

async function refreshStateSync() {
    if (CURRENT_SESSION && CURRENT_SESSION.id) {
        try {
            const updated = await apiGetMemberById(CURRENT_SESSION.id);
            if (updated) {
                // Keep password hashes or existing attributes if missing from update payload
                CURRENT_SESSION = { ...CURRENT_SESSION, ...updated };
                localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(CURRENT_SESSION));
            }
        } catch (error) {
            console.warn('Unable to refresh database session status payload', error);
        }
    }
    evaluateSessionUIModifications();
    await loadMemberPortalData();
    rebuildMetricsDashboard();
}

/**
 * ==========================================================================
 * SECURITY AUTHENTICATION PROCESSORS (LIVE API CONTROLLERS)
 * ==========================================================================
 */
async function handleMemberLogin(event) {
    event.preventDefault();
    const identity = document.getElementById("loginIdentity").value.trim();
    const pass = document.getElementById("loginPassword").value;

    try {
        const data = await apiRequest('members/login', {
            method: 'POST',
            body: JSON.stringify({ identifier: identity, password: pass })
        });
        
        const member = data.member || data;
        document.getElementById("loginForm").reset();
        const statusStr = String(member.status || '').toLowerCase();
        const isApproved = statusStr === 'approved' || statusStr === 'active' || member.approved === true;

        if (statusStr === 'pending') {
            forceAuthOnlyView('Pending member login was blocked from protected navigation.');
            postSystemLogToAdmin(`Pending account login attempted: ${member.full_name || member.name} (${member.email}).`, 'security');
            alert("Your membership is pending admin verification. Workspace access is locked.");
            return;
        }

        if (statusStr === 'denied' || statusStr === 'rejected') {
            forceAuthOnlyView('Denied member login was blocked from protected navigation.');
            postSystemLogToAdmin(`Denied account login attempted: ${member.full_name || member.name} (${member.email}).`, 'security');
            alert("Access denied. Please approach an administrator for record clearance.");
            return;
        }

        if (!isApproved) {
            forceAuthOnlyView('Unapproved member login was blocked from protected navigation.');
            alert("Your account is not approved for portal access yet.");
            return;
        }

        CURRENT_SESSION = member;
        localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(CURRENT_SESSION));
        postSystemLogToAdmin(`Access notification: ${member.full_name || member.name} initiated session login handshake.`, 'security');
        localStorage.setItem('disableBlurEffect', 'true');
        localStorage.setItem('memberAccessGranted', 'true');
        await refreshStateSync();
        await loadAdminPhoneNumber();
        alert("Authentication successful. Welcome back!");
    } catch (error) {
        forceAuthOnlyView('Member login failed; protected navigation remains locked.');
        alert(error.message || "Login failed. Please confirm credentials.");
    }
}

/**
 * ==========================================================================
 * AI-VERIFIED PASSWORD RECOVERY CONTROLLERS
 * ==========================================================================
 */
function showRecoveryUI(e) {
    e.preventDefault();
    // Hide standard auth cards
    Array.from(document.getElementById("authSection").children[0].children).forEach(el => {
        if(el.id !== 'recoveryModal') el.style.display = 'none';
    });
    document.getElementById("recoveryModal").style.display = 'block';
    
    // Reset steps
    document.getElementById("recoveryStep1").style.display = 'block';
    document.getElementById("recoveryStep2").style.display = 'none';
    document.getElementById("recoveryStep3").style.display = 'none';
    document.getElementById("recoveryEmail").value = "";
    document.getElementById("recoveryNewPassword").value = "";
}

function hideRecoveryUI() {
    // Show standard auth cards
    Array.from(document.getElementById("authSection").children[0].children).forEach(el => {
        if(el.id !== 'recoveryModal') el.style.display = 'block';
    });
    document.getElementById("recoveryModal").style.display = 'none';
    
    // Clear URL if token was present
    if (window.location.search.includes('reset_token')) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

async function requestPasswordReset(event) {
    event.preventDefault();
    const email = document.getElementById("recoveryEmail").value.trim();
    if(!email) return;
    
    const btn = document.getElementById("btnRequestReset");
    btn.disabled = true;
    btn.innerText = "Generating...";
    
    try {
        const result = await apiRequest('members/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email })
        });
        
        btn.innerText = "Reset Link Generated!";
        
        if (result.resetLink) {
            const token = result.token || result.resetLink.split('=')[1];
            const resetLink = window.location.origin + window.location.pathname + "?reset_token=" + token;

            emailjs.send("service_0gypwcr", "template_ozc1j5q", {
                email: email,
                to_email: email,
                reset_link: resetLink,
                message: resetLink,
                token: token
            }).then(() => {
                alert("Secure reset link sent to your email!");
                document.getElementById('simulatedEmailBox').style.display = 'block';
                document.getElementById('simulatedEmailBox').innerHTML = '<strong>Email Dispatched successfully!</strong> Please check your inbox and spam folders.';
            }).catch(err => {
                console.error("EmailJS Error:", err);
                document.getElementById("simulatedEmailBox").style.display = 'block';
                const linkEl = document.getElementById("simulatedEmailLink");
                linkEl.href = resetLink;
                linkEl.innerText = "Simulated Click to Reset";
                alert("Email dispatch failed. A simulated link has been provided below.");
            });
        } else {
            alert(result.message);
        }
    } catch(err) {
        alert(err.message || "Failed to initiate password reset.");
        btn.disabled = false;
        btn.innerText = "Generate Reset Link";
    }
}

async function submitAIVerifiedRecovery(event) {
    event.preventDefault();
    const newPass = document.getElementById("recoveryNewPassword").value;
    const token = window.activeResetToken;
    
    if(!newPass || !token) {
        alert("Missing secure token. Please request a new password reset link.");
        return;
    }

    try {
        const result = await apiRequest('members/recover-password', {
            method: 'POST',
            body: JSON.stringify({ token, new_password: newPass })
        });
        
        alert("Success: " + (result.message || 'Password updated securely.'));
        hideRecoveryUI();
    } catch(err) {
        alert(err.message || "Failed to update password. Token may be invalid or expired.");
    }
}

async function handleMemberRegister(event) {
    event.preventDefault();
    const name = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const phone = document.getElementById("regPhone").value.trim();
    const password = document.getElementById("regPassword").value;
    const pin = document.getElementById("regPin").value;

    if (document.getElementById("settingSimulatedDelay")?.checked) {
        await new Promise(r => setTimeout(r, 600));
    }

    try {
        const result = await apiRequest('members/create', {
            method: 'POST',
            body: JSON.stringify({ full_name: name, email, phone, password, pin })
        });

        CURRENT_SESSION = {
            id: result.id || Date.now(),
            name: name,
            full_name: name,
            email,
            phone,
            status: 'pending',
            approved: false
        };

        localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(CURRENT_SESSION));
        
        // Push onto cross-tab triggers for immediate home.html awareness
        postApprovalRequestToAdmin(`New signup file received: ${name} (${phone}).`, 'approval');
        
        // Trigger local registry cache addition if sync fallback needed
        let pool = JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS_POOL)) || [];
        pool.push(CURRENT_SESSION);
        localStorage.setItem(STORAGE_KEYS.MEMBERS_POOL, JSON.stringify(pool));

        document.getElementById("registerForm").reset();
        evaluateSessionUIModifications();
        rebuildMetricsDashboard();
        
        alert("Registration file successfully transmitted into database validation queue.");
    } catch (error) {
        alert(error.message || "Registration failed. Record might already exist.");
    }
}

/**
 * ==========================================================================
 * ACCESS LEVEL VERIFICATION MASK CONTROLLER
 * ==========================================================================
 */
function evaluateSessionUIModifications() {
    const banner = document.getElementById("approvalPendingBanner");
    const userBadge = document.getElementById("userBadge");
    const badgeUsername = document.getElementById("badgeUsername");
    const authLink = document.getElementById("navAuthLink");
    applyMemberAccessBodyState(CURRENT_SESSION);

    if (!CURRENT_SESSION) {
        const chatNameInput = document.getElementById("chatFullName");
        const chatEmailInput = document.getElementById("chatEmail");
        if (chatNameInput) chatNameInput.value = "";
        if (chatEmailInput) chatEmailInput.value = "";
        if (banner) {
            banner.style.display = "flex";
            banner.className = "alert-banner warning";
            banner.innerHTML = `
                <div class="banner-icon"><i class="fas fa-lock"></i></div>
                <div class="banner-body">
                    <h4>Authentication Required</h4>
                    <p>You must be logged in to access secure functional sections. Please open the Access Portal.</p>
                </div>
            `;
        }
        if (userBadge) userBadge.style.display = "none";
        if (authLink) {
            authLink.innerHTML = `<i class="fas fa-sign-in-alt"></i> Access Portal`;
            authLink.onclick = null;
        }
        setFunctionalSectionsLock(true);
        return;
    }

    if (userBadge) userBadge.style.display = "flex";
    if (badgeUsername) badgeUsername.innerText = CURRENT_SESSION.full_name || CURRENT_SESSION.name || "Member";
    const chatNameInput = document.getElementById("chatFullName");
    const chatEmailInput = document.getElementById("chatEmail");
    if (chatNameInput && !chatNameInput.value.trim()) chatNameInput.value = CURRENT_SESSION.full_name || CURRENT_SESSION.name || "";
    if (chatEmailInput && !chatEmailInput.value.trim()) chatEmailInput.value = CURRENT_SESSION.email || "";
    
    if (authLink) {
        authLink.innerHTML = `<i class="fas fa-sign-out-alt"></i> Close Session`;
        authLink.onclick = executeLogoutSequence;
    }

    // Unlocked explicitly when database model returns 'approved' status
    const statusStr = String(CURRENT_SESSION.status || '').toLowerCase();
    const isApproved = (statusStr === 'approved' || statusStr === 'active' || CURRENT_SESSION.approved === true);

    if (!isApproved) {
        if (banner) {
            banner.style.display = "flex";
            banner.className = "alert-banner warning";
            banner.innerHTML = `
                <div class="banner-icon"><i class="fas fa-clock"></i></div>
                <div class="banner-body">
                    <h4>Account Pending Verification</h4>
                    <p>Your access request has been securely transmitted. You will be granted system functionality once approved.</p>
                </div>
            `;
        }
        setFunctionalSectionsLock(true);
    } else {
        if (banner) banner.style.display = "none";
        setFunctionalSectionsLock(false);
        //  APPROVED - dissolve the blur protection gate
        dissolveAuthGate();
    }
}

function setFunctionalSectionsLock(shouldLock) {
    const targets = ["takeLoanSection", "payLoanSection", "meetingsSection"];
    targets.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (shouldLock) {
                el.classList.add("disabled-ui-mask");
                // Disable inner buttons/inputs to enforce view mask integrity
                el.querySelectorAll("input, button, select").forEach(child => child.setAttribute("disabled", "true"));
            } else {
                el.classList.remove("disabled-ui-mask");
                el.querySelectorAll("input, button, select").forEach(child => child.removeAttribute("disabled"));
                // Keep inactive selection tracker input fixed
                const disabledRadio = document.getElementById("radioStatusActive");
                if (disabledRadio) disabledRadio.setAttribute("disabled", "true");
            }
        }
    });
}

function logoutMember() {
    // Mark session as timed out
    localStorage.setItem('sessionTimedOut', 'true');
    localStorage.setItem('sessionTimeoutTime', Date.now().toString());
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    localStorage.removeItem('disableBlurEffect');
    localStorage.removeItem('memberAccessGranted');
    CURRENT_SESSION = null;
    applyMemberAccessBodyState(null);
    
    // Show blur gate with timeout message
    showSessionTimeoutGate();
}

function showSessionTimeoutGate() {
    const gate = ensureAuthGateVisible();
    if (!gate) return;
    
    // Remove any existing message and update
    const existingMsg = gate.querySelector('.timeout-message');
    if (existingMsg) existingMsg.remove();
    
    // Create timeout message
    const timeoutMsg = document.createElement('div');
    timeoutMsg.className = 'timeout-message';
    timeoutMsg.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(15, 23, 42, 0.95);
        padding: 2rem;
        border-radius: 12px;
        border: 2px solid #ef4444;
        text-align: center;
        color: #f8fafc;
        z-index: 10001;
        max-width: 400px;
    `;
    timeoutMsg.innerHTML = `
        <h3 style="color: #ef4444; margin-bottom: 1rem;">Session Expired</h3>
        <p style="margin-bottom: 1.5rem; color: #cbd5e1;">Your session timed out due to 5 minutes of inactivity. Please sign in again.</p>
        <button onclick="location.reload()" style="
            background: #38bdf8;
            color: #000;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            font-size: 1rem;
        ">Sign In Again</button>
    `;
    
    gate.appendChild(timeoutMsg);
    gate.style.display = 'flex';
}

function executeLogoutSequence(e) {
    if(e) e.preventDefault();
    if(confirm("Confirm security termination of active portal workspace session?")) {
        localStorage.removeItem(STORAGE_KEYS.SESSION);
        localStorage.removeItem('disableBlurEffect');
        localStorage.removeItem('memberAccessGranted');
        CURRENT_SESSION = null;
        window.location.reload();
    }
}

/**
 * ==========================================================================
 * AUTH BLUR GATE CONTROLLERS
 * ==========================================================================
 */

/**
 * dissolveAuthGate()
 * Called when an APPROVED session is confirmed.
 * Adds 'gate-dissolving' class (CSS fade-out transition),
 * then fully removes the element from DOM after the animation.
 */
function dissolveAuthGate() {
    const gate = document.getElementById('authBlurGate');
    if (!gate) return;
    gate.classList.add('gate-dissolving');
    // Remove from DOM after the 500ms CSS transition
    setTimeout(() => gate.remove(), 520);
}

/**
 * openAuthPortal(e, sectionId)
 * Called from the blur gate buttons.
 * Hides the gate card (not the gate itself - keeps blur while auth section is open),
 * scrolls to the auth section, and activates it.
 */
function openAuthPortal(e, sectionId, targetFormId = null) {
    if (e) e.preventDefault();
    const gate = document.getElementById('authBlurGate');
    if (gate) {
        // Shrink the gate card so auth section behind is reachable
        gate.classList.add('gate-dissolving');
        setTimeout(() => gate.remove(), 520);
    }
    // Activate the auth section via the existing nav system
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    const targetSec = document.getElementById(sectionId);
    if (targetSec) targetSec.style.display = 'block';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const authNavItem = document.getElementById('navAuthLink');
    if (authNavItem) authNavItem.classList.add('active');
    
    if (targetFormId) {
        setTimeout(() => {
            const form = document.getElementById(targetFormId);
            if (form) {
                form.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const firstInput = form.querySelector('input');
                if (firstInput) firstInput.focus();
            }
        }, 550); // wait for blur gate to dissolve
    }
}


/**
 * ==========================================================================
 * DYNAMIC NOTIFICATION DISPATCHING ENGINE
 * ==========================================================================
 */
function postSystemLogToAdmin(msg, category) {
    let globalLogs = readStoredArray(STORAGE_KEYS.NOTIFICATIONS);
    globalLogs.push({
        id: 'LOG-' + Date.now(),
        message: msg,
        type: category,
        timestamp: new Date().toLocaleTimeString()
    });
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(globalLogs));
}

function postApprovalRequestToAdmin(msg, category) {
    let adminLogs = JSON.parse(localStorage.getItem('adminNotifications')) || [];
    adminLogs.unshift({
        id: 'ADMIN-' + Date.now(),
        message: msg,
        type: category,
        timestamp: new Date().toLocaleTimeString()
    });
    localStorage.setItem('adminNotifications', JSON.stringify(adminLogs));
}

async function apiRequest(path, options = {}) {
    const url = `${API_BASE_URL}/${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (CURRENT_SESSION && CURRENT_SESSION.token) {
        headers['Authorization'] = 'Bearer ' + CURRENT_SESSION.token;
    }

    const response = await fetch(url, {
        headers,
        credentials: 'same-origin',
        ...options
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Back-end communication failure.');
    }
    return data.data ?? data;
}

async function apiGetMemberById(id) {
    return await apiRequest(`members/view?id=${id}`, { method: 'GET' });
}

async function loadAdminPhoneNumber() {
    // Load dynamic admin contact based on member's approver
    if (!CURRENT_SESSION || !CURRENT_SESSION.email) {
        console.warn('No active session to load admin contact');
        return;
    }
    
    try {
        // Fetch member's approver details from backend
        const response = await fetch(API_BASE_URL + '/members/approver-contact?email=' + encodeURIComponent(CURRENT_SESSION.email));
        if (!response.ok) throw new Error('Failed to load admin contact');
        
        const raw = await response.json();
        const approverData = raw.data || raw;
        
        const resolvedName = approverData.admin_name || 'System Admin';
        const resolvedPhone = approverData.admin_phone || '0741943207';
        const resolvedEmail = approverData.admin_email || 'admin@chama.local';

        if (resolvedPhone) {
            ADMIN_PHONE = String(resolvedPhone || '').trim();
            localStorage.setItem('currentAdminPhone', ADMIN_PHONE);
        }
        
        // Update the UI with admin details
        const adminNameDisplay = document.getElementById('adminNameDisplay');
        const adminPhoneDisplay = document.getElementById('adminPhoneDisplay');
        const adminEmailDisplay = document.getElementById('adminEmailDisplay');
        const adminContactHint = document.getElementById('adminContactHint');
        
        if (adminNameDisplay) adminNameDisplay.textContent = resolvedName;
        if (adminPhoneDisplay) adminPhoneDisplay.textContent = resolvedPhone;
        if (adminEmailDisplay) adminEmailDisplay.textContent = resolvedEmail;
        if (adminContactHint) adminContactHint.textContent = `${resolvedName} is your assigned officer`;
        
    } catch (err) {
        console.warn('Unable to load admin contact:', err);
        const adminContactHint = document.getElementById('adminContactHint');
        const adminNameDisplay = document.getElementById('adminNameDisplay');
        const adminPhoneDisplay = document.getElementById('adminPhoneDisplay');
        const adminEmailDisplay = document.getElementById('adminEmailDisplay');
        ADMIN_PHONE = '0741943207';
        if (adminNameDisplay) adminNameDisplay.textContent = 'System Admin';
        if (adminPhoneDisplay) adminPhoneDisplay.textContent = '0741943207';
        if (adminEmailDisplay) adminEmailDisplay.textContent = 'admin@chama.local';
        if (adminContactHint) adminContactHint.textContent = 'System Admin is your assigned officer';
    }
}

function synchronizeNotificationStreams() {
    const feed = document.getElementById("memberNotificationFeed");
    if (!feed) return;

    const globalLogs = readStoredArray(STORAGE_KEYS.NOTIFICATIONS);
    const allowedTypes = ['meeting', 'loan'];
    const filtered = globalLogs.filter(log => allowedTypes.includes(log.type));

    if (filtered.length === 0) {
        feed.innerHTML = `<div class="text-muted" style="text-align:center; padding-top:2rem;">No isolated membership updates present inside stream.</div>`;
        return;
    }

    feed.innerHTML = filtered.reverse().map(log => `
        <div class="notification-item ${log.type}">
            <p><i class="${log.type === 'meeting' ? 'fas fa-video text-purple' : 'fas fa-money-bill-wave text-success'}"></i> ${log.message}</p>
            <span class="notification-time">${log.timestamp || 'Live Trace'}</span>
        </div>
    `).join('');
}

/**
 * ==========================================================================
 * TRANSACTIONAL PIN VERIFICATION
 * ==========================================================================
 */
let pendingTransactionCallback = null;

function promptForTransactionPin(callback) {
    pendingTransactionCallback = callback;
    document.getElementById("transactionPinInput").value = '';
    document.getElementById("securityPinModal").style.display = 'flex';
}

function openTransactionPinModal(callback) {
    promptForTransactionPin(callback);
}

function cancelTransactionPin() {
    pendingTransactionCallback = null;
    document.getElementById("securityPinModal").style.display = 'none';
}

function confirmTransactionPin() {
    const pin = document.getElementById("transactionPinInput").value;
    if (pin.length !== 4) {
        alert("Please enter a valid 4-digit PIN.");
        return;
    }
    document.getElementById("securityPinModal").style.display = 'none';
    if (pendingTransactionCallback) {
        pendingTransactionCallback(pin);
        pendingTransactionCallback = null;
    }
}

/*
 * ==========================================================================
 * REAL-TIME LOAN & MEETING LIFECYCLE MANAGERS
 * ==========================================================================
 */
async function processLoanApplication(event) {
    event.preventDefault();
    if (!CURRENT_SESSION) return;

    const amt = parseFloat(document.getElementById("loanAmount").value);
    const dur = parseInt(document.getElementById("loanDuration").value);

    promptForTransactionPin(async (pin) => {

        try {
            const payload = {
                member_id: CURRENT_SESSION.id,
                amount: amt,
                duration: dur,
                interest_rate: 12,
                pin: pin
            };

            // Post straight to backend live router channel
            const result = await apiRequest('loans/create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

        // Fallback sync vector configuration to keep administrative ledger in home.html aligned instantly
        let sharedLoans = JSON.parse(localStorage.getItem('loans')) || [];
        const trackingId = result.id ? 'LNK-' + result.id : 'LNK-' + Math.floor(1000 + Math.random() * 9000);
        
        sharedLoans.push({
            id: trackingId,
            db_id: result.id,
            memberId: CURRENT_SESSION.id,
            borrower_name: CURRENT_SESSION.full_name || CURRENT_SESSION.name,
            amount: amt,
            duration: dur,
            status: 'Active',
            timestamp: new Date().toLocaleDateString()
        });
        localStorage.setItem('loans', JSON.stringify(sharedLoans));

        postNotificationToChannels(`Loan Application Confirmed: File ${trackingId} for Ksh ${amt.toFixed(2)} is now live.`, 'loan');
        document.getElementById("takeLoanForm").reset();
        
        await loadMemberPortalData();
        rebuildMetricsDashboard();
        alert("Loan application filed into live database ledger record successfully.");
    } catch (error) {
        alert(error.message || "Failed to submit loan request to database.");
    }
    });
}

async function processLoanSettlement(event) {
    event.preventDefault();
    const targetId = document.getElementById("payLoanSelect").value;
    const payVal = parseFloat(document.getElementById("payAmount").value);
    const method = document.querySelector('input[name="payMethod"]:checked').value;

    if (!targetId || !CURRENT_SESSION) return;

    let sharedLoans = JSON.parse(localStorage.getItem('loans')) || [];
    const loanIdx = sharedLoans.findIndex(l => l.id === targetId);
    if (loanIdx === -1) return;

    promptForTransactionPin(async (pin) => {
        try {
            // Find actual DB ID from loaded member state, fallback to stripping LNK-
            let dbLoanId = targetId.replace('LNK-', '');
            if (MEMBER_DB_STATE.loans && MEMBER_DB_STATE.loans.length) {
                const liveLoan = MEMBER_DB_STATE.loans.find(l => String(l.id) === targetId || String(l.db_id) === targetId || 'LNK-'+l.id === targetId);
                if (liveLoan) dbLoanId = liveLoan.db_id || liveLoan.id;
            }
            
            await apiRequest('repayments/create', {
                method: 'POST',
                body: JSON.stringify({
                    loan_id: dbLoanId,
                    member_id: CURRENT_SESSION.id,
                    amount: payVal,
                    payment_method: method,
                    pin: pin
                })
            });

        // Apply visual transaction deduction onto client ledger tracking parameters
        sharedLoans[loanIdx].amount -= payVal;
        if (sharedLoans[loanIdx].amount <= 0) {
            sharedLoans[loanIdx].amount = 0;
            sharedLoans[loanIdx].status = 'Settled';
        }
        localStorage.setItem('loans', JSON.stringify(sharedLoans));

        // Increment dynamic historical cross-window records tracker
        let sharedRepayments = JSON.parse(localStorage.getItem('repayments')) || [];
        sharedRepayments.unshift({
            id: 'RPY-' + Date.now(),
            loan_id: targetId,
            member_name: CURRENT_SESSION.full_name || CURRENT_SESSION.name,
            amount: payVal,
            method: method,
            date: new Date().toLocaleDateString()
        });
        localStorage.setItem('repayments', JSON.stringify(sharedRepayments));

        postNotificationToChannels(`Remittance Confirmed: Installment of Ksh ${payVal} applied via ${method} onto file ${targetId}.`, 'loan');
        document.getElementById("payLoanForm").reset();
        
        await loadMemberPortalData();
        rebuildMetricsDashboard();
        alert("Repayment processing approved and stored inside system ledger.");
    } catch (error) {
        alert(error.message || "Repayment rejected by database verification.");
    }
    });
}

function triggerJoinMeeting() {
    const activeRadio = document.getElementById("radioStatusActive");
    const inactiveRadio = document.getElementById("radioStatusInactive");
    const leaveBtn = document.getElementById("btnLeaveGroup");

    if (activeRadio) activeRadio.checked = true;
    if (inactiveRadio) inactiveRadio.checked = false;
    if (leaveBtn) leaveBtn.disabled = false;

    let joinedCount = parseInt(localStorage.getItem('metric_joined_meetings') || '0');
    localStorage.setItem('metric_joined_meetings', (joinedCount + 1).toString());

    const memberName = CURRENT_SESSION ? (CURRENT_SESSION.full_name || CURRENT_SESSION.name) : "Member";
    postNotificationToChannels(`Assembly Notification: ${memberName} established connection verification inside live video channel room.`, 'meeting');
    rebuildMetricsDashboard();
}

function triggerLeaveGroup() {
    const activeRadio = document.getElementById("radioStatusActive");
    const inactiveRadio = document.getElementById("radioStatusInactive");
    const leaveBtn = document.getElementById("btnLeaveGroup");

    if (inactiveRadio) inactiveRadio.checked = true;
    if (activeRadio) activeRadio.checked = false;
    if (leaveBtn) leaveBtn.disabled = true;

    let leftCount = parseInt(localStorage.getItem('metric_left_groups') || '0');
    localStorage.setItem('metric_left_groups', (leftCount + 1).toString());

    const memberName = CURRENT_SESSION ? (CURRENT_SESSION.full_name || CURRENT_SESSION.name) : "Member";
    postNotificationToChannels(`System Notice: Profile account ${memberName} disconnected session participation structures.`, 'meeting');
    rebuildMetricsDashboard();
}

function postNotificationToChannels(msg, type) {
    let globalLogs = readStoredArray(STORAGE_KEYS.NOTIFICATIONS);
    globalLogs.push({
        id: 'SYS-' + Date.now(),
        message: msg,
        type: type,
        timestamp: new Date().toLocaleTimeString()
    });
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(globalLogs));
    synchronizeNotificationStreams();
}

/**
 * ==========================================================================
 * TOAST NOTIFICATION DISPLAY
 * ==========================================================================
 */
function showToast(message, type = 'info') {
    let existingToast = document.getElementById('memberToastContainer');
    if (existingToast) {
        existingToast.remove();
    }

    const toastContainer = document.createElement('div');
    toastContainer.id = 'memberToastContainer';
    toastContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        animation: slideInRight 0.3s ease-out;
    `;

    const toastBox = document.createElement('div');
    toastBox.className = `toast-notification toast-${type}`;
    toastBox.style.cssText = `
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        padding: 12px 16px;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-size: 14px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 250px;
    `;

    const icon = type === 'success' ? '' : type === 'error' ? '' : 'i';
    toastBox.innerHTML = `<span style="font-size: 18px;">${icon}</span><span>${message}</span>`;
    
    toastContainer.appendChild(toastBox);
    document.body.appendChild(toastContainer);

    // Add animation keyframes if not present
    if (!document.getElementById('toastAnimationStyle')) {
        const style = document.createElement('style');
        style.id = 'toastAnimationStyle';
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Auto-remove after 3 seconds
    setTimeout(() => {
        toastBox.style.animation = 'slideOutRight 0.3s ease-out forwards';
        setTimeout(() => toastContainer.remove(), 300);
    }, 3000);
}

/**
 * ==========================================================================
 * INTERNAL INSTANT COMMUNICATIONS ENGINE (CHATBOX)
 * ==========================================================================
 */
function openWhatsAppChatWithAdmin(e) {
    e.preventDefault();
    const nameInput = document.getElementById("chatFullName");
    const emailInput = document.getElementById("chatEmail");
    const subjectInput = document.getElementById("chatSubject");
    const messageInput = document.getElementById("chatMessageInput");
    if (!messageInput) return;
    
    if (!ADMIN_PHONE) {
        showToast('Admin phone number not available', 'error');
        return;
    }

    const memberName = CURRENT_SESSION ? (CURRENT_SESSION.full_name || CURRENT_SESSION.name) : "Member";
    const memberEmail = CURRENT_SESSION ? CURRENT_SESSION.email : "";
    if (nameInput && !nameInput.value.trim()) nameInput.value = memberName;
    if (emailInput && !emailInput.value.trim()) emailInput.value = memberEmail;

    const fullName = (nameInput?.value || memberName).trim();
    const email = (emailInput?.value || memberEmail).trim();
    const subject = (subjectInput?.value || '').trim();
    const msg = messageInput.value.trim();
    if (!subject) {
        showToast('Please enter a subject', 'error');
        return;
    }
    if (!msg) {
        showToast('Please type a message first', 'error');
        return;
    }

    const normalized = String(ADMIN_PHONE).replace(/[^0-9]/g, '');
    if (!normalized) {
        showToast('Admin phone number is invalid', 'error');
        return;
    }

    const messagePreview = `From ${fullName}${email ? ' <' + email + '>' : ''}\nSubject: ${subject}\n\n${msg}`;
    WHATSAPP_MESSAGE_CACHE = messagePreview;
    localStorage.setItem(WHATSAPP_CACHE_KEY, messagePreview);
    const displayPhone = ADMIN_PHONE.trim().startsWith('+') ? ADMIN_PHONE.trim() : `+${normalized}`;

    const encoded = encodeURIComponent(messagePreview);
    const url = `https://web.whatsapp.com/send?phone=${normalized}&text=${encoded}`;
    
    showToast(`Opening WhatsApp with ${displayPhone}...`, 'success');
    window.open(url, '_blank', 'noopener');
    
    if (subjectInput) subjectInput.value = "";
    messageInput.value = "";
}

function showWhatsAppFrame(url) {
    const container = document.getElementById('whatsappFrameContainer');
    const frame = document.getElementById('whatsappFrame');
    if (!container || !frame) return;

    if (WHATSAPP_FRAME_TIMER) {
        clearTimeout(WHATSAPP_FRAME_TIMER);
        WHATSAPP_FRAME_TIMER = null;
    }
    if (WHATSAPP_FAIL_TIMER) {
        clearTimeout(WHATSAPP_FAIL_TIMER);
        WHATSAPP_FAIL_TIMER = null;
    }

    WHATSAPP_FRAME_LOADED = false;
    frame.style.display = 'block';
    frame.onload = () => {
        WHATSAPP_FRAME_LOADED = true;
        updateBrowserStatus('Page loaded in the embedded browser.');
    };

    updateBrowserStatus(`Loading ${url}...`);
    frame.src = url;
    container.style.display = 'block';

    WHATSAPP_FRAME_TIMER = setTimeout(() => {
        if (!WHATSAPP_FRAME_LOADED && frame.src !== 'about:blank') {
            updateBrowserStatus('Page load still in progress...');
        }
    }, 1200);
}

let SELECTED_BROWSER = 'chrome';

function getBrowserHomeUrl() {
    const homeUrls = {
        chrome: 'about:blank',
        firefox: 'about:blank',
        edge: 'about:blank',
        opera: 'about:blank',
        brave: 'about:blank'
    };
    return homeUrls[SELECTED_BROWSER] || homeUrls.chrome;
}

function updateBrowserSelection() {
    const selector = document.getElementById('browserSelector');
    if (!selector) return;
    SELECTED_BROWSER = selector.value;
    const label = selector.options[selector.selectedIndex].text;
    updateBrowserStatus(`Selected ${label}. Use Chrome or Open WhatsApp Chat.`);
}

function getBrowserLabel() {
    const selector = document.getElementById('browserSelector');
    return selector?.options[selector.selectedIndex]?.text || 'Chrome';
}

function loadDefaultBrowserShell() {
    const selector = document.getElementById('browserSelector');
    if (selector) {
        selector.value = SELECTED_BROWSER;
        updateBrowserSelection();
    }
    updateBrowserStatus('Internal communications ready. Fill the message form to send via WhatsApp.');
}

function openWhatsAppChat() {
    if (!ADMIN_PHONE) return;
    const normalized = String(ADMIN_PHONE).replace(/[^0-9]/g, '');
    if (!normalized) return;
    const cachedMessage = getCachedWhatsAppMessage();
    const encoded = encodeURIComponent(cachedMessage);
    const url = `https://web.whatsapp.com/send?phone=${normalized}&text=${encoded}`;
    updateBrowserStatus('Opening WhatsApp Web in a new browser tab...');
    window.open(url, '_blank', 'noopener');
}

function openBrowserHome() {
    const homeUrl = getBrowserHomeUrl();
    updateBrowserStatus(`Loading ${getBrowserLabel()} homepage in the live browser shell...`);
    showWhatsAppFrame(homeUrl);
}

function refreshWhatsApp() {
    const frame = document.getElementById('whatsappFrame');
    if (!frame) return;
    const currentSrc = frame.src;
    if (currentSrc && currentSrc !== 'about:blank') {
        frame.src = 'about:blank';
        setTimeout(() => {
            frame.src = currentSrc;
        }, 100);
    }
}

function closeWhatsAppFrame() {
    const frame = document.getElementById('whatsappFrame');
    if (frame) {
        frame.src = 'about:blank';
    }
    updateBrowserStatus('Live browser shell cleared. Enter a new URL or search and press Go.');
}

function openCurrentUrlInTab() {
    const homeUrl = getBrowserHomeUrl();
    const label = getBrowserLabel();
    updateBrowserStatus(`Opening ${label} homepage in a new tab...`);
    window.open(homeUrl, '_blank', 'noopener');
}

function isBlockedIframeUrl(url) {
    return false;
}

function updateBrowserStatus(message) {
    const browserBanner = document.getElementById('browserStatusBanner');
    const aiBanner = document.getElementById('aiStatusBanner');
    if (aiBanner) {
        aiBanner.textContent = message;
        return;
    }
    if (browserBanner) {
        browserBanner.textContent = message;
    }
}

/* ==========================================================================
   AI ASSISTANT (Client-side fallback + backend proxy if available)
   ========================================================================== */
function initAIAssistant() {
    const form = document.getElementById('aiChatForm');
    if (form) form.addEventListener('submit', aiAssistantSend);

    const win = document.getElementById('aiChatWindow');
    if (win) {
        win.innerHTML = '<div class="ai-bubble system">Hello - I\'m your AI assistant. Ask about your account, loans, or site features.</div>';
        win.scrollTop = win.scrollHeight;
    }
}

async function aiAssistantSend(event) {
    event.preventDefault();
    const input = document.getElementById('aiChatInput');
    const windowEl = document.getElementById('aiChatWindow');
    if (!input || !windowEl) return;
    const text = input.value.trim();
    if (!text) return;

    renderAIBubble('user', text);
    input.value = '';
    setAITyping(true);

    try {
        // Try backend AI proxy first
        const resp = await fetch(API_BASE_URL + '/ai/assistant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, session: CURRENT_SESSION })
        });

        if (resp.ok) {
            const body = await resp.json();
            const reply = body.reply || body.message || JSON.stringify(body);
            renderAIBubble('assistant', reply);
        } else {
            const txt = await resp.text();
            renderAIBubble('assistant', txt || 'AI backend returned an error.');
        }
    } catch (err) {
        // Offline/fallback behaviour - simple, helpful reply
        const fallback = `Assistant (offline): I received your message: "${text}". Try asking: \"What is my loan status?\"`;
        renderAIBubble('assistant', fallback);
        console.warn('AI assistant proxy failed:', err);
    } finally {
        setAITyping(false);
    }
}

function renderAIBubble(role, text) {
    const windowEl = document.getElementById('aiChatWindow');
    if (!windowEl) return;
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble ' + (role === 'user' ? 'outbound' : (role === 'assistant' ? 'inbound' : 'system'));
    bubble.style.margin = '6px 0';
    bubble.style.padding = '8px 10px';
    bubble.style.borderRadius = '8px';
    bubble.style.maxWidth = '95%';
    if (role === 'user') {
        bubble.style.background = 'linear-gradient(90deg,#3b82f6,#06b6d4)';
        bubble.style.color = '#fff';
        bubble.style.alignSelf = 'flex-end';
    } else if (role === 'assistant') {
        bubble.style.background = 'var(--bg-dark-panel)';
        bubble.style.color = 'inherit';
    } else {
        bubble.style.background = 'transparent';
        bubble.style.color = '#999';
    }
    bubble.innerText = text;
    windowEl.appendChild(bubble);
    windowEl.scrollTop = windowEl.scrollHeight;
}

function setAITyping(isTyping) {
    const banner = document.getElementById('aiStatusBanner');
    if (!banner) return;
    banner.textContent = isTyping ? 'Assistant is typing...' : 'Ready to assist.';
}

async function loadMemberPortalData() {
    if (!CURRENT_SESSION || !CURRENT_SESSION.id || !isApprovedMemberSession(CURRENT_SESSION)) {
        MEMBER_DB_STATE = { loans: [], repayments: [], meetings: [], contributions: [], expenses: [], logs: [] };
        return MEMBER_DB_STATE;
    }

    const memberId = encodeURIComponent(CURRENT_SESSION.id);
    const next = { loans: [], repayments: [], meetings: [], contributions: [], expenses: [], logs: [] };
    
    // Parallel loading for performance
    const endpoints = [
        { key: 'loans', url: 'loans/member/' + memberId },
        { key: 'repayments', url: 'repayments/member/' + memberId },
        { key: 'meetings', url: 'automation/meetings/member/' + memberId },
        { key: 'contributions', url: 'contributions/member/' + memberId },
        { key: 'expenses', url: 'expenses/member/' + memberId },
        { key: 'logs', url: 'logs/member/' + memberId }
    ];

    try {
        const results = await Promise.allSettled(endpoints.map(ep => apiRequest(ep.url, { method: 'GET' })));
        
        results.forEach((res, idx) => {
            if (res.status === 'fulfilled') {
                next[endpoints[idx].key] = res.value || [];
            } else {
                console.warn(`[loadMemberPortalData] ${endpoints[idx].key} fallback:`, res.reason);
            }
        });
    } catch (error) {
        console.error('[loadMemberPortalData] global fetch error', error);
    }
    
    MEMBER_DB_STATE = next;
    return MEMBER_DB_STATE;
    return MEMBER_DB_STATE;
}

function memberLoanViewModel(loan) {
    return {
        id: loan.id ? 'LNK-' + loan.id : loan.local_id,
        db_id: loan.id || loan.db_id,
        memberId: String(loan.borrower_id || loan.memberId || CURRENT_SESSION?.id || ''),
        borrower_name: loan.borrower_name || CURRENT_SESSION?.full_name || CURRENT_SESSION?.name || 'Member',
        amount: Number(loan.amount || 0),
        duration: loan.duration || 0,
        status: loan.status || 'Active',
        timestamp: loan.timestamp ? new Date(loan.timestamp).toLocaleDateString() : new Date().toLocaleDateString()
    };
}

function renderMemberMeetings() {
    const meetingsList = document.getElementById('meetingsList') || document.getElementById('memberMeetingsList');
    if (!meetingsList) return;
    const meetings = MEMBER_DB_STATE.meetings || [];
    meetingsList.innerHTML = meetings.length ? meetings.map(m => `
        <div class="notification-item meeting">
            <p><i class="fas fa-calendar-alt text-purple"></i> <strong>${m.title}</strong></p>
            <span class="notification-time">${m.meeting_date || ''} ${m.meeting_time || ''} - ${m.location || m.platform || 'Meeting'}</span>
        </div>
    `).join('') : '<p class="text-muted" style="text-align:center; padding:12px;">No meetings scheduled by your administrator yet.</p>';
}

/**
 * ==========================================================================
 * DYNAMIC METRICS REBUILDER & LEDGER COMPILER
 * ==========================================================================
 */
function rebuildMetricsDashboard() {
    const pool = JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS_POOL)) || [];
    const cachedLedger = readStoredArray('loans');
    const cachedRepayments = readStoredArray('repayments');
    const ledger = (MEMBER_DB_STATE.loans && MEMBER_DB_STATE.loans.length) ? MEMBER_DB_STATE.loans.map(memberLoanViewModel) : cachedLedger;
    const repaymentsList = (MEMBER_DB_STATE.repayments && MEMBER_DB_STATE.repayments.length) ? MEMBER_DB_STATE.repayments : cachedRepayments;
    
    const totalMembersEl = document.getElementById("tileTotalMembers");
    if (totalMembersEl) totalMembersEl.innerText = pool.length;

    if (CURRENT_SESSION) {
        const myLoans = ledger.filter(l => l.memberId === CURRENT_SESSION.id);
        const activeLoans = myLoans.filter(l => l.status === 'Active');
        
        const totalOutstanding = myLoans.reduce((sum, l) => sum + (l.status === 'Active' ? parseFloat(l.amount) : 0), 0);
        const takenTile = document.getElementById("tileLoansTaken");
        if (takenTile) takenTile.innerText = `Ksh ${totalOutstanding.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        
        const activeTile = document.getElementById("tileActiveLoans");
        if (activeTile) activeTile.innerText = activeLoans.length;

        // Sum repayments matched against this member's full name to present live totals
        const myRepaymentsSum = repaymentsList
            .filter(r => String(r.member_id || '') === String(CURRENT_SESSION.id) || r.member_name === (CURRENT_SESSION.full_name || CURRENT_SESSION.name))
            .reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
            
        const paidTile = document.getElementById("tileLoansPaid");
        if (paidTile) paidTile.innerText = `Ksh ${myRepaymentsSum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        // Update Repayment Progress Bar
        const totalHistoricalDebt = totalOutstanding + myRepaymentsSum;
        let progressPercent = 0;
        if (totalHistoricalDebt > 0) {
            progressPercent = Math.min(100, Math.round((myRepaymentsSum / totalHistoricalDebt) * 100));
        }
        
        const progressBar = document.getElementById("repaymentProgressBar");
        const progressText = document.getElementById("repaymentProgressText");
        if (progressBar && progressText) {
            progressBar.style.width = progressPercent + "%";
            progressText.innerText = progressPercent + "% Paid Off";
        }

        // Render targets inside payment selector input components
        const select = document.getElementById("payLoanSelect");
        if (select) {
            if (activeLoans.length === 0) {
                select.innerHTML = `<option value="">-- No active outstanding balances detected --</option>`;
            } else {
                select.innerHTML = activeLoans.map(l => `<option value="${l.id}">${l.id} - Remainder: Ksh ${l.amount}</option>`).join('');
            }
        }

        // Output dynamic historical lists onto live ledger component layout
        const tableBody = document.getElementById("memberReportTableBody");
        if (tableBody) {
            if (myLoans.length > 0) {
                tableBody.innerHTML = myLoans.map(l => `
                    <tr>
                        <td><code>${l.id}</code></td>
                        <td>Capital Loan request</td>
                        <td>Ksh ${parseFloat(l.amount).toLocaleString()}</td>
                        <td>${l.timestamp || new Date().toLocaleDateString()}</td>
                        <td><span style="color:${l.status === 'Active' ? 'var(--warning)' : 'var(--success)'}; font-weight:bold;">${l.status}</span></td>
                    </tr>
                `).join('');
            } else {
                tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;" class="text-muted">No historical transactions logged in current workspace session.</td></tr>`;
            }
        }
    }

    renderMemberMeetings();
    renderContributionsList();
    renderExpensesList();
    renderNotificationsList();

    const joinedEl = document.getElementById("tileMeetingsJoined");
    if (joinedEl) joinedEl.innerText = localStorage.getItem('metric_joined_meetings') || '0';
    
    const leftEl = document.getElementById("tileGroupsLeft");
    if (leftEl) leftEl.innerText = localStorage.getItem('metric_left_groups') || '0';
}

function renderContributionsList() {
    const list = document.getElementById('contributionsListBody');
    if (!list) return;
    const contributions = MEMBER_DB_STATE.contributions || [];
    if (contributions.length === 0) {
        list.innerHTML = `<tr><td colspan="4" style="text-align: center;" class="text-muted">No contributions recorded.</td></tr>`;
        return;
    }
    list.innerHTML = contributions.map(c => `
        <tr>
            <td>${new Date(c.created_at).toLocaleDateString()}</td>
            <td>Ksh ${parseFloat(c.amount).toLocaleString()}</td>
            <td>${c.payment_method}</td>
            <td><span class="text-success">Recorded</span></td>
        </tr>
    `).join('');
}

function renderExpensesList() {
    const list = document.getElementById('expensesListBody');
    if (!list) return;
    const expenses = MEMBER_DB_STATE.expenses || [];
    if (expenses.length === 0) {
        list.innerHTML = `<tr><td colspan="4" style="text-align: center;" class="text-muted">No expense claims submitted.</td></tr>`;
        return;
    }
    list.innerHTML = expenses.map(e => `
        <tr>
            <td>${new Date(e.created_at).toLocaleDateString()}</td>
            <td>${e.category}</td>
            <td>Ksh ${parseFloat(e.amount).toLocaleString()}</td>
            <td><span style="color:${e.status === 'Authorized' ? 'var(--success)' : (e.status === 'Rejected' ? 'var(--error)' : 'var(--warning)')}; font-weight:bold;">${e.status}</span></td>
        </tr>
    `).join('');
}

function renderNotificationsList() {
    const feed = document.getElementById("memberNotificationFeedExtended");
    if (!feed) return;
    const logs = MEMBER_DB_STATE.logs || [];
    if (logs.length === 0) {
        feed.innerHTML = `<div class="text-muted" style="text-align:center; padding:2rem;">No system notifications found.</div>`;
        return;
    }
    feed.innerHTML = logs.map(l => `
        <div class="notification-item">
            <p><i class="fas fa-info-circle text-primary"></i> ${l.message}</p>
            <span class="notification-time">${l.timestamp_str || new Date(l.created_at).toLocaleString()}</span>
        </div>
    `).join('');
}

function executeSystemReset() {
    if (confirm("Confirm complete structural diagnostic wipe of client local browser memory storage containers?")) {
        localStorage.clear();
        window.location.reload();
    }
}

/* ==========================================================================
 * NEW OPERATIONAL WORKFLOW MODALS (Payment & Expenses)
 * ========================================================================== */
function openPaymentModal() {
    document.getElementById('paymentModal').style.display = 'flex';
    document.getElementById('paymentForm').reset();
    document.getElementById('paymentMemberId').value = '';
    document.getElementById('memberSearchDropdown').style.display = 'none';
}

function openExpenseModal() {
    document.getElementById('expenseModal').style.display = 'flex';
    document.getElementById('expenseForm').reset();
}

async function filterMemberSearch(query) {
    const dropdown = document.getElementById('memberSearchDropdown');
    if (!query) {
        dropdown.style.display = 'none';
        return;
    }
    
    let pool = [];
    try {
        const data = await apiRequest('members/dashboard-pools', { method: 'GET' });
        pool = data.approved || [];
    } catch (e) {
        pool = JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS_POOL)) || [];
    }
    
    const matches = pool.filter(m => (m.full_name || m.name || '').toLowerCase().includes(query.toLowerCase()));
    
    if (matches.length === 0) {
        dropdown.innerHTML = '<div style="padding: 10px; color: #888;">No active members found</div>';
    } else {
        dropdown.innerHTML = matches.map(m => `<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid #333;" onclick="selectPaymentMember('${m.id}', '${(m.full_name || m.name || '').replace(/'/g, "\\'")}')">${m.full_name || m.name} (${m.email || ''})</div>`).join('');
    }
    dropdown.style.display = 'block';
}

function selectPaymentMember(id, name) {
    document.getElementById('paymentMemberId').value = id;
    document.getElementById('paymentMemberSearch').value = name;
    document.getElementById('memberSearchDropdown').style.display = 'none';
}

function validateExpenseReceipt(input) {
    if (input.files && input.files[0]) {
        if (input.files[0].size > 10 * 1024 * 1024) {
            alert('File size exceeds 10MB limit. Please choose a smaller file.');
            input.value = '';
        }
    }
}

async function submitPayment(event) {
    event.preventDefault();
    const memberId = document.getElementById('paymentMemberId').value;
    if (!memberId) return alert('Please select a valid member from the search dropdown.');
    
    const formData = new FormData();
    formData.append('member_id', memberId);
    formData.append('amount', document.getElementById('paymentAmount').value);
    formData.append('payment_method', document.getElementById('paymentMethod').value);
    
    const fileInput = document.getElementById('paymentReceipt');
    if (fileInput.files[0]) {
        formData.append('receipt', fileInput.files[0]);
    }
    
    try {
        const response = await fetch(API_BASE_URL + '/contributions/create', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (result.status === 'success') {
            alert('Payment recorded successfully and sent to Head Treasurer for reconciliation.');
            document.getElementById('paymentModal').style.display = 'none';
        } else {
            alert('Error: ' + result.message);
        }
    } catch (e) {
        alert('Failed to submit payment: ' + e.message);
    }
}

async function submitExpense(event) {
    event.preventDefault();
    const formData = new FormData();
    formData.append('member_id', CURRENT_SESSION ? CURRENT_SESSION.id : 1); // fallback if admin is testing
    formData.append('category', document.getElementById('expenseCategory').value);
    formData.append('amount', document.getElementById('expenseAmount').value);
    
    const fileInput = document.getElementById('expenseReceipt');
    if (fileInput.files[0]) {
        formData.append('receipt', fileInput.files[0]);
    }
    
    try {
        const response = await fetch(API_BASE_URL + '/expenses/create', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (result.status === 'success') {
            alert('Expense claim locked and routed to Head Treasurer authorization queue.');
            document.getElementById('expenseModal').style.display = 'none';
            await loadMemberPortalData();
            rebuildMetricsDashboard();
        } else {
            alert('Error: ' + result.message);
        }
    } catch (e) {
        alert('Failed to submit expense claim: ' + e.message);
    }
}

// Auto-refresh interval (every 30 seconds)
setInterval(async () => {
    if (CURRENT_SESSION && isApprovedMemberSession(CURRENT_SESSION)) {
        await loadMemberPortalData();
        rebuildMetricsDashboard();
    }
}, 30000);

// 
//  SESSION TIMEOUT (5 MINUTES INACTIVITY)
// 
(function() {
    let inactivityTimer;
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    function resetTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(logoutDueToInactivity, TIMEOUT_MS);
    }

    function logoutDueToInactivity() {
        alert("Session expired due to inactivity. You will be logged out securely.");
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = 'laddingpage.html';
    }

    // Use addEventListener to avoid overwriting existing handlers
    window.addEventListener('load', resetTimer);
    document.addEventListener('mousemove', resetTimer);
    document.addEventListener('keypress', resetTimer);
    document.addEventListener('click', resetTimer);
    document.addEventListener('scroll', resetTimer);
})();

/* =====================================================================
   ACTIVITIES SECTION FUNCTIONS
   ===================================================================== */

/**
 * Send an email to the admin using EmailJS.
 * Reads the admin email from the DOM (already populated by loadAdminContact).
 */
async function sendActivityEmailToAdmin(e) {
    e.preventDefault();
    const subject  = (document.getElementById('actEmailSubject')?.value || '').trim();
    const body     = (document.getElementById('actEmailBody')?.value   || '').trim();
    const statusEl = document.getElementById('actEmailStatus');
    const btn      = e.target.querySelector('button[type="submit"]');

    if (!subject || !body) { alert('Please fill in both subject and message.'); return; }

    // Resolve admin email from DOM (populated by loadAdminContact())
    const adminEmail = document.getElementById('adminEmailDisplay')?.textContent?.trim() || 'admin@chama.local';

    // Resolve sender info from session
    const session   = JSON.parse(sessionStorage.getItem('memberSession') || '{}');
    const fromName  = session.name  || 'Member';
    const fromEmail = session.email || 'member@chama.local';

    if (statusEl) { statusEl.style.color = '#aaa'; statusEl.textContent = 'Sending…'; }
    if (btn) btn.disabled = true;

    try {
        await emailjs.send('service_0gypwcr', 'template_ozc1j5q', {
            to_email : adminEmail,
            email    : adminEmail,
            from_name: fromName,
            from_email: fromEmail,
            subject  : subject,
            message  : body
        });
        if (statusEl) { statusEl.style.color = '#4caf50'; statusEl.textContent = '✔ Email sent successfully to admin!'; }
        e.target.reset();
    } catch (err) {
        console.error('Activity email error:', err);
        if (statusEl) { statusEl.style.color = '#f44336'; statusEl.textContent = '✘ Failed to send email. Please try Contact Admin instead.'; }
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Print the member's transaction ledger as a formatted printout.
 */
function printMemberLedger() {
    const session      = JSON.parse(sessionStorage.getItem('memberSession') || '{}');
    const memberName   = session.name  || 'Member';
    const memberId     = session.uid   || session.id || '—';
    const loans        = readStoredArray ? readStoredArray(STORAGE_KEYS.LOANS)        : [];
    const repayments   = readStoredArray ? readStoredArray(STORAGE_KEYS.REPAYMENTS)   : [];
    const allTx        = [...loans, ...repayments].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    const rows = allTx.map(tx => `
        <tr>
            <td>${tx.id || '—'}</td>
            <td>${tx.type || tx.classification || '—'}</td>
            <td>Ksh ${Number(tx.amount || 0).toLocaleString('en-KE', {minimumFractionDigits:2})}</td>
            <td>${tx.created_at ? new Date(tx.created_at).toLocaleString() : '—'}</td>
            <td>${tx.status || 'Logged'}</td>
        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#888;">No transactions recorded.</td></tr>';

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Member Ledger — ${memberName}</title>
    <style>body{font-family:Arial,sans-serif;padding:30px;color:#111}h1{color:#0077ff}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ccc;padding:8px 12px;text-align:left}th{background:#0077ff;color:#fff}tr:nth-child(even){background:#f5f5f5}@media print{body{padding:10px}}</style>
    </head><body>
    <h1>📄 Member Transaction Ledger</h1>
    <p><strong>Name:</strong> ${memberName} &nbsp;|&nbsp; <strong>ID:</strong> ${memberId} &nbsp;|&nbsp; <strong>Printed:</strong> ${new Date().toLocaleString()}</p>
    <table><thead><tr><th>ID</th><th>Type</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    <script>window.onload=()=>window.print();<\/script></body></html>`);
    win.document.close();
}

/**
 * Print the member's savings / contributions statement.
 */
function printMemberSavings() {
    const session     = JSON.parse(sessionStorage.getItem('memberSession') || '{}');
    const memberName  = session.name || 'Member';
    const memberId    = session.uid  || session.id || '—';
    const contribs    = readStoredArray ? readStoredArray(STORAGE_KEYS.CONTRIBUTIONS) : [];

    let totalSaved = 0;
    const rows = contribs.map(c => {
        totalSaved += Number(c.amount || 0);
        return `<tr>
            <td>${c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
            <td>Ksh ${Number(c.amount || 0).toLocaleString('en-KE', {minimumFractionDigits:2})}</td>
            <td>${c.method || c.payment_method || '—'}</td>
            <td>${c.status || 'Confirmed'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:#888;">No savings recorded.</td></tr>';

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Savings Statement — ${memberName}</title>
    <style>body{font-family:Arial,sans-serif;padding:30px;color:#111}h1{color:#4caf50}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ccc;padding:8px 12px;text-align:left}th{background:#4caf50;color:#fff}tr:nth-child(even){background:#f5f5f5}.total{font-size:1.2rem;font-weight:bold;margin-top:15px;color:#4caf50}@media print{body{padding:10px}}</style>
    </head><body>
    <h1>🐷 Savings & Contributions Statement</h1>
    <p><strong>Name:</strong> ${memberName} &nbsp;|&nbsp; <strong>ID:</strong> ${memberId} &nbsp;|&nbsp; <strong>Printed:</strong> ${new Date().toLocaleString()}</p>
    <table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="total">Total Saved: Ksh ${totalSaved.toLocaleString('en-KE', {minimumFractionDigits:2})}</p>
    <script>window.onload=()=>window.print();<\/script></body></html>`);
    win.document.close();
}

/**
 * Load meeting link posted by admin from localStorage into the Activities card.
 * Admin should save the meeting link to localStorage key 'adminMeetingLink'.
 */
function loadMeetingLink() {
    const link    = localStorage.getItem('adminMeetingLink') || '';
    const textEl  = document.getElementById('meetingLinkText');
    const joinBtn = document.getElementById('meetingJoinBtn');
    if (!textEl || !joinBtn) return;

    if (link && link.startsWith('http')) {
        textEl.textContent  = '✅ Meeting link is available! Click the button below to join.';
        textEl.style.color  = '#4caf50';
        joinBtn.href        = link;
        joinBtn.style.display = 'inline-block';
    } else {
        textEl.textContent   = 'No meeting link sent by admin yet. Check back later or contact your admin.';
        textEl.style.color   = '#aaa';
        joinBtn.style.display = 'none';
    }
}

// Auto-load meeting link whenever Activities section becomes visible
document.addEventListener('DOMContentLoaded', () => {
    // Piggyback on the existing nav click system
    document.querySelectorAll('.nav-item[data-target="meetingsSection"]').forEach(navEl => {
        navEl.addEventListener('click', () => setTimeout(loadMeetingLink, 100));
    });
    // Also run once on load in case the section is already active
    loadMeetingLink();
});
