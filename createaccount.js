document.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const form = e.target;
    const name = (form.querySelector('[name="adminName"]') || document.getElementById('adminName'))?.value?.trim();
    const email = (form.querySelector('[name="adminEmail"]') || document.getElementById('adminEmail'))?.value?.trim();
    const phone = (form.querySelector('[name="adminPhone"]') || document.getElementById('adminPhone'))?.value?.trim();
    const password = (form.querySelector('[name="adminPassword"]') || document.getElementById('adminPassword'))?.value;
    const confirm = (form.querySelector('[name="adminConfirm"]') || document.getElementById('adminConfirm'))?.value;

    if (!name || !email || !password || !confirm) {
        alert('Please fill in all required fields.');
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        alert('Please enter a valid email address.');
        return;
    }

    if (password.length < 6) {
        alert('Password must be at least 6 characters.');
        return;
    }

    if (password !== confirm) {
        alert('Passwords do not match.');
        return;
    }

    if (phone && phone.replace(/[^0-9]/g, '').length < 9) {
        alert('Phone number must be at least 9 digits.');
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Creating Account...';
    }

    try {
        const response = await fetch((window.__API_BASE__ || '/api') + '/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminName: name, adminEmail: email, adminPhone: phone || '', adminPassword: password, adminConfirm: confirm })
        });

        const result = await response.json();
        if (result.redirect) {
            window.location.href = result.redirect;
        } else if (result.success || result.status === 'success') {
            window.location.href = 'popup.html?status=success&message=' + encodeURIComponent('Account created successfully! Click OK to return to login.');
        } else {
            window.location.href = 'popup.html?status=error&message=' + encodeURIComponent(result.message || 'Registration failed. User may already exist.');
        }
    } catch (err) {
        console.error('Registration failed:', err);
        window.location.href = 'popup.html?status=error&message=' + encodeURIComponent('Network error. Unable to complete registration.');
    }
});
