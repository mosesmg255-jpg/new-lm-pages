/**
 * ==========================================================================
 * DATA STRUCTURE INITIALIZER MATRIX & STATE STORAGE
 * ==========================================================================
 */
const API_BASE_URL = window.__API_BASE__ || '/api'; 
const STORAGE_KEYS = {
    SESSION: 'memberSession',
    NOTIFICATIONS: 'memberNotifications',
    MEMBERS_POOL: 'membersPool',
    LOANS: 'memberLoans',
    REPAYMENTS: 'memberRepayments',
    CONTRIBUTIONS: 'memberContributions',
    ACTIVE_TAB: 'memberActiveTab',
    LIGHT_MODE: 'member_light_mode'
};

const WHATSAPP_CACHE_KEY = 'whatsappMessageCache';
const DEFAULT_WHATSAPP_MESSAGE = 'Hello Admin, I need assistance with my account. Please respond when available.';
let CURRENT_SESSION = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION)) || null;
let ADMIN_PHONE = '';
let WHATSAPP_MESSAGE_CACHE = localStorage.getItem(WHATSAPP_CACHE_KEY) || '';
let WHATSAPP_FRAME_LOADED = false;
let WHATSAPP_FRAME_TIMER = null;
let WHATSAPP_FAIL_TIMER = null;
let MEMBER_DB_STATE = { loans: [], repayments: [], meetings: [], contributions: [], expenses: [], logs: [] };

function togglePasswordVisibility(fieldId, iconEl) {
    const field = document.getElementById(fieldId);
    if (!field || !iconEl) return;
    if (field.type === 'password') {
        field.type = 'text';
        iconEl.className = 'fas fa-eye-slash';
    } else {
        field.type = 'password';
        iconEl.className = 'fas fa-eye';
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
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_TAB);
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
    localStorage.setItem(STORAGE_KEYS.LIGHT_MODE, isLight);
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
    if (localStorage.getItem(STORAGE_KEYS.LIGHT_MODE) === 'true') {
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
    if (isApprovedMemberSession(CURRENT_SESSION)) resetAndPoll();

    if (window.location.hash === '#access') {
        openAuthPortal(null, 'authSection');
    }

    // Check for password reset token in URL
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset_token');
    if (resetToken) {
        showRecoveryUI(new Event('load'));
        if (document.getElementById('recoveryStep1')) document.getElementById('recoveryStep1').style.display = 'none';
        if (document.getElementById('recoveryStep3')) document.getElementById('recoveryStep3').style.display = 'block';
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
            localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, targetSectionId);

            document.querySelectorAll(".content-section").forEach(sec => sec.style.display = "none");
            const targetSec = document.getElementById(targetSectionId);
            if (targetSec) targetSec.style.display = "block";

            if (targetSectionId === 'settingsSection') prefillProfileForm();
            if (targetSectionId === 'notificationsSection') refreshNotificationsFeed();

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
    const identity = document.getElementById("loginIdentity")?.value.trim();
    const pass = document.getElementById("loginPassword")?.value;

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
        localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, 'dashboardSection');
        activateNavTab('dashboardSection');
        resetAndPoll();
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
    if (document.getElementById("recoveryModal")) document.getElementById("recoveryModal").style.display = 'block';
    
    // Reset steps
    if (document.getElementById("recoveryStep1")) document.getElementById("recoveryStep1").style.display = 'block';
    if (document.getElementById("recoveryStep3")) document.getElementById("recoveryStep3").style.display = 'none';
    if (document.getElementById("recoveryEmail")) document.getElementById("recoveryEmail").value = "";
    if (document.getElementById("recoveryNewPassword")) document.getElementById("recoveryNewPassword").value = "";
}

function hideRecoveryUI() {
    // Show standard auth cards
    Array.from(document.getElementById("authSection").children[0].children).forEach(el => {
        if(el.id !== 'recoveryModal') el.style.display = 'block';
    });
    if (document.getElementById("recoveryModal")) document.getElementById("recoveryModal").style.display = 'none';
    
    // Clear URL if token was present
    if (window.location.search.includes('reset_token')) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

async function requestPasswordReset(event) {
    event.preventDefault();
    const email = document.getElementById("recoveryEmail")?.value.trim();
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
                if (document.getElementById('simulatedEmailBox')) document.getElementById('simulatedEmailBox').style.display = 'block';
                document.getElementById('simulatedEmailBox').innerHTML = '<strong>Email Dispatched successfully!</strong> Please check your inbox and spam folders.';
            }).catch(err => {
                console.error("EmailJS Error:", err);
                if (document.getElementById("simulatedEmailBox")) document.getElementById("simulatedEmailBox").style.display = 'block';
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
    const newPass = document.getElementById("recoveryNewPassword")?.value;
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
    const name = document.getElementById("regName")?.value.trim();
    const email = document.getElementById("regEmail")?.value.trim();
    const phone = document.getElementById("regPhone")?.value.trim();
    const password = document.getElementById("regPassword")?.value;
    const pin = document.getElementById("regPin")?.value;

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
        restoreActiveTab();
    }
}

function activateNavTab(sectionId) {
    document.querySelectorAll(".content-section").forEach(sec => sec.style.display = "none");
    const targetSec = document.getElementById(sectionId);
    if (targetSec) targetSec.style.display = "block";
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    const navItem = document.querySelector(`.nav-item[data-target="${sectionId}"]`);
    if (navItem) navItem.classList.add("active");
}

function restoreActiveTab() {
    if (!isApprovedMemberSession(CURRENT_SESSION)) return;
    const savedTab = localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB);
    if (!savedTab || savedTab === 'authSection' || savedTab === '') return;
    const targetSec = document.getElementById(savedTab);
    if (!targetSec) return;
    document.querySelectorAll(".content-section").forEach(sec => sec.style.display = "none");
    targetSec.style.display = "block";
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    const navItem = document.querySelector(`.nav-item[data-target="${savedTab}"]`);
    if (navItem) navItem.classList.add("active");
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
            }
        }
    });
}

function logoutMember() {
    stopLiveUpdatePoller();
    // Mark session as timed out
    localStorage.setItem('sessionTimedOut', 'true');
    localStorage.setItem('sessionTimeoutTime', Date.now().toString());
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_TAB);
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
        <button onclick="window.location.href='landingpage.html'" style="
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
        stopLiveUpdatePoller();
        localStorage.removeItem(STORAGE_KEYS.SESSION);
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_TAB);
        localStorage.removeItem('disableBlurEffect');
        localStorage.removeItem('memberAccessGranted');
        CURRENT_SESSION = null;
        window.location.href = 'landingpage.html';
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
    if (!CURRENT_SESSION || !CURRENT_SESSION.id) return;
    apiRequest('live-updates/log', {
        method: 'POST',
        body: JSON.stringify({ event_type: category || 'system', event_body: msg })
    }).catch(() => {});
}

function postApprovalRequestToAdmin(msg, category) {
    if (!CURRENT_SESSION || !CURRENT_SESSION.id) return;
    apiRequest('live-updates/log', {
        method: 'POST',
        body: JSON.stringify({ event_type: category || 'activity', event_body: msg })
    }).catch(() => {});
}

async function apiRequest(path, options = {}) {
    const url = `${API_BASE_URL}/${path}`;
    const isFormData = options.body instanceof FormData;
    const headers = {};
    if (!isFormData) {
        headers['Content-Type'] = 'application/json';
    }
    if (CURRENT_SESSION && CURRENT_SESSION.token) {
        headers['Authorization'] = 'Bearer ' + CURRENT_SESSION.token;
    }

    const response = await fetch(url, {
        headers,
        credentials: 'same-origin',
        ...options
    });
    let data;
    try {
        data = await response.json();
    } catch (e) {
        throw new Error(`Invalid JSON response from ${path}`);
    }
    if (!response.ok) {
        throw new Error(data.message || 'Back-end communication failure.');
    }
    return data.data ?? data;
}

async function apiGetMemberById(id) {
    return await apiRequest(`members/view?id=${id}`, { method: 'GET' });
}

