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
        } else if (result.success) {
            alert('Account created successfully!');
            window.location.href = 'login.html';
        } else {
            alert('Registration failed. Please check your details and try again.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Create Account';
            }
        }
    } catch (err) {
        console.error('Registration failed:', err);
        alert('Network error. Please try again.');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Create Account';
        }
    }
});
