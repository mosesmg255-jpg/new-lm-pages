  window.addEventListener('DOMContentLoaded', () => {
            const email = sessionStorage.getItem('pending_email');
            const password = sessionStorage.getItem('pending_password');

            if (!email || !password) {
                showFailure("No authorization parameters detected.", 5);
                return;
            }

            const formData = new FormData();
            formData.append('email', email);
            formData.append('password', password);

            // Fetch request targeting Node.js API directly
            fetch((window.__API_BASE__ || '/api') + '/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(formData.entries()))
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Server returned non-200 status');
                }
                return response.json();
            })
            .then(data => {
                // 1. Direct drop routing block if MySQL connection has failed
                if (data.status === 'database_error' || data.redirect === 'dbfailserror.html') {
                    window.location.href = "dbfailserror.html";
                } 
                // 2. Direct drop routing if attempts reach 0
                else if (data.status === 'lockout') {
                    window.location.href = data.redirect || 'invalidcredentials.html';
                } 
                // 3. Match Approved State
                else if (data.status === 'success') {
                    sessionStorage.removeItem('homeSessionTimedOut');
                    localStorage.removeItem('disableBlurEffect');
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
                    showSuccess(data.message || 'Access Approved. Credentials Confirmed.');
                } 
                // 4. Access Denied State
                else {
                    showFailure(data.message || 'Invalid username or password.', data.attempts !== undefined ? data.attempts : 3);
                }
            })
            .catch(error => {
                // Network or connection drops gracefully fall back to database failure screen
                window.location.href = "dbfailserror.html";
            });
        });

        function showSuccess(message) {
            const container = document.getElementById('popup-container');
            const titleEl = document.getElementById('popup-title');
            const messageEl = document.getElementById('error-message');
            const attemptsBox = document.getElementById('attempts-box');
            const continueBtn = document.getElementById('continue-btn');

            container.style.borderTop = "5px solid #00c853";
            titleEl.textContent = "Access Approved";
            titleEl.style.color = "#00e0ff";
            messageEl.textContent = message;
            
            attemptsBox.textContent = " Credentials Confirmed! Access Granted.";
            attemptsBox.style.backgroundColor = "rgba(0, 200, 83, 0.2)";
            attemptsBox.style.color = "#a2ffb8";
            attemptsBox.style.borderColor = "rgba(0, 200, 83, 0.4)";
            
            continueBtn.disabled = false; // ENABLE entry path flow
        }

        function showFailure(message, attemptsLeft) {
            const container = document.getElementById('popup-container');
            const titleEl = document.getElementById('popup-title');
            const messageEl = document.getElementById('error-message');
            const attemptsBox = document.getElementById('attempts-box');
            const continueBtn = document.getElementById('continue-btn');

            container.style.borderTop = "5px solid #d9534f";
            titleEl.textContent = "Access Denied";
            titleEl.style.color = "#ff6a00";
            messageEl.textContent = message;
            
            attemptsBox.textContent = `Warning: Only ${attemptsLeft} attempts remaining!`;
            attemptsBox.style.backgroundColor = "rgba(217, 83, 79, 0.2)";
            attemptsBox.style.color = "#ff9494";
            attemptsBox.style.borderColor = "rgba(217, 83, 79, 0.4)";
            
            continueBtn.disabled = true; // BLOCK continue route tracking explicitly
        }
        
    