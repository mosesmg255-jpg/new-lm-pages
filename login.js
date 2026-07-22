// login.js
const API = window.__API_BASE__ || '/api';

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

function goToLogin() {
  window.location.href = "login.html"; 
}

function goToCreateAccount() {
  window.location.href = "createaccount.html"; 
}

function goToHome() {
  window.location.href = "landingpage.html"; 
}
document.querySelector('form').addEventListener('submit', function(e) {
    e.preventDefault(); // Intercept form submission

    const formData = new FormData(this);
    const formObj = Object.fromEntries(formData.entries());

    const email = formObj.adminEmail || formObj.email || document.getElementById('adminEmail')?.value;
    const password = formObj.adminPassword || formObj.password || document.getElementById('adminPassword')?.value;

    if (!email || !password) {
        alert('Please enter both email and password.');
        return;
    }

    // Save credentials to sessionStorage and launch authentication scanner popup
    sessionStorage.setItem('pending_email', email);
    sessionStorage.setItem('pending_password', password);

    window.location.href = 'invalidcredentials.html';
});

// Admin Password Recovery Logic
let activeRecoveryToken = null;

document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset_token');
    if (resetToken) {
        showRecoveryUI(new Event('load'));
        document.getElementById('recoveryStep1').style.display = 'none';
        document.getElementById('recoveryStep3').style.display = 'block';
        activeRecoveryToken = resetToken;
    }
});

function showRecoveryUI(e) {
    if(e) e.preventDefault();
    const modal = document.getElementById('recoveryModal');
    if (modal.style.display === 'block') {
        // Already open - close it
        hideRecoveryUI();
    } else {
        // Open and reset to step 1
        modal.style.display = 'block';
        document.getElementById('recoveryStep1').style.display = 'block';
        document.getElementById('recoveryStep3').style.display = 'none';
    }
}

function hideRecoveryUI() {
    document.getElementById('recoveryModal').style.display = 'none';
    activeRecoveryToken = null;
}

function requestPasswordReset(e) {
    e.preventDefault();
    const emailInput = document.getElementById('recoveryEmail').value;
    if (!emailInput) { alert("Please enter email first"); return; }
    
    document.getElementById('btnRequestReset').innerText = "Verifying...";
    document.getElementById('btnRequestReset').disabled = true;

    fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput })
    })
    .then(r => r.json())
    .then(data => {
        document.getElementById('btnRequestReset').innerText = "Generate Reset Link";
        document.getElementById('btnRequestReset').disabled = false;
        
        if (data.status === 'success') {
            const token = data.token;
            const resetLink = window.location.origin + window.location.pathname + "?reset_token=" + token;
            
            emailjs.send("service_0gypwcr", "template_ozc1j5q", {
                email: emailInput,
                to_email: emailInput,
                reset_link: resetLink,
                message: resetLink,
                token: token
            }).then(() => {
                alert("Secure reset link sent to your email! Please check your inbox and spam folders.");
                document.getElementById('btnRequestReset').innerText = "Link Sent";
            }).catch(err => {
                console.error("EmailJS Error:", err);
                alert("Failed to send reset email. Please try again or contact admin.");
                document.getElementById('btnRequestReset').innerText = "Generate Reset Link";
                document.getElementById('btnRequestReset').disabled = false;
            });
        } else {
            alert("Error: " + data.message);
        }
    })
    .catch(err => {
        console.error(err);
        document.getElementById('btnRequestReset').innerText = "Generate Reset Link";
        document.getElementById('btnRequestReset').disabled = false;
        alert("Server communication error.");
    });
}

function submitAIVerifiedRecovery(e) {
    e.preventDefault();
    const newPassword = document.getElementById('recoveryNewPassword').value;
    if (!newPassword || newPassword.length < 4) { alert("Please enter a valid new password"); return; }
    
    fetch(`${API}/auth/recover-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: activeRecoveryToken, newPassword })
    })
    .then(r => r.json())
    .then(data => {
        if (data.status === 'success') {
            alert("Password successfully updated. You may now log in with the new credentials.");
            hideRecoveryUI();
        } else {
            alert("Error: " + data.message);
            hideRecoveryUI();
        }
    })
    .catch(err => {
        console.error(err);
        alert("Server communication error.");
    });
}