async function loadAdminPhoneNumber() {
    if (!CURRENT_SESSION || !CURRENT_SESSION.email) {
        console.warn('No active session to load admin contact');
        return;
    }
    
    function setAdminDisplay(n, p, em) {
        const contactHint = document.getElementById('contactAdminHint');
        const contactName = document.getElementById('contactAdminName');
        const contactPhone = document.getElementById('contactAdminPhone');
        const contactEmail = document.getElementById('contactAdminEmail');
        const dashName = document.getElementById('adminNameDisplay');
        const dashPhone = document.getElementById('adminPhoneDisplay');
        const dashEmail = document.getElementById('adminEmailDisplay');
        const dashHint = document.getElementById('adminContactHint');
        const sidebarPhone = document.getElementById('sidebarPhone');
        const sidebarPhoneLink = document.getElementById('sidebarPhoneLink');
        const sidebarHandler = document.getElementById('sidebarHandler');
        if (contactHint) contactHint.textContent = (n || 'System Admin') + ' is your assigned officer';
        if (contactName) contactName.textContent = n || 'System Admin';
        if (contactPhone) contactPhone.textContent = p || 'N/A';
        if (contactEmail) contactEmail.textContent = em || 'N/A';
        if (dashName) dashName.textContent = n || 'System Admin';
        if (dashPhone) dashPhone.textContent = p || 'N/A';
        if (dashEmail) dashEmail.textContent = em || 'N/A';
        if (dashHint) dashHint.textContent = (n || 'System Admin') + ' is your assigned officer';
        if (sidebarPhone) sidebarPhone.textContent = p || 'N/A';
        if (sidebarPhoneLink && p) sidebarPhoneLink.href = 'tel:' + p;
        if (sidebarHandler) sidebarHandler.textContent = n || 'System Admin';
        if (p) { ADMIN_PHONE = String(p).trim(); localStorage.setItem('currentAdminPhone', ADMIN_PHONE); }
    }

    try {
        const raw = await apiRequest('members/approver-contact?email=' + encodeURIComponent(CURRENT_SESSION.email), { method: 'GET' });
        const approverData = raw.data || raw;
        
        const resolvedName = approverData.admin_name || 'System Admin';
        const resolvedPhone = approverData.admin_phone || '';
        const resolvedEmail = approverData.admin_email || '';

        setAdminDisplay(resolvedName, resolvedPhone, resolvedEmail);
    } catch (err) {
        console.warn('Unable to load admin contact, trying fallback...', err);
        try {
            const raw2 = await apiRequest('members/my-admin-info', { method: 'GET' });
            const d2 = raw2.data || raw2;
            if (d2 && (d2.admin_name || d2.admin_phone)) {
                setAdminDisplay(d2.admin_name || 'System Admin', d2.admin_phone || '', d2.admin_email || '');
                return;
            }
        } catch (_) {}
        const resolvedName = (CURRENT_SESSION && CURRENT_SESSION.admin_name) ? CURRENT_SESSION.admin_name : 'System Admin';
        const resolvedPhone = (CURRENT_SESSION && CURRENT_SESSION.admin_phone) ? CURRENT_SESSION.admin_phone : (localStorage.getItem('currentAdminPhone') || 'N/A');
        const resolvedEmail = (CURRENT_SESSION && CURRENT_SESSION.admin_email) ? CURRENT_SESSION.admin_email : 'N/A';
        setAdminDisplay(resolvedName, resolvedPhone, resolvedEmail);
    }
}

function renderNotificationsFeed() {
    const feed = document.getElementById("memberNotificationFeedExtended");
    if (!feed) return;

    const logs = MEMBER_DB_STATE.logs || [];
    if (logs.length === 0) {
        feed.innerHTML = `<div class="text-muted" style="text-align:center; padding:2rem;">No activity recorded yet.</div>`;
        return;
    }

    const filterEl = document.getElementById('notificationTypeFilter');
    const filterVal = filterEl ? filterEl.value : 'all';

    const typeIconMap = {
        'loan': { icon: 'fa-hand-holding-usd', color: '#3b82f6' },
        'contribution': { icon: 'fa-piggy-bank', color: '#4caf50' },
        'expense': { icon: 'fa-file-invoice', color: '#f59e0b' },
        'security': { icon: 'fa-shield-alt', color: '#ef4444' },
        'system': { icon: 'fa-cog', color: '#8b5cf6' },
        'meeting': { icon: 'fa-video', color: '#06b6d4' },
        'approval': { icon: 'fa-check-circle', color: '#10b981' }
    };

    const filtered = filterVal === 'all' ? logs : logs.filter(l => {
        const msg = (l.message || '').toLowerCase();
        const type = (l.type || '').toLowerCase();
        if (filterVal === 'loan') return msg.includes('loan') || msg.includes('repay') || type === 'loan';
        if (filterVal === 'contribution') return msg.includes('contribut') || msg.includes('payment') || type === 'contribution';
        if (filterVal === 'expense') return msg.includes('expense') || type === 'expense';
        if (filterVal === 'security') return msg.includes('security') || msg.includes('login') || type === 'security';
        if (filterVal === 'system') return msg.includes('system') || type === 'system';
        return true;
    });

    if (filtered.length === 0) {
        feed.innerHTML = `<div class="text-muted" style="text-align:center; padding:2rem;">No ${filterVal === 'all' ? '' : filterVal + ' '}notifications found.</div>`;
        return;
    }

    feed.innerHTML = filtered.slice(0, 50).map(l => {
        const msg = (l.message || '').toLowerCase();
        let matchedType = 'system';
        if (msg.includes('loan') || msg.includes('repay') || (l.type || '').toLowerCase() === 'loan') matchedType = 'loan';
        else if (msg.includes('contribut') || msg.includes('payment') || (l.type || '').toLowerCase() === 'contribution') matchedType = 'contribution';
        else if (msg.includes('expense') || (l.type || '').toLowerCase() === 'expense') matchedType = 'expense';
        else if (msg.includes('security') || msg.includes('login') || (l.type || '').toLowerCase() === 'security') matchedType = 'security';
        else if (msg.includes('meeting') || (l.type || '').toLowerCase() === 'meeting') matchedType = 'meeting';
        else if (msg.includes('approval') || (l.type || '').toLowerCase() === 'approval') matchedType = 'approval';
        const meta = typeIconMap[matchedType] || typeIconMap['system'];
        const timestamp = l.timestamp_str || (l.created_at ? new Date(l.created_at).toLocaleString() : '');
        return `<div class="notification-item" style="border-left: 3px solid ${meta.color}; padding-left: 12px; margin-bottom: 10px;">
            <p style="margin:0;"><i class="fas ${meta.icon}" style="color:${meta.color}; margin-right:6px;"></i> ${l.message}</p>
            <span class="notification-time" style="font-size: 0.8rem; color: #888;">${timestamp}</span>
        </div>`;
    }).join('');
}

async function refreshNotificationsFeed() {
    if (!CURRENT_SESSION || !CURRENT_SESSION.id || !isApprovedMemberSession(CURRENT_SESSION)) {
        renderNotificationsFeed();
        return;
    }
    try {
        const [systemLogsRaw, liveLogsRaw] = await Promise.allSettled([
            apiRequest('logs/member-activity/' + encodeURIComponent(CURRENT_SESSION.id), { method: 'GET' }),
            apiRequest('live-updates/member', { method: 'GET' })
        ]);
        const sLogs = (systemLogsRaw.status === 'fulfilled' ? systemLogsRaw.value : []).map(l => ({ message: l.message || l.event_body, type: l.type || 'system', created_at: l.created_at, timestamp_str: l.timestamp_str }));
        const lLogs = (liveLogsRaw.status === 'fulfilled' ? liveLogsRaw.value : []).map(l => ({ message: l.event_body, type: l.event_type, created_at: l.created_at }));
        MEMBER_DB_STATE.logs = [...sLogs, ...lLogs].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } catch (_) {}
    renderNotificationsFeed();
}

function synchronizeNotificationStreams() { refreshNotificationsFeed(); }

let _liveUpdatePollTimer = null;
let _lastKnownLogCount = 0;

