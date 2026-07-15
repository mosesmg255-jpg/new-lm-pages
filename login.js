// login.js
const API = window.__API_BASE__ || '/api';


function goToLogin() {
  window.location.href = "login.html"; 
}

function goToCreateAccount() {
  window.location.href = "createaccount.html"; 
}

function goToHome() {
  window.location.href = "laddingpage.html"; 
}
document.querySelector('form').addEventListener('submit', function(e) {
    e.preventDefault(); // Halt page bounce mechanisms to intercept processing cleanly

    const formData = new FormData(this);

    fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(formData.entries()))
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            // Stamp admin session so home.html blur gate can verify
            sessionStorage.setItem('adminSession', JSON.stringify({
                id: data.admin?.id || '',
                name: data.admin?.full_name || data.admin?.name || '',
                email: data.admin?.email || '',
                phone: data.admin?.phone || '',
                role: 'admin',
                timestamp: Date.now(),
                token: data.token || ''
            }));
            localStorage.setItem('disableBlurEffect', 'true');
            alert(data.message || 'Successfully logged in. Opening your session...');
            setTimeout(() => {
                window.location.href = data.redirect; // Safely enters home.html dashboard
            }, 350);
        } else {
            alert("Authentication Intercept Error: " + data.message);
        }
    })
    .catch(error => console.error("Pipeline credential delivery failure: ", error));
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