function startLiveUpdatePoller() {
    if (_liveUpdatePollTimer) return;
    _liveUpdatePollTimer = setInterval(async () => {
        if (!CURRENT_SESSION || !CURRENT_SESSION.id || !isApprovedMemberSession(CURRENT_SESSION)) return;
        try {
            const raw = await apiRequest('live-updates/member', { method: 'GET' });
            const rows = Array.isArray(raw) ? raw : [];
            if (rows.length > _lastKnownLogCount && _lastKnownLogCount > 0) {
                MEMBER_DB_STATE.logs = rows.map(l => ({ message: l.event_body, type: l.event_type, created_at: l.created_at }));
                renderNotificationsFeed();
                const badge = document.getElementById('notificationBadge');
                if (badge) {
                    const extra = rows.length - _lastKnownLogCount;
                    badge.textContent = extra;
                    badge.style.display = 'flex';
                }
            }
            _lastKnownLogCount = rows.length;
        } catch (_) {}
    }, 8000);
    _liveUpdatePollTimer.unref && _liveUpdatePollTimer.unref();
}

function stopLiveUpdatePoller() {
    if (_liveUpdatePollTimer) { clearInterval(_liveUpdatePollTimer); _liveUpdatePollTimer = null; }
}

function resetAndPoll() {
    _lastKnownLogCount = 0;
    startLiveUpdatePoller();
}

/**
 * ==========================================================================
 * TRANSACTIONAL PIN VERIFICATION
 * ==========================================================================
 */
let pendingTransactionCallback = null;

function promptForTransactionPin(callback) {
    pendingTransactionCallback = callback;
    if (document.getElementById("transactionPinInput")) document.getElementById("transactionPinInput").value = '';
    if (document.getElementById("securityPinModal")) document.getElementById("securityPinModal").style.display = 'flex';
}

function cancelTransactionPin() {
    pendingTransactionCallback = null;
    if (document.getElementById("securityPinModal")) document.getElementById("securityPinModal").style.display = 'none';
}

function confirmTransactionPin() {
    const pin = document.getElementById("transactionPinInput")?.value;
    if (pin.length !== 4) {
        alert("Please enter a valid 4-digit PIN.");
        return;
    }
    if (document.getElementById("securityPinModal")) document.getElementById("securityPinModal").style.display = 'none';
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

    const amt = parseFloat(document.getElementById("loanAmount")?.value);
    const dur = parseInt(document.getElementById("loanDuration")?.value);

    promptForTransactionPin(async (pin) => {

        try {
            const payload = {
                member_id: CURRENT_SESSION.id,
                amount: amt,
                duration: dur,
                interest_rate: parseFloat(document.getElementById("loanInterest")?.value) || 12,
                pin: pin
            };

            // Post straight to backend live router channel
            const result = await apiRequest('loans/create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

        postNotificationToChannels(`Loan Application Confirmed: Loan ID ${result.id || ''} for Ksh ${amt.toFixed(2)} is now live.`, 'loan');
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
    const targetId = document.getElementById("payLoanSelect")?.value;
    const payVal = parseFloat(document.getElementById("payAmount")?.value);
    const method = document.querySelector('input[name="payMethod"]:checked').value;

    if (!targetId || !CURRENT_SESSION) return;

    if (!confirm(`Are you sure you want to process a repayment of Ksh ${payVal} via ${method}? This action cannot be reversed.`)) {
        return;
    }

    promptForTransactionPin(async (pin) => {
        try {
            let dbLoanId = targetId;
            if (MEMBER_DB_STATE.loans && MEMBER_DB_STATE.loans.length) {
                const liveLoan = MEMBER_DB_STATE.loans.find(l => String(l.id) === String(targetId) || String(l.id) === String(targetId.replace('LNK-', '')));
                if (liveLoan) dbLoanId = liveLoan.id;
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

        postNotificationToChannels(`Remittance Confirmed: Installment of Ksh ${payVal} applied via ${method}.`, 'loan');
        document.getElementById("payLoanForm").reset();
        
        await loadMemberPortalData();
        rebuildMetricsDashboard();
        alert("Repayment processing approved and stored inside system ledger.");
    } catch (error) {
        alert(error.message || "Repayment rejected by database verification.");
    }
    });
}

function postNotificationToChannels(msg, type) {
    if (!CURRENT_SESSION || !CURRENT_SESSION.id) return;
    apiRequest('live-updates/log', {
        method: 'POST',
        body: JSON.stringify({ event_type: type || 'notification', event_body: msg })
    }).catch(() => {});
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
        // Try backend AI proxy first (only send message, not session token)
        const resp = await fetch(API_BASE_URL + '/ai/assistant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
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
        { key: 'logs', url: 'logs/member-activity/' + memberId },
        { key: 'liveUpdates', url: 'live-updates/member' }
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

        const systemLogs = (next.logs || []).map(l => ({ message: l.message || l.event_body, type: l.type || l.category || 'system', created_at: l.created_at, timestamp_str: l.timestamp_str }));
        const liveLogs = (next.liveUpdates || []).map(l => ({ message: l.event_body, type: l.event_type, created_at: l.created_at }));
        next.logs = [...systemLogs, ...liveLogs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (error) {
        console.error('[loadMemberPortalData] global fetch error', error);
    }
    
    MEMBER_DB_STATE = next;
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

/**
 * ==========================================================================
 * DYNAMIC METRICS REBUILDER & LEDGER COMPILER
 * ==========================================================================
 */
function rebuildMetricsDashboard() {
    const ledger = (MEMBER_DB_STATE.loans || []).map(memberLoanViewModel);
    const repaymentsList = MEMBER_DB_STATE.repayments || [];
    const contributionsList = MEMBER_DB_STATE.contributions || [];
    const expensesList = MEMBER_DB_STATE.expenses || [];
    
    const totalMembersEl = document.getElementById("tileTotalMembers");
    if (totalMembersEl) totalMembersEl.innerText = (MEMBER_DB_STATE.loans || []).length > 0 ? 1 : 0;

    if (CURRENT_SESSION) {
        const myLoans = ledger.filter(l => l.memberId === CURRENT_SESSION.id);
        const activeLoans = myLoans.filter(l => l.status === 'Active');
        
        const totalOutstanding = myLoans.reduce((sum, l) => sum + (l.status === 'Active' ? parseFloat(l.amount) : 0), 0);
        const takenTile = document.getElementById("tileLoansTaken");
        if (takenTile) takenTile.innerText = `Ksh ${totalOutstanding.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        
        const activeTile = document.getElementById("tileActiveLoans");
        if (activeTile) activeTile.innerText = activeLoans.length;

        const myRepaymentsSum = repaymentsList
            .filter(r => String(r.member_id || '') === String(CURRENT_SESSION.id) || r.member_name === (CURRENT_SESSION.full_name || CURRENT_SESSION.name))
            .reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
            
        const paidTile = document.getElementById("tileLoansPaid");
        if (paidTile) paidTile.innerText = `Ksh ${myRepaymentsSum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

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

        const select = document.getElementById("payLoanSelect");
        if (select) {
            if (activeLoans.length === 0) {
                select.innerHTML = `<option value="">-- No active outstanding balances detected --</option>`;
            } else {
                select.innerHTML = activeLoans.map(l => `<option value="${l.db_id || l.id}" data-balance="${l.amount}">${l.id} - Outstanding: Ksh ${parseFloat(l.amount).toLocaleString(undefined, {minimumFractionDigits:2})}</option>`).join('');
            }
        }
        const balanceHint = document.getElementById('payLoanBalanceHint');
        if (balanceHint) {
            if (activeLoans.length > 0) {
                const totalOwed = activeLoans.reduce((s, l) => s + parseFloat(l.amount || 0), 0);
                balanceHint.textContent = `Total outstanding: Ksh ${totalOwed.toLocaleString(undefined, {minimumFractionDigits:2})} — enter any amount from Ksh 1 upward`;
            } else {
                balanceHint.textContent = 'No active loans to repay.';
            }
        }

        const tableBody = document.getElementById("memberReportTableBody");
        if (tableBody) {
            const allTx = [];
            myLoans.forEach(l => allTx.push({ id: l.id, type: 'Loan', amount: l.amount, date: l.timestamp || new Date().toLocaleDateString(), status: l.status }));
            repaymentsList.filter(r => String(r.member_id || '') === String(CURRENT_SESSION.id)).forEach(r => allTx.push({ id: r.id ? 'RPY-' + r.id : 'RPY', type: 'Repayment', amount: r.amount, date: r.created_at ? new Date(r.created_at).toLocaleDateString() : '', status: 'Completed' }));
            contributionsList.filter(c => String(c.member_id || '') === String(CURRENT_SESSION.id)).forEach(c => allTx.push({ id: c.id ? 'CBN-' + c.id : 'CBN', type: 'Contribution', amount: c.amount, date: c.created_at ? new Date(c.created_at).toLocaleDateString() : '', status: 'Confirmed' }));
            expensesList.filter(e => String(e.member_id || '') === String(CURRENT_SESSION.id)).forEach(e => allTx.push({ id: e.id ? 'EXP-' + e.id : 'EXP', type: 'Expense', amount: e.amount, date: e.created_at ? new Date(e.created_at).toLocaleDateString() : '', status: e.status || 'Pending' }));

            allTx.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

            const filterVal = document.getElementById('ledgerTypeFilter') ? document.getElementById('ledgerTypeFilter')?.value : 'all';
            const filtered = filterVal === 'all' ? allTx : allTx.filter(tx => tx.type === filterVal);

            const totalIn = allTx.filter(tx => tx.type === 'Contribution').reduce((s, tx) => s + parseFloat(tx.amount || 0), 0);
            const totalOut = allTx.filter(tx => tx.type === 'Expense').reduce((s, tx) => s + parseFloat(tx.amount || 0), 0);
            const totalLoan = allTx.filter(tx => tx.type === 'Loan').reduce((s, tx) => s + parseFloat(tx.amount || 0), 0);
            const totalRepaid = allTx.filter(tx => tx.type === 'Repayment').reduce((s, tx) => s + parseFloat(tx.amount || 0), 0);

            const summaryEl = document.getElementById('ledgerSummaryCards');
            if (summaryEl) {
                summaryEl.innerHTML = `
                    <div style="background: rgba(76,175,80,0.15); padding: 12px; border-radius: 8px; border-left: 3px solid #4caf50;">
                        <div style="font-size: 0.75rem; color: #888;">Contributions</div>
                        <div style="font-size: 1.1rem; font-weight: bold; color: #4caf50;">Ksh ${totalIn.toLocaleString()}</div>
                    </div>
                    <div style="background: rgba(59,130,246,0.15); padding: 12px; border-radius: 8px; border-left: 3px solid #3b82f6;">
                        <div style="font-size: 0.75rem; color: #888;">Loans Taken</div>
                        <div style="font-size: 1.1rem; font-weight: bold; color: #3b82f6;">Ksh ${totalLoan.toLocaleString()}</div>
                    </div>
                    <div style="background: rgba(16,185,129,0.15); padding: 12px; border-radius: 8px; border-left: 3px solid #10b981;">
                        <div style="font-size: 0.75rem; color: #888;">Repaid</div>
                        <div style="font-size: 1.1rem; font-weight: bold; color: #10b981;">Ksh ${totalRepaid.toLocaleString()}</div>
                    </div>
                    <div style="background: rgba(245,158,11,0.15); padding: 12px; border-radius: 8px; border-left: 3px solid #f59e0b;">
                        <div style="font-size: 0.75rem; color: #888;">Expenses</div>
                        <div style="font-size: 1.1rem; font-weight: bold; color: #f59e0b;">Ksh ${totalOut.toLocaleString()}</div>
                    </div>
                `;
            }

            if (filtered.length > 0) {
                let runningBalance = 0;
                const rows = filtered.map(tx => {
                    let displayBalance = 0;
                    if (tx.type === 'Contribution') runningBalance += parseFloat(tx.amount || 0);
                    else if (tx.type === 'Repayment') runningBalance += parseFloat(tx.amount || 0);
                    else if (tx.type === 'Expense') runningBalance -= parseFloat(tx.amount || 0);
                    else if (tx.type === 'Loan') runningBalance += parseFloat(tx.amount || 0);

                    // For loans and repayments, calculate specific remaining loan balance dynamically
                    if (tx.type === 'Loan' || tx.type === 'Repayment') {
                        const totalTaken = myLoans.reduce((sum, l) => sum + parseFloat(l.amount), 0);
                        const totalPaid = repaymentsList.filter(r => String(r.member_id) === String(CURRENT_SESSION.id)).reduce((sum, r) => sum + parseFloat(r.amount), 0);
                        displayBalance = totalTaken - totalPaid;
                    } else {
                        displayBalance = runningBalance;
                    }

                    const statusColor = (tx.status === 'Active' || tx.status === 'Completed' || tx.status === 'Confirmed' || tx.status === 'Settled') ? 'var(--success)' : 'var(--warning)';
                    return `<tr>
                        <td><code>${tx.id}</code></td>
                        <td>${tx.type}</td>
                        <td>Ksh ${parseFloat(tx.amount).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                        <td>${tx.date}</td>
                        <td><span style="color:${statusColor}; font-weight:bold;">${tx.status}</span></td>
                        <td style="font-weight:500; color: ${displayBalance >= 0 ? 'var(--success)' : 'var(--error)'};">Ksh ${displayBalance.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    </tr>`;
                }).join('');
                tableBody.innerHTML = rows;
            } else {
                tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center;" class="text-muted">No transactions found${filterVal !== 'all' ? ' for this type' : ''}.</td></tr>`;
            }
        }
    }

    renderContributionsList();
    renderExpensesList();
    renderNotificationsFeed();

    const joinedEl = document.getElementById("tileMeetingsJoined");
    if (joinedEl) joinedEl.innerText = (MEMBER_DB_STATE.meetings || []).length;
    
    const leftEl = document.getElementById("tileGroupsLeft");
    if (leftEl) leftEl.innerText = '0';
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

function executeSystemReset() {
    if (confirm("Confirm complete structural diagnostic wipe of client local browser memory storage containers?\n\nNote: Your session will be preserved. Only cached data will be cleared.")) {
        // Targeted removal - preserve session so member stays logged in
        Object.values(STORAGE_KEYS).forEach(k => {
            if (k !== STORAGE_KEYS.SESSION) localStorage.removeItem(k);
        });
        localStorage.removeItem('disableBlurEffect');
        localStorage.removeItem('memberAccessGranted');
        localStorage.removeItem('currentAdminPhone');
        localStorage.removeItem(WHATSAPP_CACHE_KEY);
        localStorage.removeItem('sessionTimedOut');
        localStorage.removeItem('sessionTimeoutTime');
        window.location.reload();
    }
}

async function updateMemberCredentials(event) {
    event.preventDefault();
    const currentPassword = document.getElementById('currentPassword')?.value;
    const newPassword = document.getElementById('newPassword')?.value;
    const newPin = document.getElementById('newPin')?.value;
    const statusEl = document.getElementById('credUpdateStatus');

    if (!currentPassword) {
        statusEl.innerHTML = '<span style="color: #f44336;">Please enter your current password.</span>';
        return;
    }
    if (!newPassword && !newPin) {
        statusEl.innerHTML = '<span style="color: #f44336;">Please enter a new password or new PIN.</span>';
        return;
    }
    if (newPassword && newPassword.length < 6) {
        statusEl.innerHTML = '<span style="color: #f44336;">New password must be at least 6 characters.</span>';
        return;
    }
    if (newPin && (newPin.length !== 4 || !/^\d{4}$/.test(newPin))) {
        statusEl.innerHTML = '<span style="color: #f44336;">PIN must be exactly 4 digits.</span>';
        return;
    }

    const session = CURRENT_SESSION;
    if (!session || !session.id) {
        statusEl.innerHTML = '<span style="color: #f44336;">No active session. Please log in again.</span>';
        return;
    }

    statusEl.innerHTML = '<span style="color: #ff9800;">Updating...</span>';

    try {
        const result = await apiRequest('members/update-password', {
            method: 'POST',
            body: JSON.stringify({
                member_id: session.id,
                current_password: currentPassword,
                new_password: newPassword || undefined,
                new_pin: newPin || undefined
            })
        });

        if (result.success) {
            statusEl.innerHTML = '<span style="color: #4caf50;">Credentials updated successfully!</span>';
            postNotificationToChannels('Security credentials updated: password and/or PIN changed.', 'security');
            document.getElementById('updateCredentialsForm').reset();
        } else {
            statusEl.innerHTML = '<span style="color: #f44336;">' + (result.message || 'Update failed') + '</span>';
        }
    } catch (err) {
        statusEl.innerHTML = '<span style="color: #f44336;">' + (err.message || 'Network error') + '</span>';
    }
}

async function updateMemberProfile(event) {
    event.preventDefault();
    const name = document.getElementById('profileName')?.value.trim();
    const phone = document.getElementById('profilePhone')?.value.trim();
    const email = document.getElementById('profileEmail')?.value.trim();
    const statusEl = document.getElementById('profileUpdateStatus');

    if (!name && !phone && !email) {
        statusEl.innerHTML = '<span style="color: #f44336;">Please fill in at least one field to update.</span>';
        return;
    }

    const session = CURRENT_SESSION;
    if (!session || !session.id) {
        statusEl.innerHTML = '<span style="color: #f44336;">No active session. Please log in again.</span>';
        return;
    }

    statusEl.innerHTML = '<span style="color: #ff9800;">Updating...</span>';

    try {
        const result = await apiRequest('members/update-profile', {
            method: 'POST',
            body: JSON.stringify({
                member_id: session.id,
                full_name: name || undefined,
                phone: phone || undefined,
                email: email || undefined
            })
        });

        if (result.success) {
            statusEl.innerHTML = '<span style="color: #4caf50;">Profile updated successfully!</span>';
            postNotificationToChannels(`Profile updated: ${name || 'name'}, ${phone || 'phone'}.`, 'profile');
            if (result.member) {
                CURRENT_SESSION = { ...CURRENT_SESSION, ...result.member };
                localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(CURRENT_SESSION));
                const badgeUsername = document.getElementById('badgeUsername');
                if (badgeUsername) badgeUsername.innerText = CURRENT_SESSION.full_name || CURRENT_SESSION.name || 'Member';
            }
        } else {
            statusEl.innerHTML = '<span style="color: #f44336;">' + (result.message || 'Update failed') + '</span>';
        }
    } catch (err) {
        statusEl.innerHTML = '<span style="color: #f44336;">' + (err.message || 'Network error') + '</span>';
    }
}

function prefillProfileForm() {
    if (!CURRENT_SESSION) return;
    const nameEl = document.getElementById('profileName');
    const phoneEl = document.getElementById('profilePhone');
    const emailEl = document.getElementById('profileEmail');
    if (nameEl) nameEl.value = CURRENT_SESSION.full_name || CURRENT_SESSION.name || '';
    if (phoneEl) phoneEl.value = CURRENT_SESSION.phone || '';
    if (emailEl) emailEl.value = CURRENT_SESSION.email || '';

    const sName = document.getElementById('settingsProfileName');
    const sPhone = document.getElementById('settingsProfilePhone');
    const sEmail = document.getElementById('settingsProfileEmail');
    const sStatus = document.getElementById('settingsProfileStatus');
    const sId = document.getElementById('settingsProfileId');
    const sDate = document.getElementById('settingsProfileDate');
    if (sName) sName.textContent = CURRENT_SESSION.full_name || CURRENT_SESSION.name || '-';
    if (sPhone) sPhone.textContent = CURRENT_SESSION.phone || '-';
    if (sEmail) sEmail.textContent = CURRENT_SESSION.email || '-';
    if (sStatus) {
        const statusStr = String(CURRENT_SESSION.status || '').toLowerCase();
        sStatus.textContent = statusStr.charAt(0).toUpperCase() + statusStr.slice(1) || '-';
        sStatus.style.color = (statusStr === 'approved' || statusStr === 'active') ? 'var(--success)' : 'var(--warning)';
    }
    if (sId) sId.textContent = CURRENT_SESSION.id || '-';
    if (sDate) sDate.textContent = CURRENT_SESSION.created_at ? new Date(CURRENT_SESSION.created_at).toLocaleDateString() : '-';
}

/* ==========================================================================
   CUSTOM DROPDOWN TOGGLE FUNCTIONS
   ========================================================================== */
function toggleCustomPaymentMethod(val) {
    const custom = document.getElementById('paymentMethodCustom');
    if (custom) custom.style.display = val === '__other__' ? 'block' : 'none';
}

function toggleCustomExpenseCategory(val) {
    const custom = document.getElementById('expenseCategoryCustom');
    if (custom) custom.style.display = val === 'Other' ? 'block' : 'none';
}

/* ==========================================================================
 * NEW OPERATIONAL WORKFLOW MODALS (Payment & Expenses)
 * ========================================================================== */
function openPaymentModal() {
    if (document.getElementById('paymentModal')) document.getElementById('paymentModal').style.display = 'flex';
    document.getElementById('paymentForm').reset();
    if (document.getElementById('memberSearchDropdown')) document.getElementById('memberSearchDropdown').style.display = 'none';
    const customMethod = document.getElementById('paymentMethodCustom');
    if (customMethod) { customMethod.style.display = 'none'; customMethod.value = ''; }
    
    if (CURRENT_SESSION) {
        if (document.getElementById('paymentMemberId')) document.getElementById('paymentMemberId').value = CURRENT_SESSION.id;
        if (document.getElementById('paymentMemberSearch')) document.getElementById('paymentMemberSearch').value = CURRENT_SESSION.full_name || CURRENT_SESSION.name || '';
    } else {
        if (document.getElementById('paymentMemberId')) document.getElementById('paymentMemberId').value = '';
        if (document.getElementById('paymentMemberSearch')) document.getElementById('paymentMemberSearch').value = '';
    }
}

function openExpenseModal() {
    if (document.getElementById('expenseModal')) document.getElementById('expenseModal').style.display = 'flex';
    document.getElementById('expenseForm').reset();
    const customCat = document.getElementById('expenseCategoryCustom');
    if (customCat) { customCat.style.display = 'none'; customCat.value = ''; }
}

async function fetchAllApprovedMembers() {
    // dashboard-pools is admin-only. For member context, return only the current session member.
    if (!CURRENT_SESSION) return [];
    return [{
        id: CURRENT_SESSION.id,
        full_name: CURRENT_SESSION.full_name || CURRENT_SESSION.name || 'Me',
        email: CURRENT_SESSION.email || ''
    }];
}

async function toggleAllMembersDropdown() {
    const dropdown = document.getElementById('memberSearchDropdown');
    if (dropdown.style.display === 'block') {
        dropdown.style.display = 'none';
        return;
    }
    dropdown.innerHTML = '<div style="padding: 10px; color: #888;">Loading members...</div>';
    dropdown.style.display = 'block';
    
    const pool = await fetchAllApprovedMembers();
    if (pool.length === 0) {
        dropdown.innerHTML = '<div style="padding: 10px; color: #888;">No members found</div>';
        return;
    }
    const selfId = CURRENT_SESSION ? String(CURRENT_SESSION.id) : '';
    dropdown.innerHTML = pool.map(m => {
        const isSelf = String(m.id) === selfId;
        const label = (m.full_name || m.name || 'Unknown') + (isSelf ? ' (You)' : '');
        return `<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid #333;${isSelf ? ' background: rgba(76,175,80,0.15);' : ''}" onclick="selectPaymentMember('${m.id}', '${(m.full_name || m.name || '').replace(/'/g, "\\'")}')">${label}</div>`;
    }).join('');
}

async function filterMemberSearch(query) {
    const dropdown = document.getElementById('memberSearchDropdown');
    if (!query) {
        dropdown.style.display = 'none';
        return;
    }
    
    const pool = await fetchAllApprovedMembers();
    const matches = pool.filter(m => (m.full_name || m.name || '').toLowerCase().includes(query.toLowerCase()));
    
    if (matches.length === 0) {
        dropdown.innerHTML = '<div style="padding: 10px; color: #888;">No active members found</div>';
    } else {
        dropdown.innerHTML = matches.map(m => `<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid #333;" onclick="selectPaymentMember('${m.id}', '${(m.full_name || m.name || '').replace(/'/g, "\\'")}')">${m.full_name || m.name} (${m.email || ''})</div>`).join('');
    }
    dropdown.style.display = 'block';
}

function selectPaymentMember(id, name) {
    if (document.getElementById('paymentMemberId')) document.getElementById('paymentMemberId').value = id;
    if (document.getElementById('paymentMemberSearch')) document.getElementById('paymentMemberSearch').value = name;
    if (document.getElementById('memberSearchDropdown')) document.getElementById('memberSearchDropdown').style.display = 'none';
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
    const memberId = document.getElementById('paymentMemberId')?.value;
    const searchVal = document.getElementById('paymentMemberSearch')?.value.trim();
    
    let finalMemberId = memberId;
    if (!finalMemberId && searchVal && CURRENT_SESSION) {
        finalMemberId = CURRENT_SESSION.id;
    }
    if (!finalMemberId) {
        return alert('Please select a member from the dropdown or type a name.');
    }
    
    const amountVal = document.getElementById('paymentAmount')?.value;
    if (!amountVal || parseFloat(amountVal) <= 0) {
        return alert('Please enter a valid amount greater than 0.');
    }
    
    const formData = new FormData();
    formData.append('member_id', finalMemberId);
    formData.append('amount', amountVal);
    
    const method = document.getElementById('paymentMethod')?.value;
    if (method === '__other__') {
        const custom = document.getElementById('paymentMethodCustom')?.value.trim();
        if (custom) formData.append('payment_method', custom);
    } else if (method) {
        formData.append('payment_method', method);
    }
    
    // Receipt upload disabled as per requirement
    
    try {
        const result = await apiRequest('contributions/create', {
            method: 'POST',
            body: formData
        });
        alert('Payment recorded successfully and sent to Head Treasurer for reconciliation.');
        
        // Notify admin via logs mechanism (dashboard message)
        const payerName = searchVal || CURRENT_SESSION.full_name || CURRENT_SESSION.name || 'Member';
        const methodStr = method === '__other__' ? document.getElementById('paymentMethodCustom')?.value.trim() : method;
        postApprovalRequestToAdmin(`Member ${payerName} recorded a manual contribution of Ksh ${amountVal} via ${methodStr}.`, 'contribution');
        
        if (document.getElementById('paymentModal')) document.getElementById('paymentModal').style.display = 'none';
        await loadMemberPortalData();
        rebuildMetricsDashboard();
    } catch (e) {
        alert('Error: ' + (e.message || 'Failed to submit payment.'));
    }
}

async function submitExpense(event) {
    event.preventDefault();
    if (!CURRENT_SESSION || !CURRENT_SESSION.id) {
        return alert('You must be logged in to submit an expense claim.');
    }
    const formData = new FormData();
    formData.append('member_id', CURRENT_SESSION.id);
    
    const categoryVal = document.getElementById('expenseCategory')?.value;
    if (categoryVal === 'Other') {
        const custom = document.getElementById('expenseCategoryCustom')?.value.trim();
        if (!custom) return alert('Please enter a custom category name.');
        formData.append('category', custom);
    } else {
        formData.append('category', categoryVal);
    }
    formData.append('amount', document.getElementById('expenseAmount')?.value);
    
    // Receipt upload disabled as per requirement
    
    try {
        const result = await apiRequest('expenses/create', {
            method: 'POST',
            body: formData
        });
        alert('Expense claim submitted and routed to Head Treasurer for authorization.');
        postNotificationToChannels(`Expense claim submitted: ${categoryVal} Ksh ${document.getElementById('expenseAmount')?.value}.`, 'expense');
        if (document.getElementById('expenseModal')) document.getElementById('expenseModal').style.display = 'none';
        await loadMemberPortalData();
        rebuildMetricsDashboard();
    } catch (e) {
        alert('Error: ' + (e.message || 'Failed to submit expense claim.'));
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
        // Use targeted removal — preserve any app data not related to session
        localStorage.removeItem(STORAGE_KEYS.SESSION);
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_TAB);
        localStorage.removeItem('disableBlurEffect');
        localStorage.removeItem('memberAccessGranted');
        sessionStorage.clear();
        window.location.href = 'landingpage.html';
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

async function sendActivityEmailToAdmin(e) {
    e.preventDefault();
    const subject  = (document.getElementById('actEmailSubject')?.value || '').trim();
    const msgBody  = (document.getElementById('actEmailBody')?.value   || '').trim();
    const statusEl = document.getElementById('actEmailStatus');
    const btn      = e.target.querySelector('button[type="submit"]');

    if (!subject || !msgBody) { alert('Please fill in both subject and message.'); return; }

    if (statusEl) { statusEl.style.color = '#aaa'; statusEl.textContent = 'Sending…'; }
    if (btn) btn.disabled = true;

    let dbSaved = false;
    try {
        await apiRequest('messages/send', { method: 'POST', body: JSON.stringify({ subject, body: msgBody }) });
        dbSaved = true;
    } catch (dbErr) {
        console.error('DB save error:', dbErr);
    }

    if (dbSaved) {
        if (statusEl) { statusEl.style.color = '#4caf50'; statusEl.textContent = '✔ Message sent successfully!'; }
        e.target.reset();
    } else {
        if (statusEl) { statusEl.style.color = '#f44336'; statusEl.textContent = '✘ Failed to send message. Please try again.'; }
    }

    const adminEmail = document.getElementById('adminEmailDisplay')?.textContent?.trim() || document.getElementById('contactAdminEmail')?.textContent?.trim() || '';
    if (adminEmail && typeof emailjs !== 'undefined') {
        try {
            const fromName  = CURRENT_SESSION ? (CURRENT_SESSION.full_name || CURRENT_SESSION.name || 'Member') : 'Member';
            const fromEmail = CURRENT_SESSION ? (CURRENT_SESSION.email || 'member@chama.local') : 'member@chama.local';
            await emailjs.send('service_0gypwcr', 'template_ozc1j5q', {
                to_email : adminEmail,
                email    : adminEmail,
                from_name: fromName,
                from_email: fromEmail,
                subject  : subject,
                message  : msgBody
            });
        } catch (_) {}
    }

    if (btn) btn.disabled = false;
}

/**
 * Print the member's transaction ledger as a formatted printout.
 */
function printMemberLedger() {
    const memberName   = CURRENT_SESSION ? (CURRENT_SESSION.full_name || CURRENT_SESSION.name || 'Member') : 'Member';
    const memberId     = CURRENT_SESSION ? CURRENT_SESSION.id : '—';
    const loans        = (MEMBER_DB_STATE.loans || []).map(memberLoanViewModel);
    const repayments   = MEMBER_DB_STATE.repayments || [];
    const contributions = MEMBER_DB_STATE.contributions || [];
    const allTx = [];
    loans.forEach(l => allTx.push({ id: l.id, type: 'Loan', amount: l.amount, date: l.timestamp, status: l.status }));
    repayments.forEach(r => allTx.push({ id: r.id ? 'RPY-' + r.id : 'RPY', type: 'Repayment', amount: r.amount, date: r.created_at ? new Date(r.created_at).toLocaleString() : '', status: 'Completed' }));
    contributions.forEach(c => allTx.push({ id: c.id ? 'CBN-' + c.id : 'CBN', type: 'Contribution', amount: c.amount, date: c.created_at ? new Date(c.created_at).toLocaleString() : '', status: 'Confirmed' }));
    allTx.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    const rows = allTx.map(tx => `
        <tr>
            <td>${tx.id || '—'}</td>
            <td>${tx.type || tx.classification || '—'}</td>
            <td>Ksh ${Number(tx.amount || 0).toLocaleString('en-KE', {minimumFractionDigits:2})}</td>
            <td>${tx.date || '—'}</td>
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
    const memberName  = CURRENT_SESSION ? (CURRENT_SESSION.full_name || CURRENT_SESSION.name || 'Member') : 'Member';
    const memberId    = CURRENT_SESSION ? CURRENT_SESSION.id : '—';
    const contribs    = MEMBER_DB_STATE.contributions || [];

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
 * Load meeting link posted by admin from backend API into the Activities card.
 * Fetches the latest meeting_url from meeting_minutes table.
 */
async function loadMeetingLink() {
    const textEl  = document.getElementById('meetingLinkText');
    const joinBtn = document.getElementById('meetingJoinBtn');
    if (!textEl || !joinBtn) return;

    try {
        const data = await apiRequest('minutes/latest-link', { method: 'GET' });
        const link = data?.meeting_url || data?.data?.meeting_url || '';

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
    } catch (err) {
        // Fallback to localStorage for backward compatibility
        const localLink = localStorage.getItem('adminMeetingLink') || '';
        if (localLink && localLink.startsWith('http')) {
            textEl.textContent  = '✅ Meeting link is available! Click the button below to join.';
            textEl.style.color  = '#4caf50';
            joinBtn.href        = localLink;
            joinBtn.style.display = 'inline-block';
        } else {
            textEl.textContent   = 'No meeting link sent by admin yet. Check back later or contact your admin.';
            textEl.style.color   = '#aaa';
            joinBtn.style.display = 'none';
        }
    }
}

// Auto-load meeting link whenever Activities section becomes visible
document.addEventListener('DOMContentLoaded', () => {
    // Piggyback on the existing nav click system
    document.querySelectorAll('.nav-item[data-target="meetingsSection"]').forEach(navEl => {
        navEl.addEventListener('click', () => {
            setTimeout(loadMeetingLink, 100);
            setTimeout(loadActiveMeetings, 200);
            setTimeout(loadPastMeetings, 300);
        });
    });
    // Also run once on load in case the section is already active
    loadMeetingLink();

    // Load messages badge on session
    if (CURRENT_SESSION && CURRENT_SESSION.id) {
        loadUnreadCount();
        setInterval(loadUnreadCount, 30000);
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  MEETINGS — Active / Past dropdown panels
// ═══════════════════════════════════════════════════════════════════════════

function toggleMeetingPanel(panelId, btn) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        if (panelId === 'activeMeetingsPanel') loadActiveMeetings();
        else loadPastMeetings();
    }
}

async function loadActiveMeetings() {
    const listEl = document.getElementById('activeMeetingsList');
    if (!listEl || !CURRENT_SESSION || !CURRENT_SESSION.id) return;
    listEl.innerHTML = '<div style="padding:16px; text-align:center; color:#888;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
    try {
        const data = await apiRequest('automation/meetings/member/' + CURRENT_SESSION.id + '/active', { method: 'GET' });
        const meetings = Array.isArray(data) ? data : (data.data || []);
        if (!meetings.length) {
            listEl.innerHTML = '<div style="padding:16px; text-align:center; color:#888; font-size:13px;"><i class="fas fa-calendar-times"></i> No upcoming meetings scheduled.</div>';
            return;
        }
        listEl.innerHTML = meetings.map(m => `
            <div style="padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:14px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(m.title)}</div>
                    <div style="font-size:12px; color:#888; margin-top:3px;">
                        <i class="fas fa-calendar"></i> ${escHtml(m.meeting_date)}
                        ${m.meeting_time ? ' &bull; <i class="fas fa-clock"></i> ' + escHtml(m.meeting_time) : ''}
                        ${m.location ? ' &bull; <i class="fas fa-map-marker-alt"></i> ' + escHtml(m.location) : ''}
                    </div>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                    <button onclick="joinMemberMeeting(${m.id}, '${escAttr(m.title)}')" title="Join Meeting" style="padding:6px 12px; border-radius:6px; border:none; background:#10b981; color:#fff; font-size:12px; font-weight:600; cursor:pointer;"><i class="fas fa-sign-in-alt"></i> Join</button>
                    <button onclick="deleteMemberMeeting(${m.id})" title="Delete Meeting" style="padding:6px 10px; border-radius:6px; border:none; background:rgba(239,68,68,0.15); color:#ef4444; font-size:12px; cursor:pointer; border:1px solid rgba(239,68,68,0.3);"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadActiveMeetings error:', err);
        listEl.innerHTML = '<div style="padding:16px; text-align:center; color:#f44336; font-size:13px;">Failed to load meetings.</div>';
    }
}

async function loadPastMeetings() {
    const listEl = document.getElementById('pastMeetingsList');
    if (!listEl || !CURRENT_SESSION || !CURRENT_SESSION.id) return;
    listEl.innerHTML = '<div style="padding:16px; text-align:center; color:#888;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
    try {
        const data = await apiRequest('automation/meetings/member/' + CURRENT_SESSION.id + '/past', { method: 'GET' });
        const meetings = Array.isArray(data) ? data : (data.data || []);
        if (!meetings.length) {
            listEl.innerHTML = '<div style="padding:16px; text-align:center; color:#888; font-size:13px;"><i class="fas fa-history"></i> No past meetings found.</div>';
            return;
        }
        listEl.innerHTML = meetings.map(m => `
            <div style="padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:space-between; gap:10px; opacity:0.75;">
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(m.title)}</div>
                    <div style="font-size:11px; color:#666; margin-top:3px;">
                        <i class="fas fa-calendar"></i> ${escHtml(m.meeting_date)}
                        ${m.location ? ' &bull; <i class="fas fa-map-marker-alt"></i> ' + escHtml(m.location) : ''}
                    </div>
                </div>
                <button onclick="deleteMemberMeeting(${m.id})" title="Delete Meeting" style="padding:6px 10px; border-radius:6px; border:none; background:rgba(239,68,68,0.1); color:#ef4444; font-size:12px; cursor:pointer; border:1px solid rgba(239,68,68,0.2);"><i class="fas fa-trash"></i></button>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadPastMeetings error:', err);
        listEl.innerHTML = '<div style="padding:16px; text-align:center; color:#f44336; font-size:13px;">Failed to load meetings.</div>';
    }
}

async function deleteMemberMeeting(id) {
    if (!confirm('Are you sure you want to delete this meeting?')) return;
    try {
        await apiRequest('automation/meetings/' + id, { method: 'DELETE' });
        loadActiveMeetings();
        loadPastMeetings();
    } catch (err) {
        console.error('deleteMemberMeeting error:', err);
        alert('Failed to delete meeting.');
    }
}

async function joinMemberMeeting(id, title) {
    const link = localStorage.getItem('adminMeetingLink') || '';
    if (link && link.startsWith('http')) {
        window.open(link, '_blank');
    }
    try {
        await apiRequest('live-updates/log', {
            method: 'POST',
            body: JSON.stringify({ event_type: 'meeting_join', event_body: 'Joined meeting: ' + title })
        });
        await apiRequest('messages/send', {
            method: 'POST',
            body: JSON.stringify({ subject: 'Meeting Attendance', body: 'I have joined the meeting: ' + title })
        });
    } catch (err) {
        console.warn('joinMemberMeeting: failed to log event or send message:', err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MESSAGES — Inbox, Compose, Unread Badge
// ═══════════════════════════════════════════════════════════════════════════

function navigateToMessages() {
    const navLink = document.querySelector('.nav-item[data-target="messagesSection"]');
    if (navLink) navLink.click();
}

async function loadUnreadCount() {
    if (!CURRENT_SESSION || !CURRENT_SESSION.id) return;
    try {
        const data = await apiRequest('messages/unread-count', { method: 'GET' });
        const count = typeof data === 'number' ? data : (data.count || 0);
        const badge = document.getElementById('unreadBadgeCount');
        const badgeWrap = document.getElementById('unreadMessagesBadge');
        const navBadge = document.getElementById('navMsgBadge');
        const indicator = document.getElementById('msgUnreadIndicator');
        if (badge) badge.textContent = count;
        if (badgeWrap) badgeWrap.style.display = count > 0 ? 'block' : 'none';
        if (navBadge) { navBadge.textContent = count; navBadge.style.display = count > 0 ? 'inline' : 'none'; }
        if (indicator) indicator.style.display = count > 0 ? 'inline' : 'none';
    } catch (err) {
        console.warn('loadUnreadCount error:', err);
    }
}

async function loadMessagesInbox() {
    const listEl = document.getElementById('messagesInboxList');
    if (!listEl || !CURRENT_SESSION || !CURRENT_SESSION.id) return;
    listEl.innerHTML = '<div style="padding:16px; text-align:center; color:#888;"><i class="fas fa-spinner fa-spin"></i> Loading messages...</div>';
    try {
        const data = await apiRequest('messages/member-inbox/' + CURRENT_SESSION.id, { method: 'GET' });
        const messages = Array.isArray(data) ? data : (data.data || []);
        if (!messages.length) {
            listEl.innerHTML = '<div style="padding:24px; text-align:center; color:#888; font-size:13px;"><i class="fas fa-inbox" style="font-size:24px; margin-bottom:8px; display:block;"></i>No messages yet. Use the compose form above to send a message to your admin.</div>';
            return;
        }
        listEl.innerHTML = messages.map(m => {
            const isFromAdmin = m.sender_role === 'admin';
            const bgColor = isFromAdmin ? 'rgba(59,130,246,0.06)' : 'rgba(16,185,129,0.06)';
            const borderColor = isFromAdmin ? 'rgba(59,130,246,0.2)' : 'rgba(16,185,129,0.2)';
            const label = isFromAdmin ? '<span style="color:#3b82f6; font-weight:600;">Admin</span>' : '<span style="color:#10b981; font-weight:600;">You</span>';
            const readDot = !m.is_read && isFromAdmin ? '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444; margin-left:6px;"></span>' : '';
            return `
                <div style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:10px; padding:14px 16px; margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <div style="font-size:13px;">${label} ${readDot}</div>
                        <div style="font-size:11px; color:#666;">${m.created_at ? new Date(m.created_at).toLocaleString() : ''}</div>
                    </div>
                    <div style="font-weight:600; font-size:14px; margin-bottom:4px;">${escHtml(m.subject || 'General')}</div>
                    <div style="font-size:13px; color:var(--text-primary); line-height:1.5; white-space:pre-wrap;">${escHtml(m.body)}</div>
                </div>
            `;
        }).join('');
        loadUnreadCount();
    } catch (err) {
        console.error('loadMessagesInbox error:', err);
        listEl.innerHTML = '<div style="padding:16px; text-align:center; color:#f44336; font-size:13px;">Failed to load messages.</div>';
    }
}

async function sendMessageToAdmin(e) {
    e.preventDefault();
    const subjectEl = document.getElementById('msgSubject');
    const bodyEl = document.getElementById('msgBody');
    const statusEl = document.getElementById('sendMessageStatus');
    const btn = document.getElementById('btnSendMessage');
    const subject = (subjectEl?.value || '').trim();
    const body = (bodyEl?.value || '').trim();
    if (!subject || !body) { alert('Please fill in both subject and message.'); return; }
    if (btn) btn.disabled = true;
    if (statusEl) { statusEl.style.color = '#aaa'; statusEl.textContent = 'Sending...'; }
    try {
        await apiRequest('messages/send', { method: 'POST', body: JSON.stringify({ subject, body }) });
        if (statusEl) { statusEl.style.color = '#4caf50'; statusEl.textContent = 'Message sent successfully!'; }
        e.target.reset();
        setTimeout(loadMessagesInbox, 500);
    } catch (err) {
        console.error('sendMessageToAdmin error:', err);
        if (statusEl) { statusEl.style.color = '#f44336'; statusEl.textContent = 'Failed to send message. Please try again.'; }
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Hook into messages section navigation
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item[data-target="messagesSection"]').forEach(navEl => {
        navEl.addEventListener('click', () => setTimeout(loadMessagesInbox, 200));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  HTML ESCAPE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
    return escHtml(str).replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════════════════
//  M-PESA STK PUSH (Member Portal)
// ═══════════════════════════════════════════════════════════════════════════

function openStkModal(opts = {}) {
    const old = document.getElementById('memberStkModal');
    if (old) old.remove();

    const phone = CURRENT_SESSION?.phone || '';
    const modal = document.createElement('div');
    modal.id = 'memberStkModal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:9999; display:flex; justify-content:center; align-items:center;';
    modal.innerHTML = `
    <div style="background:#1a1d23; border-radius:14px; width:95%; max-width:440px; padding:28px; border:1px solid rgba(76,175,80,0.35); box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <h3 style="margin:0; color:#81c784; font-size:18px;"><i class="fas fa-mobile-alt"></i> Pay via M-Pesa</h3>
        <button onclick="closeStkModal()" style="background:rgba(255,255,255,0.1); border:none; color:#fff; width:32px; height:32px; border-radius:50%; cursor:pointer; font-size:16px;">×</button>
      </div>
      <div id="stkModalStatus" style="display:none; padding:10px 14px; border-radius:8px; margin-bottom:14px; font-size:13px;"></div>
      <label style="font-size:11px; color:#81c784; text-transform:uppercase; font-weight:bold; display:block; margin-bottom:4px;">Amount (KES)</label>
      <input type="number" id="stkAmount" placeholder="e.g. 500" value="${opts.amount || ''}" min="1" style="margin-bottom:14px;">
      <label style="font-size:11px; color:#81c784; text-transform:uppercase; font-weight:bold; display:block; margin-bottom:4px;">M-Pesa Phone Number</label>
      <input type="text" id="stkPhone" placeholder="e.g. 0712345678" value="${phone}" style="margin-bottom:14px;">
      <label style="font-size:11px; color:#81c784; text-transform:uppercase; font-weight:bold; display:block; margin-bottom:4px;">Purpose</label>
      <select id="stkPurpose" style="margin-bottom:20px; background:#222; color:#fff; border:1px solid #444; height:40px; padding:8px; border-radius:8px; width:100%;">
        <option value="Contribution">Monthly Contribution</option>
        <option value="Loan Repayment">Loan Repayment</option>
        <option value="Registration Fee">Registration Fee</option>
        <option value="Fine/Penalty">Fine/Penalty</option>
      </select>
      <button id="stkSubmitBtn" style="width:100%; background:linear-gradient(135deg,#4caf50,#2e7d32); color:#fff; border:none; padding:14px; border-radius:10px; font-size:15px; font-weight:700; cursor:pointer; letter-spacing:0.5px;" onclick="initiateStkPush(event)">
        <i class="fas fa-paper-plane"></i> Send STK Push to My Phone
      </button>
      <p style="font-size:11px; color:#666; text-align:center; margin:12px 0 0;">A prompt will appear on your phone. Enter your M-Pesa PIN to confirm payment.</p>
    </div>`;
    document.body.appendChild(modal);

    if (opts.purpose) {
        const sel = document.getElementById('stkPurpose');
        if (sel) sel.value = opts.purpose;
    }
}

function closeStkModal() {
    const modal = document.getElementById('memberStkModal');
    if (modal) modal.remove();
}

async function initiateStkPush(event) {
    if (event) event.preventDefault();
    const amount = document.getElementById('stkAmount')?.value?.trim();
    const phone = document.getElementById('stkPhone')?.value?.trim();
    const purpose = document.getElementById('stkPurpose')?.value;
    const statusEl = document.getElementById('stkModalStatus');
    const btn = document.getElementById('stkSubmitBtn');

    if (!amount || Number(amount) < 1) {
        if (statusEl) { statusEl.style.display='block'; statusEl.style.background='rgba(244,67,54,0.15)'; statusEl.style.color='#f44336'; statusEl.textContent = 'Please enter a valid amount.'; }
        return;
    }
    if (!phone) {
        if (statusEl) { statusEl.style.display='block'; statusEl.style.background='rgba(244,67,54,0.15)'; statusEl.style.color='#f44336'; statusEl.textContent = 'Please enter your M-Pesa phone number.'; }
        return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending STK Push...'; }
    if (statusEl) { statusEl.style.display='block'; statusEl.style.background='rgba(255,152,0,0.15)'; statusEl.style.color='#ff9800'; statusEl.textContent = 'Initiating STK Push. Please wait...'; }

    try {
        await apiRequest('mpesa/stk-push', {
            method: 'POST',
            body: JSON.stringify({
                amount,
                phone,
                purpose,
                member_id: CURRENT_SESSION?.id,
                admin_id: CURRENT_SESSION?.admin_id
            })
        });
        if (statusEl) { statusEl.style.background='rgba(76,175,80,0.15)'; statusEl.style.color='#4caf50'; statusEl.textContent = '✓ STK Push sent! Check your phone and enter your M-Pesa PIN to complete payment.'; }
        if (btn) { btn.innerHTML = '<i class="fas fa-check"></i> STK Sent!'; btn.style.background='#2e7d32'; }
        setTimeout(closeStkModal, 5000);
    } catch (err) {
        if (statusEl) { statusEl.style.background='rgba(244,67,54,0.15)'; statusEl.style.color='#f44336'; statusEl.textContent = 'Failed: ' + (err.message || 'Unknown error'); }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send STK Push to My Phone'; }
    }
}

// submitPayment — alias for backward compat
async function submitPayment(event) {
    return initiateStkPush(event);
}

